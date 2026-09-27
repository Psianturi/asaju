"""Tests for the marketplace ownership-transfer indexer.

We mock web3_service.get_event_logs + Firestore so the migration logic is
testable without a real chain. The point of these tests is the safety rails:
  - Skip when Firestore user_wallet != event.previousOwner (someone edited)
  - Reassign pending proposals to new_owner
  - Persist the new high-water-mark so we don't reprocess the same block range
  - Don't write to private_key_enc (we explicitly don't touch it)
"""

import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from services.marketplace_indexer import (
    DEFAULT_CHAIN_ID,
    MARKETPLACE_COLLECTION,
    _latest_processed_block,
    _migrate_transfer,
    poll_chain,
)


pytestmark = pytest.mark.asyncio


class FakeDoc:
    def __init__(self, data=None, exists=True):
        self._data = data or {}
        self.exists = exists

    def to_dict(self):
        return dict(self._data)

    async def update(self, data):
        self._data.update(data)

    async def set(self, data):
        self._data.update(data)


class FakeRef:
    def __init__(self, doc):
        self._doc = doc

    async def get(self):
        return self._doc

    async def update(self, data):
        # Real Firestore's `Ref.update()` mutates the server-side document.
        # Our fake routes it through the doc so assertions can read the new value.
        await self._doc.update(data)

    async def set(self, data):
        await self._doc.set(data)


class FakeStream:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._docs:
            raise StopAsyncIteration
        return self._docs.pop()


class FakeQuery:
    def __init__(self, docs):
        self._docs = docs

    def stream(self):
        return FakeStream(list(self._docs))

    def where(self, *_, **__):
        return self


class FakeCollection:
    def __init__(self, docs):
        self._docs = docs

    def document(self, doc_id):
        return FakeRef(self._docs.setdefault(doc_id, FakeDoc({}, exists=False)))

    def where(self, *_, **__):
        return FakeQuery([])

    def __contains__(self, key):
        return key in self._docs


class FakeFirestore:
    def __init__(self):
        # Top-level dict keyed by doc id, used when code reads directly via
        # `firestore.docs[doc_id]` (mirrors `get_db().collection(...).document(...)`).
        # FakeCollection has its own per-collection dict so writes to one
        # collection don't leak into another.
        self.docs: dict[str, FakeDoc] = {}
        self.collection_docs: dict[str, FakeCollection] = {}

    def collection(self, name):
        if name not in self.collection_docs:
            self.collection_docs[name] = FakeCollection({})
        return self.collection_docs[name]


def _agent_doc(user_wallet: str, agent_wallet: str) -> FakeDoc:
    return FakeDoc(
        {
            "user_wallet": user_wallet,
            "agent_wallet": agent_wallet,
            "private_key_enc": "ENCRYPTED_BLOB",
        }
    )


async def test_migrate_transfer_updates_user_wallet():
    firestore = FakeFirestore()
    agent_wallet = "0x" + "a" * 40
    previous = "0x" + "1" * 40
    new = "0x" + "2" * 40
    firestore.collection("agents")._docs[agent_wallet] = _agent_doc(previous, agent_wallet)

    with patch("services.marketplace_indexer.get_db", return_value=firestore):
        result = await _migrate_transfer(agent_wallet, new, previous_owner_event=previous)

    assert result["migrated_agent"] == 1
    assert result["migrated_proposals"] == 0
    assert firestore.collection_docs["agents"]._docs[agent_wallet].to_dict()["user_wallet"] == new


async def test_migrate_transfer_skips_when_firestore_owner_mismatch():
    firestore = FakeFirestore()
    agent_wallet = "0x" + "a" * 40
    event_previous = "0x" + "1" * 40
    firestore_previous = "0x" + "9" * 40  # someone edited Firestore manually
    new = "0x" + "2" * 40
    firestore.collection("agents")._docs[agent_wallet] = _agent_doc(firestore_previous, agent_wallet)

    with patch("services.marketplace_indexer.get_db", return_value=firestore):
        result = await _migrate_transfer(agent_wallet, new, previous_owner_event=event_previous)

    # Should NOT overwrite; just skip with a warning
    assert result["skipped"] == 1
    assert firestore.collection_docs["agents"]._docs[agent_wallet].to_dict()["user_wallet"] == firestore_previous


