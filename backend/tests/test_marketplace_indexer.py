"""Tests for the marketplace ownership-transfer indexer.

We mock web3_service.get_event_logs + Firestore so the migration logic is
testable without a real chain. The point of these tests is the safety rails:
  - Agents are keyed by a hashed agent_id with the wallet in a FIELD, so the
    indexer must look them up by the agent_wallet field, not by document id.
  - Skip when Firestore user_wallet != event.previousOwner (someone edited)
  - Reassign pending proposals (keyed by the hashed agent_id) to new_owner
  - Mark an active marketplace listing sold once the transfer lands
  - Persist the new high-water-mark so we don't reprocess the same block range
  - Don't write to private_key_enc (we explicitly don't touch it)
"""

import pytest
from unittest.mock import patch

from services.marketplace_indexer import (
    _latest_processed_block,
    _migrate_transfer,
    poll_chain,
)


pytestmark = pytest.mark.asyncio


class FakeRef:
    def __init__(self, doc):
        self._doc = doc

    async def get(self):
        return self._doc

    async def update(self, data):
        await self._doc.update(data)

    async def set(self, data):
        await self._doc.set(data)


class FakeDoc:
    def __init__(self, data=None, exists=True, doc_id="doc"):
        self._data = data or {}
        self.exists = exists
        self.id = doc_id
        self.reference = FakeRef(self)

    def to_dict(self):
        return dict(self._data)

    async def update(self, data):
        self._data.update(data)
        self.exists = True

    async def set(self, data):
        self._data.update(data)
        self.exists = True


class FakeStream:
    def __init__(self, docs):
        self._docs = list(docs)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._docs:
            raise StopAsyncIteration
        return self._docs.pop(0)


class FakeQuery:
    def __init__(self, docs):
        self._docs = list(docs)

    def where(self, field, _op, value):
        return FakeQuery([d for d in self._docs if d.to_dict().get(field) == value])

    def limit(self, n):
        return FakeQuery(self._docs[:n])

    def stream(self):
        return FakeStream(self._docs)

    async def get(self):
        return list(self._docs)


class FakeCollection:
    def __init__(self):
        self._docs: dict[str, FakeDoc] = {}

    def add_doc(self, doc: FakeDoc):
        self._docs[doc.id] = doc

    def document(self, doc_id):
        if doc_id not in self._docs:
            self._docs[doc_id] = FakeDoc({}, exists=False, doc_id=doc_id)
        return self._docs[doc_id].reference

    def where(self, field, _op, value):
        return FakeQuery([d for d in self._docs.values() if d.to_dict().get(field) == value])


class FakeFirestore:
    def __init__(self):
        self.collection_docs: dict[str, FakeCollection] = {}

    def collection(self, name):
        if name not in self.collection_docs:
            self.collection_docs[name] = FakeCollection()
        return self.collection_docs[name]


def _agent_doc(user_wallet: str, agent_wallet: str, doc_id: str = "agenthash01") -> FakeDoc:
    return FakeDoc(
        {
            "user_wallet": user_wallet,
            "agent_wallet": agent_wallet,
            "private_key_enc": "ENCRYPTED_BLOB",
        },
        doc_id=doc_id,
    )


async def test_migrate_transfer_updates_user_wallet():
    firestore = FakeFirestore()
    agent_wallet = "0x" + "a" * 40
    previous = "0x" + "1" * 40
    new = "0x" + "2" * 40
    agent = _agent_doc(previous, agent_wallet, doc_id="agenthash01")
    firestore.collection("agents").add_doc(agent)

    with patch("services.marketplace_indexer.get_db", return_value=firestore):
        result = await _migrate_transfer(agent_wallet, new, previous_owner_event=previous)

    assert result["migrated_agent"] == 1
    assert result["migrated_proposals"] == 0
    # The agent is found by its wallet field even though the doc id is a hash.
    assert agent.to_dict()["user_wallet"] == new
    # On-chain signing material is never touched.
    assert agent.to_dict()["private_key_enc"] == "ENCRYPTED_BLOB"


