"""Tests for the marketplace listings store (Fase 1 — no escrow)."""

import pytest
from unittest.mock import patch

from services import marketplace_listings as ml
from services.marketplace_listings import (
    ListingError,
    cancel_listing,
    create_listing,
    get_active_listings,
)

pytestmark = pytest.mark.asyncio


class FakeRef:
    def __init__(self, doc):
        self._doc = doc

    async def get(self):
        return self._doc

    async def set(self, data):
        self._doc._data = dict(data)
        self._doc.exists = True

    async def update(self, data):
        self._doc._data.update(data)


class FakeDoc:
    def __init__(self, data=None, exists=True, doc_id="doc"):
        self._data = data or {}
        self.exists = exists
        self.id = doc_id
        self.reference = FakeRef(self)

    def to_dict(self):
        return dict(self._data)


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

    def stream(self):
        return FakeStream(self._docs)


class FakeCollection:
    def __init__(self):
        self._docs: dict[str, FakeDoc] = {}

    def add_doc(self, doc):
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


def _seed_agent(fs, agent_id, owner, chain_id=97):
    fs.collection(ml.AGENTS_COLLECTION).add_doc(
        FakeDoc(
            {
                "agent_id": agent_id,
                "agent_wallet": "0x" + "a" * 40,
                "user_wallet": owner,
                "agent_name": "Testy",
                "niche": "Technology",
                "personality": "Aggressive",
                "level": 3,
                "total_events": 6,
                "wisdom_unlocked": True,
                "chain_id": chain_id,
            },
            doc_id=agent_id,
        )
    )


async def test_create_listing_success_copies_snapshot():
    fs = FakeFirestore()
    owner = "0x" + "1" * 40
    _seed_agent(fs, "hash1", owner)
    with patch("services.marketplace_listings.get_db", return_value=fs):
        listing = await create_listing("hash1", owner, 2.5)
    assert listing["status"] == "active"
    assert listing["price"] == 2.5
    assert listing["agent_name"] == "Testy"
    assert listing["personality"] == "Aggressive"
    assert listing["chain_id"] == 97


async def test_create_listing_rejects_non_owner():
    fs = FakeFirestore()
    _seed_agent(fs, "hash1", "0x" + "1" * 40)
    with patch("services.marketplace_listings.get_db", return_value=fs):
        with pytest.raises(ListingError):
            await create_listing("hash1", "0x" + "2" * 40, 2.5)


async def test_create_listing_rejects_bad_price():
    fs = FakeFirestore()
    owner = "0x" + "1" * 40
    _seed_agent(fs, "hash1", owner)
    with patch("services.marketplace_listings.get_db", return_value=fs):
        with pytest.raises(ListingError):
            await create_listing("hash1", owner, 0)


async def test_create_listing_rejects_missing_agent():
    fs = FakeFirestore()
    with patch("services.marketplace_listings.get_db", return_value=fs):
        with pytest.raises(ListingError):
            await create_listing("nope", "0x" + "1" * 40, 2.5)


async def test_cancel_listing_by_seller():
    fs = FakeFirestore()
    owner = "0x" + "1" * 40
    _seed_agent(fs, "hash1", owner)
    with patch("services.marketplace_listings.get_db", return_value=fs):
        await create_listing("hash1", owner, 2.5)
        await cancel_listing("hash1", owner)
    assert fs.collection_docs[ml.LISTINGS_COLLECTION]._docs["hash1"].to_dict()["status"] == "cancelled"


async def test_cancel_listing_rejects_non_seller():
    fs = FakeFirestore()
    owner = "0x" + "1" * 40
    _seed_agent(fs, "hash1", owner)
    with patch("services.marketplace_listings.get_db", return_value=fs):
        await create_listing("hash1", owner, 2.5)
        with pytest.raises(ListingError):
            await cancel_listing("hash1", "0x" + "2" * 40)


async def test_get_active_listings_filters_chain_and_status():
    fs = FakeFirestore()
    _seed_agent(fs, "hash_bnb", "0x" + "1" * 40, chain_id=97)
    _seed_agent(fs, "hash_eth", "0x" + "1" * 40, chain_id=11155111)
    with patch("services.marketplace_listings.get_db", return_value=fs):
        await create_listing("hash_bnb", "0x" + "1" * 40, 1.0)
        await create_listing("hash_eth", "0x" + "1" * 40, 2.0)
        await cancel_listing("hash_eth", "0x" + "1" * 40)
        all_active = await get_active_listings()
        bnb_only = await get_active_listings(chain_id=97)
    assert len(all_active) == 1  # eth was cancelled
    assert all_active[0]["agent_id"] == "hash_bnb"
    assert len(bnb_only) == 1
