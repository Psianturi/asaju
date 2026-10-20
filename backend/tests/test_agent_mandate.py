"""
Tests for agent mandates — the standing authorisation that lets Auto Scout
run without a per-run signature.

The properties that matter, and the ones these tests pin:

  - a mandate authorises exactly what was signed, and nothing more
  - it dies when the agent is sold
  - it does not come back when the agent is sold to the same person again
  - the daily budget is real and resets on a new UTC day
  - a non-owner cannot grant one
  - only the narrow, non-financial scope can be requested
"""
import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import HTTPException

from core import agent_mandate
from core.agent_mandate import (
    MANDATEABLE_SCOPES,
    active_mandate,
    consume_mandate_run,
    grant_mandate,
    issue_mandate_challenge,
    revoke_mandate,
)


pytestmark = pytest.mark.asyncio


class _FakeDoc:
    def __init__(self, data):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data or {})

    async def delete(self):
        self._data = None


class _FakeRef:
    def __init__(self, store, doc_id):
        self._store = store
        self._doc_id = doc_id

    async def get(self):
        return _FakeDoc(self._store.get(self._doc_id))

    async def set(self, data):
        self._store[self._doc_id] = dict(data)

    async def update(self, data):
        self._store.setdefault(self._doc_id, {}).update(data)

    async def delete(self):
        self._store.pop(self._doc_id, None)


class _FakeCollection:
    def __init__(self, store):
        self._store = store

    def document(self, doc_id):
        return _FakeRef(self._store, doc_id)


class _FakeDb:
    def __init__(self):
        self.mandates = {}
        self.challenges = {}
        self.agents = {}

    def collection(self, name):
        if name == agent_mandate.MANDATES_COLLECTION:
            return _FakeCollection(self.mandates)
        if name == agent_mandate.MANDATE_CHALLENGES_COLLECTION:
            return _FakeCollection(self.challenges)
        if name == "agents":
            return _FakeCollection(self.agents)
        raise AssertionError(f"unexpected collection {name}")


def _sign(message, signer):
    return Account.sign_message(
        encode_defunct(text=message), signer.key
    ).signature.hex()


def _patch_owner(monkeypatch, owner):
    async def read(_wallet, _chain):
        return owner

    monkeypatch.setattr(agent_mandate, "_read_owner", read, raising=False)
    monkeypatch.setattr(
        "core.agent_auth._read_agent_owner_on_chain", read
    )


async def _grant(db, monkeypatch, owner, *, agent_id="agent-1", epoch=0,
                 chain_id=97, max_runs=2, scopes=None):
    """Walk the full issue → sign → grant flow for one owner."""
    db.agents[agent_id] = {"agent_wallet": "0x" + "aa" * 20, "ownership_epoch": epoch}
    _patch_owner(monkeypatch, owner.address)
    challenge = await issue_mandate_challenge(
        db,
        agent_id=agent_id,
        agent_wallet="0x" + "aa" * 20,
        chain_id=chain_id,
        scopes=scopes or ["attend_event"],
        max_runs_per_day=max_runs,
    )
    signature = _sign(challenge["message"], owner)
    return await grant_mandate(db, nonce=challenge["nonce"], signature=signature)


# ── scope safety ───────────────────────────────────────────────────────────


async def test_only_attend_event_can_be_mandated(db_empty=None):
    """Today a mandate may only authorise attending an event. If trading ever
    becomes mandateable it has to be added here on purpose, with the contract
    enforcement that goes with it."""
    assert MANDATEABLE_SCOPES == ("attend_event",)


async def test_trading_scope_is_refused(monkeypatch):
    db = _FakeDb()
    with pytest.raises(HTTPException) as exc:
        await issue_mandate_challenge(
            db,
            agent_id="agent-1",
            agent_wallet="0x" + "aa" * 20,
            chain_id=97,
            scopes=["trade"],
            max_runs_per_day=1,
        )
    assert exc.value.status_code == 400
    assert "Unsupported mandate scope" in exc.value.detail


async def test_daily_budget_must_be_sane(monkeypatch):
    db = _FakeDb()
    for bad in (0, 101):
        with pytest.raises(HTTPException) as exc:
            await issue_mandate_challenge(
                db,
                agent_id="agent-1",
                agent_wallet="0x" + "aa" * 20,
                chain_id=97,
                scopes=["attend_event"],
                max_runs_per_day=bad,
            )
        assert exc.value.status_code == 400


# ── the happy path ─────────────────────────────────────────────────────────


async def test_owner_can_grant_and_use_a_mandate(monkeypatch):
    owner = Account.create()
    db = _FakeDb()
    mandate = await _grant(db, monkeypatch, owner)

    assert mandate["owner_wallet"].lower() == owner.address.lower()
    assert mandate["scopes"] == ["attend_event"]
    assert mandate["ownership_epoch"] == 0

    used = await consume_mandate_run(
        db, agent_id="agent-1", chain_id=97, action="attend_event"
    )
    assert used["agent_id"] == "agent-1"


async def test_non_owner_cannot_grant(monkeypatch):
    owner = Account.create()
    stranger = Account.create()
    db = _FakeDb()
    db.agents["agent-1"] = {"agent_wallet": "0x" + "aa" * 20, "ownership_epoch": 0}
    _patch_owner(monkeypatch, owner.address)

    challenge = await issue_mandate_challenge(
        db,
        agent_id="agent-1",
        agent_wallet="0x" + "aa" * 20,
        chain_id=97,
        scopes=["attend_event"],
        max_runs_per_day=2,
    )
    signature = _sign(challenge["message"], stranger)

    with pytest.raises(HTTPException) as exc:
        await grant_mandate(db, nonce=challenge["nonce"], signature=signature)
    assert exc.value.status_code == 403


