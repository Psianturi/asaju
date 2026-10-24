"""
Tests for the agent action authorization boundary.

The scenario that matters: an agent gets sold through the marketplace escrow.
The buyer's signature must work immediately; the seller's must not — without
waiting for the indexer to catch up.

These tests pin that behaviour at the helper level (no network, no Firestore
server) so the rule is enforced before it is ever exercised against a live
chain.
"""
import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import HTTPException

from core import agent_auth


pytestmark = pytest.mark.asyncio


class _FakeDoc:
    def __init__(self, data):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data or {})

    async def update(self, data):
        self._data.update(data)


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


class _FakeCollection:
    def __init__(self, store):
        self._store = store

    def document(self, doc_id):
        return _FakeRef(self._store, doc_id)


class _FakeDb:
    def __init__(self):
        self.challenges = {}
        self.agents = {}

    def collection(self, name):
        if name == agent_auth.AGENT_AUTH_CHALLENGES_COLLECTION:
            return _FakeCollection(self.challenges)
        if name == "agents":
            return _FakeCollection(self.agents)
        raise AssertionError(f"unexpected collection {name}")

    def seed_agent(self, agent_id: str, agent_wallet: str, user_wallet: str = ""):
        self.agents[agent_id] = {
            "agent_wallet": agent_wallet,
            "user_wallet": user_wallet,
        }


def _sign(message: str, signer) -> str:
    return Account.sign_message(
        encode_defunct(text=message), signer.key
    ).signature.hex()


async def _issue(db, agent_id, agent_wallet, action="attend_event", chain_id=97):
    """Issue a challenge and seed the matching agent document.

    require_agent_owner binds the agent_id to the wallet recorded on the
    document, so a challenge can only be verified against an agent that
    actually exists. Seeding here keeps every test honest about that.
    """
    db.seed_agent(agent_id, agent_wallet)
    return await agent_auth.issue_agent_auth_challenge(
        db,
        agent_id=agent_id,
        agent_wallet=agent_wallet,
        action=action,
        chain_id=chain_id,
    )


def _patch_chain_owner(monkeypatch, owner: str):
    async def fake_read(agent_wallet, chain_id):
        return owner

    monkeypatch.setattr(agent_auth, "_read_agent_owner_on_chain", fake_read)


async def test_current_owner_wins_after_sale(monkeypatch):
    """The buyer signs after the sale and is accepted."""
    db = _FakeDb()
    buyer = Account.create()
    _patch_chain_owner(monkeypatch, buyer.address)

    ch = await _issue(db, "agent-1", "0x" + "11" * 20)
    owner = await agent_auth.require_agent_owner(
        db,
        agent_id="agent-1",
        agent_wallet="0x" + "11" * 20,
        action="attend_event",
        chain_id=97,
        nonce=ch["nonce"],
        signature=_sign(ch["message"], buyer),
    )
    assert owner.lower() == buyer.address.lower()


async def test_previous_owner_is_locked_out_immediately(monkeypatch):
    """The seller signed a challenge before the sale. After the chain records
    the new owner, that same signature must be refused — no indexer wait."""
    db = _FakeDb()
    seller = Account.create()
    buyer = Account.create()

    # Seller gets a challenge while they still own it.
    _patch_chain_owner(monkeypatch, seller.address)
    ch = await _issue(db, "agent-1", "0x" + "11" * 20)
    seller_sig = _sign(ch["message"], seller)

    # Sale settles: agentOwner now points at the buyer.
    _patch_chain_owner(monkeypatch, buyer.address)

    with pytest.raises(HTTPException) as exc:
        await agent_auth.require_agent_owner(
            db,
            agent_id="agent-1",
            agent_wallet="0x" + "11" * 20,
            action="attend_event",
            chain_id=97,
            nonce=ch["nonce"],
            signature=seller_sig,
        )
    assert exc.value.status_code == 403
    assert "changed hands" in exc.value.detail


