"""
Guardrail regression tests for POST /api/v1/agent/breed.

Each test isolates exactly one server-authoritative guardrail from
routers/agents.py::breed_agents by starting from a pair of parent docs
that satisfy every OTHER guardrail, then breaking the one under test.
A failure here means a real guardrail regressed, not a mock drifting
from the source.

Guardrails covered (see backend/routers/agents.py inline comments +
memory/breeding_analysis.md for the canonical numbered list):
  1. Self-breed prevention
  2. Ownership check (both parents must belong to the requesting wallet)
  3. Idempotency (same parent pair + name always returns the same offspring)
  4. Wisdom unlock gate (level >= 3 or total_events >= 5)
  5. Breeding quota (breeding_count < max_breedings)
  6. Cooldown (breeding_cooldown_hours since last_breeding_time)
  7. Atomic batch write (parents + offspring persist together)
  8. Sort-order determinism (breed(A,B) == breed(B,A) for the same offspring_id)
  9. On-chain breed cost verification (invalid tx hash is rejected)
  10. Same-chain parents (breeding requires parent1.chain_id == parent2.chain_id)
"""

import time

import pytest

from tests.conftest import make_agent, make_wallet

pytestmark = pytest.mark.asyncio

BREED_URL = "/api/v1/agent/breed"


async def _seed_pair(fake_db, user_wallet: str, **overrides_for_p1):
    """Seed two agents that satisfy every guardrail by default; overrides_for_p1
    are merged onto parent 1 only, so callers isolate a single failing condition."""
    p1_wallet, p2_wallet = make_wallet(), make_wallet()
    p1 = make_agent("agent-alpha", p1_wallet, user_wallet=user_wallet, **overrides_for_p1)
    p2 = make_agent("agent-beta", p2_wallet, user_wallet=user_wallet)
    fake_db.seed("agents", "agent-alpha", p1)
    fake_db.seed("agents", "agent-beta", p2)
    return p1, p2


def _breed_payload(user_wallet: str, name: str = "Offspring-1", **overrides) -> dict:
    payload = {
        "user_wallet": user_wallet,
        "parent_1_id": "agent-alpha",
        "parent_2_id": "agent-beta",
        "offspring_name": name,
    }
    payload.update(overrides)
    return payload


# ── 1. Self-breed prevention ────────────────────────────────────────────────


async def test_self_breed_is_rejected(client):
    user_wallet = make_wallet()
    resp = await client.post(
        BREED_URL,
        json=_breed_payload(user_wallet, parent_1_id="agent-alpha", parent_2_id="agent-alpha"),
    )
    assert resp.status_code == 400
    assert "cannot breed with itself" in resp.json()["detail"]


# ── 2. Ownership check ──────────────────────────────────────────────────────


async def test_breeding_someone_elses_agent_is_rejected(client, fake_db):
    owner_wallet = make_wallet()
    attacker_wallet = make_wallet()
    await _seed_pair(fake_db, owner_wallet)

    resp = await client.post(BREED_URL, json=_breed_payload(attacker_wallet))

    assert resp.status_code == 403
    assert "does not belong to your wallet" in resp.json()["detail"]


# ── 3. Idempotency ───────────────────────────────────────────────────────────


async def test_repeated_breed_call_returns_same_offspring(client, fake_db):
    user_wallet = make_wallet()
    await _seed_pair(fake_db, user_wallet)
    payload = _breed_payload(user_wallet)

    first = await client.post(BREED_URL, json=payload)
    second = await client.post(BREED_URL, json=payload)

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["agent_id"] == second.json()["agent_id"]

    # Idempotent replay must short-circuit before quota/cooldown mutation —
    # parent breeding_count should only have been incremented once.
    parent = (await fake_db.collection("agents").document("agent-alpha").get()).to_dict()
    assert parent["breeding_count"] == 1


async def test_idempotent_replay_from_another_wallet_is_rejected(client, fake_db):
    owner_wallet = make_wallet()
    attacker_wallet = make_wallet()
    await _seed_pair(fake_db, owner_wallet)
    payload = _breed_payload(owner_wallet)

    first = await client.post(BREED_URL, json=payload)
    assert first.status_code == 201

    replay = await client.post(BREED_URL, json=_breed_payload(attacker_wallet))
    assert replay.status_code == 403
    assert "does not belong to your wallet" in replay.json()["detail"]


# ── Same-chain parents (guardrail #10) ──────────────────────────────────────


async def test_cross_chain_parents_are_rejected(client, fake_db):
    user_wallet = make_wallet()
    p1_wallet, p2_wallet = make_wallet(), make_wallet()
    p1 = make_agent("agent-alpha", p1_wallet, user_wallet=user_wallet, chain_id=5003)
    p2 = make_agent("agent-beta", p2_wallet, user_wallet=user_wallet, chain_id=11155111)
    fake_db.seed("agents", "agent-alpha", p1)
    fake_db.seed("agents", "agent-beta", p2)

    resp = await client.post(BREED_URL, json=_breed_payload(user_wallet))

    assert resp.status_code == 422
    assert "same chain" in resp.json()["detail"]


