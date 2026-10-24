"""CMC feed availability: a refused endpoint must read as unavailable, not as
live-but-empty, and must not be cached as if it were data."""

import httpx
import pytest

from services import market_data_service as mds
from services.market_data_service import cmc_feed_status, get_airdrops, get_most_visited
from tests.fake_firestore import FakeFirestoreClient

pytestmark = pytest.mark.asyncio


def _cmc_http_error(status_code: int, error_code: int, message: str) -> httpx.HTTPStatusError:
    request = httpx.Request("GET", "https://pro-api.coinmarketcap.com/v1/x")
    response = httpx.Response(
        status_code,
        json={"status": {"error_code": error_code, "error_message": message}},
        request=request,
    )
    return httpx.HTTPStatusError("cmc error", request=request, response=response)


@pytest.fixture
def db(monkeypatch):
    fake = FakeFirestoreClient()
    monkeypatch.setattr("services.market_data_service.get_db", lambda: fake)
    return fake


async def test_plan_unsupported_is_reported_and_not_cached(db, monkeypatch):
    calls = {"n": 0}

    async def refused(path, params=None):
        calls["n"] += 1
        raise _cmc_http_error(403, 1006, "Your API Key subscription plan doesn't support this endpoint.")

    monkeypatch.setattr("services.market_data_service._cmc_get", refused)
    assert await get_airdrops(limit=4) == []
    status = cmc_feed_status("airdrops")
    assert (status["available"], status["reason"], status["source"]) == (False, "plan_unsupported", None)

    # Nothing was written as data, so a later success is not masked by a cached [].
    payload = [{"id": 7, "name": "Drop"}]

    async def ok(path, params=None):
        return {"data": payload}

    monkeypatch.setattr("services.market_data_service._cmc_get", ok)
    mds._FEED_FAILURES["airdrops"]["at"] -= mds._RETRY_BY_REASON["plan_unsupported"] + 1
    assert await get_airdrops(limit=4) == payload
    assert cmc_feed_status("airdrops") == {"available": True, "reason": None, "detail": None, "source": "coinmarketcap"}


async def test_failure_is_not_retried_inside_the_window(db, monkeypatch):
    calls = {"n": 0}

    async def refused(path, params=None):
        calls["n"] += 1
        raise _cmc_http_error(429, 1008, "minute rate limit")

    monkeypatch.setattr("services.market_data_service._cmc_get", refused)
    await get_most_visited(limit=8)
    await get_most_visited(limit=8)
    assert calls["n"] == 1
    assert cmc_feed_status("most_visited")["reason"] == "rate_limited"


async def test_missing_key_reads_as_not_configured(db, monkeypatch):
    monkeypatch.setattr("services.market_data_service.get_coinmarketcap_api_key", lambda: "")
    assert await get_airdrops(limit=2) == []
    assert cmc_feed_status("airdrops")["reason"] == "not_configured"


async def test_router_exposes_availability(db, monkeypatch):
    from httpx import ASGITransport, AsyncClient
    from main import app

    async def refused(path, params=None):
        raise _cmc_http_error(403, 1006, "plan")

    monkeypatch.setattr("services.market_data_service._cmc_get", refused)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        body = (await ac.get("/api/v1/market/airdrops", params={"limit": 4})).json()
    assert body["results"] == [] and body["available"] is False
    assert body["reason"] == "plan_unsupported" and body["source"] is None


async def test_failed_feed_serves_last_good_answer(db, monkeypatch):
    async def ok(path, params=None):
        return {"data": [{"id": 1, "symbol": "BTC", "quote": {"USD": {"price": 1.0}}}]}

    monkeypatch.setattr("services.market_data_service._cmc_get", ok)
    assert len(await get_most_visited(5)) == 1
    # Expire the fresh cache, then CMC goes down.
    doc = db.collection("market_cache")._docs["most_visited:5"]
    doc["fetched_at"] -= mds._TTL_MOST_VISITED + 1

    async def down(path, params=None):
        raise httpx.ConnectError("boom")

    monkeypatch.setattr("services.market_data_service._cmc_get", down)
    rows = await get_most_visited(5)
    assert rows[0]["symbol"] == "BTC"
    status = cmc_feed_status("most_visited")
    assert status["available"] is True and status["source"] == "cache" and status["reason"] == "upstream_error"


async def test_failed_feed_falls_back_to_coingecko(db, monkeypatch):
    async def down(path, params=None):
        raise httpx.ReadTimeout("slow")

    async def cg(path, params=None):
        assert path == "/search/trending"
        return {"coins": [{"item": {"coin_id": 7, "name": "Pepe", "symbol": "pepe", "market_cap_rank": 30,
                                    "data": {"price": 0.00001, "price_change_percentage_24h": {"usd": 12.5}}}}]}

    monkeypatch.setattr("services.market_data_service._cmc_get", down)
    monkeypatch.setattr("services.market_data_service._coingecko_get", cg)
    rows = await get_most_visited(5)
    assert rows[0]["symbol"] == "PEPE" and rows[0]["quote"][0]["percent_change_24h"] == 12.5
    assert cmc_feed_status("most_visited")["source"] == "coingecko"
    # Fallback rows never overwrite the CMC cache entry.
    assert "most_visited:5" not in db.collection("market_cache")._docs