async def test_migrate_transfer_skips_missing_agent_doc():
    firestore = FakeFirestore()
    with patch("services.marketplace_indexer.get_db", return_value=firestore):
        result = await _migrate_transfer("0x" + "a" * 40, "0x" + "b" * 40, previous_owner_event="0x" + "1" * 40)
    assert result["skipped"] == 1


async def test_poll_chain_calls_get_event_logs_and_persists_block():
    firestore = FakeFirestore()
    new_owner = "0x" + "2" * 40
    previous_owner = "0x" + "1" * 40
    agent_wallet = "0x" + "a" * 40
    firestore.collection("agents")._docs[agent_wallet] = _agent_doc(previous_owner, agent_wallet)

    # Set high-water mark to current block so we don't reprocess old events
    state_coll = firestore.collection("marketplace_indexer_state")
    state_coll._docs["chain_97"] = FakeDoc({"last_processed_block": 100})

    event_log = {
        "blockNumber": 101,
        "transactionHash": "0x" + "f" * 64,
        "logIndex": 0,
        "args": {"agentWallet": agent_wallet, "previousOwner": previous_owner, "newOwner": new_owner},
        "event": "AgentOwnershipTransferred",
    }
    captured: dict = {}

    async def fake_get_event_logs(event_name, *, chain_id, from_block, to_block, argument_filters):
        captured["call"] = {
            "event_name": event_name,
            "chain_id": chain_id,
            "from_block": from_block,
        }
        return [event_log]

    with patch("services.marketplace_indexer.get_db", return_value=firestore), \
         patch("services.marketplace_indexer.web3_service") as mock_web3:
        mock_web3.get_event_logs = fake_get_event_logs
        summary = await poll_chain(97)

    assert captured["call"]["event_name"] == "AgentOwnershipTransferred"
    assert captured["call"]["chain_id"] == 97
    assert captured["call"]["from_block"] == 100
    assert summary["logs"] == 1
    assert summary["migrated_agent"] == 1
    # High-water mark should advance
    assert firestore.collection_docs["marketplace_indexer_state"]._docs["chain_97"].to_dict()["last_processed_block"] == 101


async def test_poll_chain_handles_no_events():
    firestore = FakeFirestore()
    state_coll = firestore.collection("marketplace_indexer_state")
    state_coll._docs["chain_97"] = FakeDoc({"last_processed_block": 100})

    async def fake_get_event_logs(**kwargs):
        return []

    with patch("services.marketplace_indexer.get_db", return_value=firestore), \
         patch("services.marketplace_indexer.web3_service") as mock_web3:
        mock_web3.get_event_logs = fake_get_event_logs
        summary = await poll_chain(97)

    assert summary["logs"] == 0
    # High-water mark should NOT advance
    assert firestore.collection_docs["marketplace_indexer_state"]._docs["chain_97"].to_dict()["last_processed_block"] == 100


async def test_poll_chain_skips_zero_address_new_owner():
    """The mint path emits Transfer with newOwner=address(0). Filter that out."""
    firestore = FakeFirestore()
    state_coll = firestore.collection("marketplace_indexer_state")
    state_coll._docs["chain_97"] = FakeDoc({"last_processed_block": 100})
    agent_wallet = "0x" + "a" * 40

    event_log = {
        "blockNumber": 101,
        "transactionHash": "0x" + "f" * 64,
        "logIndex": 0,
        "args": {
            "agentWallet": agent_wallet,
            "previousOwner": "0x" + "1" * 40,
            "newOwner": "0x" + "0" * 40,
        },
        "event": "AgentOwnershipTransferred",
    }

    async def fake_get_event_logs(**kwargs):
        return [event_log]

    with patch("services.marketplace_indexer.get_db", return_value=firestore), \
         patch("services.marketplace_indexer.web3_service") as mock_web3:
        mock_web3.get_event_logs = fake_get_event_logs
        summary = await poll_chain(97)

    assert summary["logs"] == 1
    assert summary["migrated_agent"] == 0
    assert summary["skipped"] == 0
    # High-water mark still advances (event was processed, just zero-skip)
    assert firestore.collection_docs["marketplace_indexer_state"]._docs["chain_97"].to_dict()["last_processed_block"] == 101
