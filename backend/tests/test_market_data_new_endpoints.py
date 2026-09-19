"""Regression tests for the new market endpoints (airdrops, global-metrics,
most-visited, categories) and the symbol→CMC ID mapping helper."""

import pytest

from services.market_data_service import (
    _CMC_ID_MAP,
    get_airdrops,
    get_categories,
    get_global_metrics,
    get_most_visited,
    get_new_listings,
    symbol_to_cmc_id,
)
from tests.fake_firestore import FakeFirestoreClient

pytestmark = pytest.mark.asyncio


def _patch_fetch(monkeypatch, fn_name, payload):
    async def fake_fetch(path, params=None):
        return {"data": payload}

    monkeypatch.setattr(f"services.market_data_service.{fn_name}", lambda *a, **kw: fake_fetch(None, None))


async def test_airdrops_returns_payload(monkeypatch):
    db = FakeFirestoreClient()
    monkeypatch.setattr("services.market_data_service.get_db", lambda: db)

    payload = [{"id": 1, "name": "TestAirdrop", "coin": {"symbol": "TST"}}]

    async def fake_cmc_get(path, params=None):
        return {"data": payload}

    monkeypatch.setattr("services.market_data_service._cmc_get", fake_cmc_get)
    result = await get_airdrops(limit=5)
    assert result == payload


async def test_airdrops_returns_empty_on_failure(monkeypatch):
    db = FakeFirestoreClient()
    monkeypatch.setattr("services.market_data_service.get_db", lambda: db)

    async def fake_cmc_get(path, params=None):
        raise RuntimeError("API down")

    monkeypatch.setattr("services.market_data_service._cmc_get", fake_cmc_get)
    result = await get_airdrops(limit=5)
    assert result == []


async def test_global_metrics_returns_payload(monkeypatch):
    db = FakeFirestoreClient()
    monkeypatch.setattr("services.market_data_service.get_db", lambda: db)

    payload = {"total_market_cap": 2_000_000_000_000, "btc_dominance": 58.0}

    async def fake_cmc_get(path, params=None):
        return {"data": payload}

    monkeypatch.setattr("services.market_data_service._cmc_get", fake_cmc_get)
    result = await get_global_metrics()
    assert result == payload


async def test_global_metrics_returns_none_on_failure(monkeypatch):
    db = FakeFirestoreClient()
    monkeypatch.setattr("services.market_data_service.get_db", lambda: db)

    async def fake_cmc_get(path, params=None):
        raise RuntimeError("boom")

    monkeypatch.setattr("services.market_data_service._cmc_get", fake_cmc_get)
    result = await get_global_metrics()
    assert result is None


async def test_most_visited_returns_payload(monkeypatch):
    db = FakeFirestoreClient()
    monkeypatch.setattr("services.market_data_service.get_db", lambda: db)

    payload = [{"symbol": "BTC"}, {"symbol": "ETH"}]

    async def fake_cmc_get(path, params=None):
        return {"data": payload}

    monkeypatch.setattr("services.market_data_service._cmc_get", fake_cmc_get)
    result = await get_most_visited(limit=5)
    assert result == payload


async def test_categories_returns_payload(monkeypatch):
    db = FakeFirestoreClient()
    monkeypatch.setattr("services.market_data_service.get_db", lambda: db)

    payload = [{"name": "DeFi"}, {"name": "AI"}]

    async def fake_cmc_get(path, params=None):
        return {"data": payload}

    monkeypatch.setattr("services.market_data_service._cmc_get", fake_cmc_get)
    result = await get_categories()
    assert result == payload


def test_symbol_to_cmc_id_known_symbols():
    """Best-effort fallback map covers the assets we care about."""
    assert symbol_to_cmc_id("BTC") == 1
    assert symbol_to_cmc_id("btc") == 1  # case insensitive
    assert symbol_to_cmc_id("ETH") == 1027
    assert symbol_to_cmc_id("MNT") == 27075
    assert symbol_to_cmc_id("USDT") == 825


def test_symbol_to_cmc_id_unknown_symbol():
    """Unknown symbols return None rather than crashing — caller can fall back."""
    assert symbol_to_cmc_id("UNKNOWN_TOKEN_X") is None


def test_cmc_id_map_has_no_duplicates():
    """Sanity: no two symbols collide on the same id in the fallback map."""
    seen = {}
    for symbol, cmc_id in _CMC_ID_MAP.items():
        assert cmc_id not in seen.values(), f"Duplicate CMC id {cmc_id} for {symbol}"
        seen[symbol] = cmc_id