async def test_challenge_cannot_be_replayed(monkeypatch):
    """A signature is single-use even by the correct owner."""
    db = _FakeDb()
    owner = Account.create()
    _patch_chain_owner(monkeypatch, owner.address)

    ch = await _issue(db, "agent-1", "0x" + "11" * 20)
    sig = _sign(ch["message"], owner)

    await agent_auth.require_agent_owner(
        db,
        agent_id="agent-1",
        agent_wallet="0x" + "11" * 20,
        action="attend_event",
        chain_id=97,
        nonce=ch["nonce"],
        signature=sig,
    )

    with pytest.raises(HTTPException) as exc:
        await agent_auth.require_agent_owner(
            db,
            agent_id="agent-1",
            agent_wallet="0x" + "11" * 20,
            action="attend_event",
            chain_id=97,
            nonce=ch["nonce"],
            signature=sig,
        )
    assert exc.value.status_code == 401


async def test_signature_is_scoped_to_one_action(monkeypatch):
    """A signature harvested for one action cannot authorise another."""
    db = _FakeDb()
    owner = Account.create()
    _patch_chain_owner(monkeypatch, owner.address)

    ch = await _issue(db, "agent-1", "0x" + "11" * 20, action="attend_event")
    sig = _sign(ch["message"], owner)

    with pytest.raises(HTTPException) as exc:
        await agent_auth.require_agent_owner(
            db,
            agent_id="agent-1",
            agent_wallet="0x" + "11" * 20,
            action="mint",
            chain_id=97,
            nonce=ch["nonce"],
            signature=sig,
        )
    assert exc.value.status_code == 401


async def test_signature_is_scoped_to_one_chain(monkeypatch):
    """A signature captured on one chain is not valid on another."""
    db = _FakeDb()
    owner = Account.create()
    _patch_chain_owner(monkeypatch, owner.address)

    ch = await _issue(db, "agent-1", "0x" + "11" * 20, chain_id=97)
    sig = _sign(ch["message"], owner)

    with pytest.raises(HTTPException) as exc:
        await agent_auth.require_agent_owner(
            db,
            agent_id="agent-1",
            agent_wallet="0x" + "11" * 20,
            action="attend_event",
            chain_id=5003,
            nonce=ch["nonce"],
            signature=sig,
        )
    assert exc.value.status_code == 401


async def test_unknown_nonce_is_refused(monkeypatch):
    db = _FakeDb()
    owner = Account.create()
    _patch_chain_owner(monkeypatch, owner.address)
    ch = await _issue(db, "agent-1", "0x" + "11" * 20)

    with pytest.raises(HTTPException) as exc:
        await agent_auth.require_agent_owner(
            db,
            agent_id="agent-1",
            agent_wallet="0x" + "11" * 20,
            action="attend_event",
            chain_id=97,
            nonce="not-a-real-nonce",
            signature=_sign(ch["message"], owner),
        )
    assert exc.value.status_code == 401


async def test_expired_challenge_is_refused(monkeypatch):
    db = _FakeDb()
    owner = Account.create()
    _patch_chain_owner(monkeypatch, owner.address)

    ch = await _issue(db, "agent-1", "0x" + "11" * 20)
    sig = _sign(ch["message"], owner)
    db.challenges[ch["nonce"]]["expires_at"] = 1.0  # long past

    with pytest.raises(HTTPException) as exc:
        await agent_auth.require_agent_owner(
            db,
            agent_id="agent-1",
            agent_wallet="0x" + "11" * 20,
            action="attend_event",
            chain_id=97,
            nonce=ch["nonce"],
            signature=sig,
        )
    assert exc.value.status_code == 401


async def test_owner_read_from_chain_beats_stale_firestore(monkeypatch):
    """When the chain is readable, its answer wins over the Firestore mirror.
    This is what makes a sale take effect without waiting for the indexer."""
    db = _FakeDb()
    buyer = Account.create()
    # Firestore still says the seller owns it (indexer has not caught up).
    db.agents["agent-1"] = {"user_wallet": "0x" + "22" * 20}
    _patch_chain_owner(monkeypatch, buyer.address)

    owner = await agent_auth.current_owner_of(
        db, "agent-1", "0x" + "11" * 20, 97
    )
    assert owner.lower() == buyer.address.lower()