async def test_v7_parents_cannot_breed_yet(client, fake_db):
    user_wallet = make_wallet()
    p1 = make_agent("agent-alpha", make_wallet(), user_wallet=user_wallet)
    p2 = {**make_agent("agent-beta", make_wallet(), user_wallet=user_wallet), "contract_version": 7}
    fake_db.seed("agents", "agent-alpha", p1)
    fake_db.seed("agents", "agent-beta", p2)

    resp = await client.post(BREED_URL, json=_breed_payload(user_wallet))

    assert resp.status_code == 422
    assert "V7" in resp.json()["detail"]


# ── 4. Wisdom unlock gate ────────────────────────────────────────────────────


async def test_underleveled_agent_cannot_breed(client, fake_db):
    user_wallet = make_wallet()
    # Neither level>=3 nor total_events>=5 — must fail the gate.
    await _seed_pair(fake_db, user_wallet, level=1, total_events=0)

    resp = await client.post(BREED_URL, json=_breed_payload(user_wallet))

    assert resp.status_code == 422
    assert "needs level 3+ or 5+ events" in resp.json()["detail"]


async def test_low_level_agent_with_enough_events_can_breed(client, fake_db):
    """5+ events is an alternate unlock path even below level 3 — must NOT be rejected."""
    user_wallet = make_wallet()
    await _seed_pair(fake_db, user_wallet, level=1, total_events=5)

    resp = await client.post(BREED_URL, json=_breed_payload(user_wallet))

    assert resp.status_code == 201


# ── 5. Breeding quota ────────────────────────────────────────────────────────


async def test_agent_at_breeding_quota_is_rejected(client, fake_db):
    user_wallet = make_wallet()
    await _seed_pair(fake_db, user_wallet, breeding_count=3, max_breedings=3)

    resp = await client.post(BREED_URL, json=_breed_payload(user_wallet))

    assert resp.status_code == 422
    assert "reached its breeding limit" in resp.json()["detail"]


# ── 6. Cooldown ───────────────────────────────────────────────────────────────


async def test_agent_on_cooldown_is_rejected(client, fake_db):
    user_wallet = make_wallet()
    await _seed_pair(
        fake_db,
        user_wallet,
        last_breeding_time=time.time() - 3600,  # bred 1h ago
        breeding_cooldown_hours=24,
    )

    resp = await client.post(BREED_URL, json=_breed_payload(user_wallet))

    assert resp.status_code == 422
    assert "on cooldown" in resp.json()["detail"]


async def test_agent_past_cooldown_can_breed(client, fake_db):
    user_wallet = make_wallet()
    await _seed_pair(
        fake_db,
        user_wallet,
        last_breeding_time=time.time() - (25 * 3600),  # bred 25h ago — past 24h cooldown
        breeding_cooldown_hours=24,
    )

    resp = await client.post(BREED_URL, json=_breed_payload(user_wallet))

    assert resp.status_code == 201


# ── 7. Atomic batch write ────────────────────────────────────────────────────


async def test_successful_breed_persists_offspring_and_updates_both_parents(client, fake_db):
    user_wallet = make_wallet()
    await _seed_pair(fake_db, user_wallet)

    resp = await client.post(BREED_URL, json=_breed_payload(user_wallet))
    assert resp.status_code == 201
    offspring_id = resp.json()["agent_id"]

    agents = fake_db.collection("agents")
    assert (await agents.document(offspring_id).get()).exists

    for parent_id in ("agent-alpha", "agent-beta"):
        parent = (await agents.document(parent_id).get()).to_dict()
        assert parent["breeding_count"] == 1
        assert parent["last_breeding_time"] is not None
        assert parent["breeding_cooldown_hours"] == 24


# ── 8. Sort-order determinism ────────────────────────────────────────────────


async def test_parent_order_does_not_change_offspring_identity(client, fake_db):
    user_wallet = make_wallet()
    await _seed_pair(fake_db, user_wallet)

    forward = await client.post(BREED_URL, json=_breed_payload(user_wallet))
    assert forward.status_code == 201

    reversed_order = await client.post(
        BREED_URL,
        json=_breed_payload(user_wallet, parent_1_id="agent-beta", parent_2_id="agent-alpha"),
    )
    assert reversed_order.status_code == 201

    # (A, B) and (B, A) must resolve to the same offspring — not two separate agents.
    assert forward.json()["agent_id"] == reversed_order.json()["agent_id"]
    parent = (await fake_db.collection("agents").document("agent-alpha").get()).to_dict()
    assert parent["breeding_count"] == 1  # second call was an idempotent replay, not a new breed


# ── 9. On-chain breed cost verification ─────────────────────────────────────


async def test_invalid_breed_tx_hash_is_rejected(client, fake_db, monkeypatch):
    user_wallet = make_wallet()
    await _seed_pair(fake_db, user_wallet)

    async def _reject(*args, **kwargs):
        raise ValueError("Transaction was reverted")

    monkeypatch.setattr("routers.agents.web3_service.verify_breed_tx", _reject)

    resp = await client.post(
        BREED_URL,
        json=_breed_payload(user_wallet, breed_tx_hash="0x" + "11" * 32),
    )

    assert resp.status_code == 422
    assert "Breed transaction invalid" in resp.json()["detail"]