# ── the properties that make this safe ─────────────────────────────────────


async def test_sale_kills_the_mandate(monkeypatch):
    """Owner grants a mandate, then sells the agent. The mandate must stop
    working immediately, and it must say why it stopped."""
    owner = Account.create()
    buyer = Account.create()
    db = _FakeDb()
    await _grant(db, monkeypatch, owner)

    # The sale settles: the chain now reports a different owner.
    _patch_owner(monkeypatch, buyer.address)

    assert await active_mandate(
        db, agent_id="agent-1", chain_id=97, action="attend_event"
    ) is None

    stored = db.mandates["agent-1:97"]
    assert stored["revoked_at"]
    assert stored["revoked_reason"] == "agent changed hands"


async def test_sold_back_does_not_revive_the_mandate(monkeypatch):
    """Sold to a stranger and sold back to the original owner. Same owner
    address, different ownership epoch — the old mandate must stay dead."""
    owner = Account.create()
    db = _FakeDb()
    await _grant(db, monkeypatch, owner, epoch=0)

    # Sold away: the indexer bumps the epoch.
    db.agents["agent-1"]["ownership_epoch"] = 1
    # Sold back: the chain reports the original owner again.
    _patch_owner(monkeypatch, owner.address)

    assert await active_mandate(
        db, agent_id="agent-1", chain_id=97, action="attend_event"
    ) is None
    assert db.mandates["agent-1:97"]["revoked_reason"] == "ownership epoch changed"


async def test_daily_budget_is_enforced_then_resets(monkeypatch):
    owner = Account.create()
    db = _FakeDb()
    await _grant(db, monkeypatch, owner, max_runs=2)

    await consume_mandate_run(db, agent_id="agent-1", chain_id=97, action="attend_event")
    await consume_mandate_run(db, agent_id="agent-1", chain_id=97, action="attend_event")

    with pytest.raises(PermissionError) as exc:
        await consume_mandate_run(
            db, agent_id="agent-1", chain_id=97, action="attend_event"
        )
    assert "No active mandate" in str(exc.value)

    # A new UTC day resets the counter.
    db.mandates["agent-1:97"]["runs_day"] = "1999-01-01"
    ok = await consume_mandate_run(
        db, agent_id="agent-1", chain_id=97, action="attend_event"
    )
    assert ok["runs_day"] != "1999-01-01"


async def test_expired_mandate_is_not_usable(monkeypatch):
    owner = Account.create()
    db = _FakeDb()
    await _grant(db, monkeypatch, owner)
    db.mandates["agent-1:97"]["expires_at"] = 1.0  # long past

    assert await active_mandate(
        db, agent_id="agent-1", chain_id=97, action="attend_event"
    ) is None


async def test_scope_outside_the_mandate_is_refused(monkeypatch):
    owner = Account.create()
    db = _FakeDb()
    await _grant(db, monkeypatch, owner, scopes=["attend_event"])

    assert await active_mandate(
        db, agent_id="agent-1", chain_id=97, action="something_else"
    ) is None


async def test_owner_can_revoke(monkeypatch):
    owner = Account.create()
    db = _FakeDb()
    await _grant(db, monkeypatch, owner)

    assert await revoke_mandate(db, agent_id="agent-1", chain_id=97) is True
    assert await active_mandate(
        db, agent_id="agent-1", chain_id=97, action="attend_event"
    ) is None


async def test_unverifiable_ownership_blocks_the_mandate(monkeypatch):
    """If the chain cannot be read we must not act on a mandate we cannot
    check. A stale mandate is exactly what this guards against."""
    owner = Account.create()
    db = _FakeDb()
    await _grant(db, monkeypatch, owner)

    async def unreachable(_wallet, _chain):
        return None

    monkeypatch.setattr(
        "core.agent_auth._read_agent_owner_on_chain", unreachable
    )

    assert await active_mandate(
        db, agent_id="agent-1", chain_id=97, action="attend_event"
    ) is None


async def test_mandate_survives_a_normal_run(monkeypatch):
    """The everyday case: three runs across the day, budget 3, still working."""
    owner = Account.create()
    db = _FakeDb()
    await _grant(db, monkeypatch, owner, max_runs=3)

    for _ in range(3):
        assert await consume_mandate_run(
            db, agent_id="agent-1", chain_id=97, action="attend_event"
        ) is not None
    assert db.mandates["agent-1:97"]["runs_used_today"] == 3

async def test_request_to_sign_lapses_after_ten_minutes(monkeypatch):
    """The mandate lasts days, but the request to sign it must not: an unused
    signing request should not stay redeemable for a week."""
    import time as _time

    owner = Account.create()
    db = _FakeDb()
    db.agents["agent-1"] = {"agent_wallet": "0x" + "aa" * 20, "ownership_epoch": 0}
    _patch_owner(monkeypatch, owner.address)
    challenge = await issue_mandate_challenge(
        db, agent_id="agent-1", agent_wallet="0x" + "aa" * 20, chain_id=97,
        scopes=["attend_event"], max_runs_per_day=2,
    )
    signature = _sign(challenge["message"], owner)
    later = _time.time() + agent_mandate.MANDATE_CHALLENGE_TTL_SECONDS + 5
    monkeypatch.setattr(agent_mandate.time, "time", lambda: later)

    with pytest.raises(HTTPException) as exc:
        await grant_mandate(db, nonce=challenge["nonce"], signature=signature)
    assert exc.value.status_code == 401