async def test_firestore_used_when_chain_unreachable(monkeypatch):
    """Legacy chains with no agentOwner getter still resolve via Firestore, and
    the fallback is logged so it is never silent."""
    db = _FakeDb()
    db.seed_agent("agent-1", "0x" + "11" * 20, user_wallet="0x" + "22" * 20)

    async def unreachable(agent_wallet, chain_id):
        return None

    monkeypatch.setattr(agent_auth, "_read_agent_owner_on_chain", unreachable)

    owner = await agent_auth.current_owner_of(db, "agent-1", "0x" + "11" * 20, 5003)
    assert owner.lower() == ("0x" + "22" * 20).lower()


# ── The bypass the audit found ────────────────────────────────────────────────
# agent_id selects which document supplies the key that gets decrypted;
# agent_wallet is what the ownership check runs against. If the two are not
# bound, an attacker who owns *any* agent can submit a victim's agent_id with
# their own wallet, pass the on-chain owner check, and have the platform sign
# with the victim's key.


async def test_mismatched_agent_wallet_is_rejected(monkeypatch):
    """Attacker owns wallet Wx and points the check at itself while naming a
    victim's agent_id. Must be refused."""
    db = _FakeDb()
    attacker = Account.create()
    victim_wallet = "0x" + "44" * 20
    attacker_wallet = attacker.address

    # The victim agent exists and records a different wallet.
    db.seed_agent("victim-agent", victim_wallet, user_wallet=victim_wallet)
    _patch_chain_owner(monkeypatch, attacker_wallet)

    ch = await _issue(db, "victim-agent", victim_wallet)
    # But the caller submits their own wallet alongside the victim's agent_id.
    with pytest.raises(HTTPException) as exc:
        await agent_auth.require_agent_owner(
            db,
            agent_id="victim-agent",
            agent_wallet=attacker_wallet,
            action="attend_event",
            chain_id=97,
            nonce=ch["nonce"],
            signature=_sign(ch["message"], attacker),
        )
    assert exc.value.status_code == 400
    assert "does not match" in exc.value.detail


async def test_unknown_agent_id_cannot_be_signed_for(monkeypatch):
    """No document, no authorisation — regardless of what the caller claims."""
    db = _FakeDb()
    attacker = Account.create()
    _patch_chain_owner(monkeypatch, attacker.address)

    ch = await agent_auth.issue_agent_auth_challenge(
        db,
        agent_id="ghost-agent",
        agent_wallet="0x" + "55" * 20,
        action="attend_event",
        chain_id=97,
    )
    with pytest.raises(HTTPException) as exc:
        await agent_auth.require_agent_owner(
            db,
            agent_id="ghost-agent",
            agent_wallet="0x" + "55" * 20,
            action="attend_event",
            chain_id=97,
            nonce=ch["nonce"],
            signature=_sign(ch["message"], attacker),
        )
    assert exc.value.status_code == 404


async def test_transferable_chain_fails_closed_when_chain_unreachable(monkeypatch):
    """A marketplace chain must never authorise from the stale Firestore mirror.
    If the chain cannot be read we refuse rather than guess."""
    db = _FakeDb()
    db.seed_agent("agent-1", "0x" + "11" * 20, user_wallet="0x" + "22" * 20)

    async def unreachable(agent_wallet, chain_id):
        return None

    monkeypatch.setattr(agent_auth, "_read_agent_owner_on_chain", unreachable)

    for chain_id in (97, 11155111, 46630):
        with pytest.raises(HTTPException) as exc:
            await agent_auth.current_owner_of(db, "agent-1", "0x" + "11" * 20, chain_id)
        assert exc.value.status_code == 503