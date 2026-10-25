"""Tests for the marketplace listings mirror — Firestore copies the escrow, never the caller."""

import pytest
from unittest.mock import patch

from services import marketplace_listings as ml
from services.marketplace_listings import (
    ListingError,
    ListingSyncUnavailable,
    get_active_listings,
    reconcile_active_listings,
    record_listed_event,
    sync_listing,
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

    def limit(self, _n):
        return FakeQuery(self._docs[:_n])

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


AGENT_WALLET = "0x" + "a" * 40
OWNER = "0x" + "1" * 40
OTHER = "0x" + "2" * 40


def _seed_agent(fs, agent_id, owner=OWNER, chain_id=97, wallet=AGENT_WALLET):
    fs.collection(ml.AGENTS_COLLECTION).add_doc(
        FakeDoc(
            {
                "agent_id": agent_id,
                "agent_wallet": wallet,
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


class FakeChain:
    """Stands in for the escrow + agent contract: per-wallet listing and owner."""

    def __init__(self):
        self.listings: dict[str, dict] = {}
        self.owners: dict[str, str] = {}
        self.fail = False

    async def get_marketplace_listing(self, agent_wallet, chain_id):
        if self.fail:
            raise ConnectionError("rpc down")
        return self.listings.get(agent_wallet.lower(), {"seller": "0x" + "0" * 40, "price_wei": 0, "active": False})

    async def get_agent_owner(self, agent_wallet, chain_id):
        return self.owners.get(agent_wallet.lower())


@pytest.fixture
def env():
    fs = FakeFirestore()
    chain = FakeChain()
    chain.owners[AGENT_WALLET] = OWNER
    ml._balance_cache.clear()
    with patch("services.marketplace_listings.get_db", return_value=fs), \
         patch("services.marketplace_listings.web3_service", chain):
        yield fs, chain


def _row(fs, agent_id):
    return fs.collection(ml.LISTINGS_COLLECTION)._docs[agent_id].to_dict()


async def test_sync_copies_active_onchain_listing_with_snapshot(env):
    fs, chain = env
    _seed_agent(fs, "hash1")
    chain.listings[AGENT_WALLET] = {"seller": OWNER, "price_wei": 25 * 10**17, "active": True}
    result = await sync_listing("hash1")
    assert result["status"] == "active"
    row = _row(fs, "hash1")
    assert row["price"] == 2.5
    assert row["price_wei"] == str(25 * 10**17)
    assert row["currency"] == "tBNB"
    assert row["seller_wallet"] == OWNER
    assert row["agent_name"] == "Testy"
    assert row["source"] == "chain"


async def test_sync_uses_erc20_settlement_on_robinhood(env):
    fs, chain = env
    _seed_agent(fs, "hash1", chain_id=46630)
    chain.listings[AGENT_WALLET] = {"seller": OWNER, "price_wei": 10**18, "active": True}
    await sync_listing("hash1")
    assert _row(fs, "hash1")["currency"] == "ASA"


async def test_nothing_is_listed_without_an_onchain_listing(env):
    """The old board took a caller's word for it. The mirror only writes what
    the escrow holds, so there is no request that can conjure a listing."""
    fs, chain = env
    _seed_agent(fs, "hash1")
    result = await sync_listing("hash1")
    assert result["status"] == "none"
    assert await get_active_listings() == []


async def test_cancel_onchain_closes_the_row(env):
    fs, chain = env
    _seed_agent(fs, "hash1")
    chain.listings[AGENT_WALLET] = {"seller": OWNER, "price_wei": 10**18, "active": True}
    await sync_listing("hash1")
    chain.listings[AGENT_WALLET] = {"seller": "0x" + "0" * 40, "price_wei": 0, "active": False}
    result = await sync_listing("hash1")
    assert result["status"] == "cancelled"
    assert _row(fs, "hash1")["status"] == "cancelled"


async def test_sale_marks_row_sold_to_new_owner(env):
    fs, chain = env
    _seed_agent(fs, "hash1")
    chain.listings[AGENT_WALLET] = {"seller": OWNER, "price_wei": 10**18, "active": True}
    await sync_listing("hash1")
    chain.listings[AGENT_WALLET] = {"seller": "0x" + "0" * 40, "price_wei": 0, "active": False}
    chain.owners[AGENT_WALLET] = OTHER
    result = await sync_listing("hash1")
    assert result["status"] == "sold"
    assert _row(fs, "hash1")["sold_to"] == OTHER


async def test_listing_whose_seller_lost_the_agent_is_hidden(env):
    """Escrow still holds the listing but the seller transferred the agent
    off-market — buy() would revert, so it must not appear on the board."""
    fs, chain = env
    _seed_agent(fs, "hash1")
    chain.listings[AGENT_WALLET] = {"seller": OWNER, "price_wei": 10**18, "active": True}
    await sync_listing("hash1")
    chain.owners[AGENT_WALLET] = OTHER
    result = await sync_listing("hash1")
    assert result["status"] == "stale"
    assert await get_active_listings() == []


async def test_rpc_outage_leaves_the_mirror_untouched(env):
    fs, chain = env
    _seed_agent(fs, "hash1")
    chain.listings[AGENT_WALLET] = {"seller": OWNER, "price_wei": 10**18, "active": True}
    await sync_listing("hash1")
    chain.fail = True
    with pytest.raises(ListingSyncUnavailable):
        await sync_listing("hash1")
    assert _row(fs, "hash1")["status"] == "active"


async def test_unknown_owner_read_is_unavailable_not_cancelled(env):
    fs, chain = env
    _seed_agent(fs, "hash1")
    chain.listings[AGENT_WALLET] = {"seller": OWNER, "price_wei": 10**18, "active": True}
    chain.owners.clear()
    with pytest.raises(ListingSyncUnavailable):
        await sync_listing("hash1")


async def test_chain_without_escrow_is_rejected(env):
    fs, chain = env
    _seed_agent(fs, "hash1", chain_id=5003)
    with pytest.raises(ListingError):
        await sync_listing("hash1")


async def test_missing_agent_is_rejected(env):
    with pytest.raises(ListingError):
        await sync_listing("nope")


async def test_relisting_at_new_price_resets_created_at(env):
    fs, chain = env
    _seed_agent(fs, "hash1")
    chain.listings[AGENT_WALLET] = {"seller": OWNER, "price_wei": 10**18, "active": True}
    await sync_listing("hash1")
    fs.collection(ml.LISTINGS_COLLECTION)._docs["hash1"]._data["created_at"] = 1.0
    await sync_listing("hash1")
    assert _row(fs, "hash1")["created_at"] == 1.0  # same listing keeps its age
    chain.listings[AGENT_WALLET] = {"seller": OWNER, "price_wei": 2 * 10**18, "active": True}
    await sync_listing("hash1")
    assert _row(fs, "hash1")["created_at"] > 1.0


async def test_record_listed_event_resolves_agent_by_wallet(env):
    fs, chain = env
    _seed_agent(fs, "hash1")
    chain.listings[AGENT_WALLET] = {"seller": OWNER, "price_wei": 10**18, "active": True}
    result = await record_listed_event(AGENT_WALLET)
    assert result["status"] == "active"
    assert (await record_listed_event("0x" + "b" * 40))["status"] == "unknown_agent"


async def test_reconcile_closes_rows_the_chain_no_longer_holds(env):
    fs, chain = env
    wallet_b = "0x" + "b" * 40
    _seed_agent(fs, "hash_a")
    _seed_agent(fs, "hash_b", wallet=wallet_b)
    chain.owners[wallet_b] = OWNER
    chain.listings[AGENT_WALLET] = {"seller": OWNER, "price_wei": 10**18, "active": True}
    chain.listings[wallet_b] = {"seller": OWNER, "price_wei": 10**18, "active": True}
    await sync_listing("hash_a")
    await sync_listing("hash_b")
    chain.listings[wallet_b] = {"seller": "0x" + "0" * 40, "price_wei": 0, "active": False}
    summary = await reconcile_active_listings()
    assert summary == {"checked": 2, "still_active": 1, "closed": 1, "errors": 0}
    assert [l["agent_id"] for l in await get_active_listings()] == ["hash_a"]


async def test_get_active_listings_filters_chain(env):
    fs, chain = env
    wallet_eth = "0x" + "e" * 40
    _seed_agent(fs, "hash_bnb", chain_id=97)
    _seed_agent(fs, "hash_eth", chain_id=11155111, wallet=wallet_eth)
    chain.owners[wallet_eth] = OWNER
    chain.listings[AGENT_WALLET] = {"seller": OWNER, "price_wei": 10**18, "active": True}
    chain.listings[wallet_eth] = {"seller": OWNER, "price_wei": 10**18, "active": True}
    await sync_listing("hash_bnb")
    await sync_listing("hash_eth")
    assert len(await get_active_listings()) == 2
    assert [l["agent_id"] for l in await get_active_listings(chain_id=97)] == ["hash_bnb"]


async def test_listings_carry_the_live_wallet_balance(env):
    """The agent's wallet goes to the buyer, so the board shows it live, not the
    stale Firestore copy (which was None → rendered as 0.000)."""
    fs, chain = env
    _seed_agent(fs, "hash_bal")
    chain.listings[AGENT_WALLET] = {"seller": OWNER, "price_wei": 10**18, "active": True}
    await sync_listing("hash_bal")

    async def balance(wallet, chain_id):
        return 0.0112

    chain.get_native_balance = balance
    assert (await get_active_listings())[0]["agent_gas_balance"] == 0.0112

    async def down(wallet, chain_id):
        raise ConnectionError("rpc down")

    chain.get_native_balance = down
    # Cached value survives a later RPC failure within the TTL.
    assert (await get_active_listings())[0]["agent_gas_balance"] == 0.0112
    ml._balance_cache.clear()
    assert (await get_active_listings())[0]["agent_gas_balance"] is None