async def test_migrate_transfer_reassigns_proposals_by_agent_id():
    firestore = FakeFirestore()
    agent_wallet = "0x" + "a" * 40
    previous = "0x" + "1" * 40
    new = "0x" + "2" * 40
    firestore.collection("agents").add_doc(_agent_doc(previous, agent_wallet, doc_id="agenthash01"))
    # Proposals are keyed by the hashed agent_id (the doc id), not the wallet.
    prop = FakeDoc({"agent_id": "agenthash01", "title": "P1"}, doc_id="prop1")
    firestore.collection("proposals").add_doc(prop)

    with patch("services.marketplace_indexer.get_db", return_value=firestore):
        result = await _migrate_transfer(agent_wallet, new, previous_owner_event=previous)

    assert result["migrated_proposals"] == 1
    assert prop.to_dict()["owner_wallet_at_proposal"] == new


async def test_migrate_transfer_marks_active_listing_sold():
    firestore = FakeFirestore()
    agent_wallet = "0x" + "a" * 40
    previous = "0x" + "1" * 40
    new = "0x" + "2" * 40
    firestore.collection("agents").add_doc(_agent_doc(previous, agent_wallet, doc_id="agenthash01"))
    listing = FakeDoc({"status": "active", "price": 1.5}, doc_id="agenthash01")
    firestore.collection("marketplace_listings").add_doc(listing)

    with patch("services.marketplace_indexer.get_db", return_value=firestore):
        result = await _migrate_transfer(agent_wallet, new, previous_owner_event=previous)

    assert result["listings_sold"] == 1
    assert listing.to_dict()["status"] == "sold"
    assert listing.to_dict()["sold_to"] == new


async def test_migrate_transfer_skips_when_firestore_owner_mismatch():
    firestore = FakeFirestore()
    agent_wallet = "0x" + "a" * 40
    event_previous = "0x" + "1" * 40
    firestore_previous = "0x" + "9" * 40  # someone edited Firestore manually
    new = "0x" + "2" * 40
    agent = _agent_doc(firestore_previous, agent_wallet, doc_id="agenthash01")
    firestore.collection("agents").add_doc(agent)

    with patch("services.marketplace_indexer.get_db", return_value=firestore):
        result = await _migrate_transfer(agent_wallet, new, previous_owner_event=event_previous)

    # Should NOT overwrite; just skip with a warning
    assert result["skipped"] == 1
    assert agent.to_dict()["user_wallet"] == firestore_previous


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
    firestore.collection("agents").add_doc(_agent_doc(previous_owner, agent_wallet, doc_id="agenthash01"))

    # Set high-water mark to current block so we don't reprocess old events
    firestore.collection("marketplace_indexer_state").add_doc(
        FakeDoc({"last_processed_block": 100}, doc_id="chain_97")
    )

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
        mock_web3.get_block_number = _block_number(101)
        summary = await poll_chain(97)

    assert captured["call"]["event_name"] == "AgentOwnershipTransferred"
    assert captured["call"]["chain_id"] == 97
    assert captured["call"]["from_block"] == 101
    assert summary["logs"] == 1
    assert summary["migrated_agent"] == 1
    # High-water mark should advance
    assert firestore.collection_docs["marketplace_indexer_state"]._docs["chain_97"].to_dict()["last_processed_block"] == 101


def _block_number(n):
    async def get_block_number(chain_id):
        return n
    return get_block_number


async def test_poll_chain_advances_through_empty_blocks():
    """No events must still move the watermark, or every poll rescans the same range."""
    firestore = FakeFirestore()
    firestore.collection("marketplace_indexer_state").add_doc(
        FakeDoc({"last_processed_block": 100}, doc_id="chain_97")
    )

    async def fake_get_event_logs(**kwargs):
        return []

    with patch("services.marketplace_indexer.get_db", return_value=firestore), \
         patch("services.marketplace_indexer.web3_service") as mock_web3:
        mock_web3.get_event_logs = fake_get_event_logs
        mock_web3.get_block_number = _block_number(150)
        summary = await poll_chain(97)

    assert summary["logs"] == 0
    assert firestore.collection_docs["marketplace_indexer_state"]._docs["chain_97"].to_dict()["last_processed_block"] == 150


async def test_poll_chain_skips_zero_address_new_owner():
    """The mint path emits Transfer with newOwner=address(0). Filter that out."""
    firestore = FakeFirestore()
    firestore.collection("marketplace_indexer_state").add_doc(
        FakeDoc({"last_processed_block": 100}, doc_id="chain_97")
    )
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
        mock_web3.get_block_number = _block_number(101)
        summary = await poll_chain(97)

    assert summary["logs"] == 1
    assert summary["migrated_agent"] == 0
    assert summary["skipped"] == 0
    # High-water mark still advances (event was processed, just zero-skip)
    assert firestore.collection_docs["marketplace_indexer_state"]._docs["chain_97"].to_dict()["last_processed_block"] == 101


