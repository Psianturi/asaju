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


def _sign(message: str, signer) -> str:
    return Account.sign_message(
        encode_defunct(text=message), signer.key
    ).signature.hex()


async def _issue(db, agent_id, agent_wallet, action="attend_event", chain_id=97):
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
    db.agents["agent-1"] = {"user_wallet": "0x" + "22" * 20}

    async def unreachable(agent_wallet, chain_id):
        return None

    monkeypatch.setattr(agent_auth, "_read_agent_owner_on_chain", unreachable)

    owner = await agent_auth.current_owner_of(db, "agent-1", "0x" + "11" * 20, 5003)
    assert owner.lower() == ("0x" + "22" * 20).lower()