async def test_global_metrics_failure_is_not_cached_and_falls_back(db, monkeypatch):
    async def down(path, params=None):
        raise httpx.ConnectError("boom")

    async def cg(path, params=None):
        return {"data": {"total_market_cap": {"usd": 2.5e12}, "total_volume": {"usd": 9e10},
                         "market_cap_percentage": {"btc": 57.1, "eth": 12.0},
                         "market_cap_change_percentage_24h_usd": -0.4}}

    monkeypatch.setattr("services.market_data_service._cmc_get", down)
    monkeypatch.setattr("services.market_data_service._coingecko_get", cg)
    metrics = await mds.get_global_metrics()
    assert metrics["total_market_cap"] == 2.5e12 and metrics["btc_dominance"] == 57.1
    assert metrics["source"] == "coingecko"
    assert "global_metrics" not in db.collection("market_cache")._docs


async def test_transient_cmc_error_is_retried_once(monkeypatch):
    calls = []
    request = httpx.Request("GET", "https://pro-api.coinmarketcap.com/v1/x")

    class Client:
        def __init__(self, *a, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url, params=None, headers=None):
            calls.append(url)
            if len(calls) == 1:
                raise httpx.ConnectError("reset", request=request)
            return httpx.Response(200, json={"data": []}, request=request)

    async def no_sleep(_):
        return None

    monkeypatch.setattr("services.market_data_service.get_coinmarketcap_api_key", lambda: "k")
    monkeypatch.setattr(httpx, "AsyncClient", Client)
    monkeypatch.setattr(mds.asyncio, "sleep", no_sleep)
    assert await mds._cmc_get("/v1/x") == {"data": []}
    assert len(calls) == 2


async def test_expired_plan_is_named(db, monkeypatch):
    async def expired(path, params=None):
        raise _cmc_http_error(402, 0, "Your API Key's subscription plan has expired.")

    monkeypatch.setattr("services.market_data_service._cmc_get", expired)
    await get_airdrops(4)
    assert cmc_feed_status("airdrops")["reason"] == "plan_expired"



async def test_refused_endpoint_is_left_alone_for_hours(db, monkeypatch):
    calls = []

    async def refused(path, params=None):
        calls.append(path)
        raise _cmc_http_error(403, 1006, "Your plan doesn't support this endpoint.")

    monkeypatch.setattr("services.market_data_service._cmc_get", refused)
    await get_airdrops(4)
    mds._FEED_FAILURES["airdrops"]["at"] -= mds._FEED_RETRY_SECONDS + 1   # 5 min later: still skipped
    db.collection("market_cache")._docs.clear()
    await get_airdrops(4)
    assert calls == ["/v1/cryptocurrency/airdrops"]


async def test_movers_come_from_cmc_listings_when_trending_is_not_in_the_plan(db, monkeypatch):
    def coin(sym, change, vol=5e6):
        return {"id": len(sym), "symbol": sym, "name": sym, "cmc_rank": 1,
                "quote": {"USD": {"price": 1.0, "percent_change_24h": change, "volume_24h": vol}}}

    async def cmc(path, params=None):
        if "gainers-losers" in path:
            raise _cmc_http_error(403, 1006, "Your plan doesn't support this endpoint.")
        assert path == "/v1/cryptocurrency/listings/latest"
        return {"data": [coin("AAA", 3.0), coin("BBB", 12.0), coin("THIN", 90.0, vol=10), coin("CCC", -8.0)]}

    monkeypatch.setattr("services.market_data_service._cmc_get", cmc)
    gainers = await mds.get_trending_gainers_losers("24h", 2, "desc")
    assert [c["symbol"] for c in gainers] == ["BBB", "AAA"]          # thin-volume coin left out
    status = cmc_feed_status("gainers")
    assert status["source"] == "cmc_listings" and status["reason"] == "plan_unsupported"
    losers = await mds.get_trending_gainers_losers("24h", 1, "asc")
    assert [c["symbol"] for c in losers] == ["CCC"]


async def test_fear_greed_falls_back_and_failures_are_not_cached(db, monkeypatch):
    async def down(path, params=None):
        raise _cmc_http_error(403, 1006, "plan")

    async def alt():
        return {"value": 41, "value_classification": "Fear", "source": "alternative.me"}

    monkeypatch.setattr("services.market_data_service._cmc_get", down)
    monkeypatch.setattr("services.market_data_service._alt_fear_greed", alt)
    fg = await mds.get_fear_greed_index()
    assert fg["value"] == 41 and fg["source"] == "alternative.me"

    async def none():
        return None

    db.collection("market_cache")._docs.clear()
    monkeypatch.setattr("services.market_data_service._alt_fear_greed", none)
    assert await mds.get_fear_greed_index() is None
    assert "fear_greed" not in db.collection("market_cache")._docs