# ── Escrow listing scan ──────────────────────────────────────────────────────

from services import marketplace_indexer as mi  # noqa: E402


class FakeListingChain:
    """Escrow log reader that records every range it is asked for."""

    def __init__(self, latest, logs_by_block=None, fail_from=None):
        self.latest = latest
        self.logs_by_block = logs_by_block or {}
        self.fail_from = fail_from
        self.ranges: list[tuple[int, int]] = []

    async def get_block_number(self, chain_id):
        return self.latest

    async def get_marketplace_event_logs(self, event_name, *, chain_id, from_block, to_block):
        assert event_name == "AgentListed"
        if self.fail_from is not None and from_block >= self.fail_from:
            raise ConnectionError("range too large")
        self.ranges.append((from_block, to_block))
        return [
            {"blockNumber": b, "args": {"agentWallet": w}}
            for b, w in self.logs_by_block.items()
            if from_block <= b <= to_block
        ]


def _patch_listing_scan(firestore, chain, recorded, reconciled):
    async def fake_record(agent_wallet):
        recorded.append(agent_wallet)
        return {"status": "active"}

    async def fake_reconcile(chain_id=None):
        reconciled.append(chain_id)
        return {"checked": 0, "still_active": 0, "closed": 0, "errors": 0}

    return (
        patch("services.marketplace_indexer.get_db", return_value=firestore),
        patch("services.marketplace_indexer.web3_service", chain),
        patch("services.marketplace_indexer.record_listed_event", fake_record),
        patch("services.marketplace_indexer.reconcile_active_listings", fake_reconcile),
    )


async def test_listing_scan_walks_bounded_windows_from_watermark():
    firestore = FakeFirestore()
    firestore.collection("marketplace_indexer_state").add_doc(
        FakeDoc({"last_processed_block": 1_000}, doc_id="listings_97")
    )
    chain = FakeListingChain(latest=1_000 + 2 * mi.LISTING_SCAN_CHUNK + 10, logs_by_block={1_500: "0x" + "a" * 40})
    recorded, reconciled = [], []
    p1, p2, p3, p4 = _patch_listing_scan(firestore, chain, recorded, reconciled)
    with p1, p2, p3, p4:
        summary = await mi.poll_marketplace_listings(97)

    assert chain.ranges[0] == (1_001, 1_000 + mi.LISTING_SCAN_CHUNK)
    assert all(end - start + 1 <= mi.LISTING_SCAN_CHUNK for start, end in chain.ranges)
    assert chain.ranges[-1][1] == chain.latest
    assert recorded == ["0x" + "a" * 40]
    assert reconciled == [97]
    assert summary["listed_logs"] == 1
    state = firestore.collection_docs["marketplace_indexer_state"]._docs["listings_97"].to_dict()
    assert state["last_processed_block"] == chain.latest


async def test_listing_scan_first_run_starts_at_lookback_not_genesis():
    firestore = FakeFirestore()
    chain = FakeListingChain(latest=mi.LISTING_SCAN_LOOKBACK + 50)
    recorded, reconciled = [], []
    p1, p2, p3, p4 = _patch_listing_scan(firestore, chain, recorded, reconciled)
    with p1, p2, p3, p4:
        await mi.poll_marketplace_listings(97)
    assert chain.ranges[0][0] == 50


async def test_listing_scan_keeps_progress_when_a_window_fails():
    firestore = FakeFirestore()
    firestore.collection("marketplace_indexer_state").add_doc(
        FakeDoc({"last_processed_block": 0 + 10}, doc_id="listings_97")
    )
    fail_from = 11 + mi.LISTING_SCAN_CHUNK
    chain = FakeListingChain(latest=10 + 3 * mi.LISTING_SCAN_CHUNK, fail_from=fail_from)
    recorded, reconciled = [], []
    p1, p2, p3, p4 = _patch_listing_scan(firestore, chain, recorded, reconciled)
    with p1, p2, p3, p4:
        summary = await mi.poll_marketplace_listings(97)
    assert summary["errors"] == 1
    state = firestore.collection_docs["marketplace_indexer_state"]._docs["listings_97"].to_dict()
    assert state["last_processed_block"] == 10 + mi.LISTING_SCAN_CHUNK  # first window kept
    assert reconciled == [97]  # active rows are still re-checked


async def test_listing_scan_skips_chain_without_escrow():
    firestore = FakeFirestore()
    chain = FakeListingChain(latest=100)
    recorded, reconciled = [], []
    p1, p2, p3, p4 = _patch_listing_scan(firestore, chain, recorded, reconciled)
    with p1, p2, p3, p4:
        summary = await mi.poll_marketplace_listings(5003)
    assert summary == {"skipped": 1}
    assert chain.ranges == []


async def test_poll_chain_first_run_scans_bounded_chunks_from_lookback():
    """Never asked for logs from genesis: public RPCs refuse that range, and the
    indexer had never once completed in production."""
    from services.marketplace_indexer import (
        LISTING_SCAN_CHUNK,
        LISTING_SCAN_LOOKBACK,
        LISTING_SCAN_MAX_CHUNKS_PER_POLL,
    )

    firestore = FakeFirestore()
    calls = []

    async def fake_get_event_logs(event_name, *, chain_id, from_block, to_block, argument_filters):
        calls.append((from_block, to_block))
        return []

    latest = 10_000_000
    with patch("services.marketplace_indexer.get_db", return_value=firestore),          patch("services.marketplace_indexer.web3_service") as mock_web3:
        mock_web3.get_event_logs = fake_get_event_logs
        mock_web3.get_block_number = _block_number(latest)
        await poll_chain(97)

    assert calls[0][0] == latest - LISTING_SCAN_LOOKBACK
    assert all(end - start + 1 <= LISTING_SCAN_CHUNK for start, end in calls)
    assert len(calls) == LISTING_SCAN_MAX_CHUNKS_PER_POLL
    saved = firestore.collection_docs["marketplace_indexer_state"]._docs["chain_97"].to_dict()["last_processed_block"]
    assert saved == calls[-1][1]


async def test_poll_chain_keeps_progress_when_a_chunk_fails():
    firestore = FakeFirestore()
    firestore.collection("marketplace_indexer_state").add_doc(FakeDoc({"last_processed_block": 1000}, doc_id="chain_97"))
    async def flaky(event_name, *, chain_id, from_block, to_block, argument_filters):
        if from_block > 6000:  # this range keeps failing, even at the smallest window
            raise RuntimeError("rpc")
        return []

    with patch("services.marketplace_indexer.get_db", return_value=firestore),          patch("services.marketplace_indexer.web3_service") as mock_web3:
        mock_web3.get_event_logs = flaky
        mock_web3.get_block_number = _block_number(1_000_000)
        summary = await poll_chain(97)

    assert summary["errors"] == 1
    saved = firestore.collection_docs["marketplace_indexer_state"]._docs["chain_97"].to_dict()["last_processed_block"]
    assert saved == 1000 + 5_000  # the first chunk is kept, the failed one is retried next poll


async def test_poll_chain_narrows_the_window_for_a_strict_rpc():
    """Some public RPCs refuse wide getLogs ranges; the scan halves and goes on."""
    firestore = FakeFirestore()
    firestore.collection("marketplace_indexer_state").add_doc(FakeDoc({"last_processed_block": 1000}, doc_id="chain_97"))
    spans = []

    async def strict(event_name, *, chain_id, from_block, to_block, argument_filters):
        if to_block - from_block + 1 > 1250:
            raise ValueError("block range too large")
        spans.append(to_block - from_block + 1)
        return []

    with patch("services.marketplace_indexer.get_db", return_value=firestore),          patch("services.marketplace_indexer.web3_service") as mock_web3:
        mock_web3.get_event_logs = strict
        mock_web3.get_block_number = _block_number(1000 + 3 * 1250)
        summary = await poll_chain(97)

    assert summary["errors"] == 0
    assert spans == [1250, 1250, 1250]
    saved = firestore.collection_docs["marketplace_indexer_state"]._docs["chain_97"].to_dict()["last_processed_block"]
    assert saved == 1000 + 3 * 1250


async def test_pruned_history_window_is_skipped_not_retried():
    """Sepolia's public RPC answers {'code': 4444, 'message': 'pruned history
    unavailable'} for old ranges; production retried the same window every poll."""
    calls = []

    async def fetch(start, end):
        calls.append((start, end))
        raise ValueError({"code": 4444, "message": "pruned history unavailable"})

    logs, end = await mi._fetch_window(fetch, 11155111, 11_785_819, 11_900_000, "ownership scan")
    assert logs == [] and end == 11_785_819 + mi.LISTING_SCAN_CHUNK - 1
    assert len(calls) == 1  # no halving loop for an unrecoverable range
