"""Hot-tab fallback chain and the provider status endpoint."""

import httpx
import pytest

import services.market_data_service as mds
from tests.fake_firestore import FakeFirestoreClient

pytestmark = pytest.mark.asyncio


def _coin(sym, vol, chg=1.0):
    return {"symbol": sym, "quote": [{"price": 1.0, "volume_24h": vol, "percent_change_24h": chg}]}


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setattr(mds, "get_db", lambda: FakeFirestoreClient())
    mds._FEED_FAILURES.clear(); mds._FEED_SERVED.clear(); mds._STATUS_CACHE.clear()
    yield
    mds._FEED_FAILURES.clear(); mds._FEED_SERVED.clear(); mds._STATUS_CACHE.clear()


def _plan_error(request_path):
    req = httpx.Request("GET", f"https://pro-api.coinmarketcap.com{request_path}")
    resp = httpx.Response(403, json={"status": {"error_code": 1006, "error_message": "plan"}}, request=req)
    return httpx.HTTPStatusError("403", request=req, response=resp)


async def test_hot_falls_back_to_cmc_listings_when_coingecko_refuses(monkeypatch):
    async def fake_cmc_get(path, params=None):
        if path.endswith("most-visited"):
            raise _plan_error(path)
        return {"data": [_coin("AAA", 5e6), _coin("BBB", 9e9), _coin("CCC", 2e7)]}

    async def cg_refuses(path, params=None):
        raise RuntimeError("429")

    monkeypatch.setattr(mds, "_cmc_get", fake_cmc_get)
    monkeypatch.setattr(mds, "_coingecko_get", cg_refuses)
    rows = await mds.get_most_visited(limit=2)
    assert [r["symbol"] for r in rows] == ["BBB", "CCC"]
    status = mds.cmc_feed_status("most_visited")
    assert status["available"] is True and status["source"] == "cmc_listings"
    assert status["reason"] == "plan_unsupported"


async def test_status_reports_key_info_without_the_key(monkeypatch):
    monkeypatch.setattr(mds, "get_coinmarketcap_api_key", lambda: "secret-key-value")
    monkeypatch.setattr(mds, "get_coingecko_api_key", lambda: None)

    async def fake_cmc_get(path, params=None):
        assert path == "/v1/key/info"
        return {"data": {"plan": {"credit_limit_monthly": 10000, "rate_limit_minute": 30},
                         "usage": {"current_month": {"credits_left": 9000}, "current_day": {"credits_left": 300}}}}

    async def cg_ok(path, params=None):
        return {"gecko_says": "ok"}

    monkeypatch.setattr(mds, "_cmc_get", fake_cmc_get)
    monkeypatch.setattr(mds, "_coingecko_get", cg_ok)
    out = await mds.market_status()
    assert out["coinmarketcap"]["state"] == "ok"
    assert out["coinmarketcap"]["key_info"]["credits_left_month"] == 9000
    assert out["coingecko"]["state"] == "ok"
    assert "secret-key-value" not in repr(out)


async def test_status_names_a_rejected_key(monkeypatch):
    monkeypatch.setattr(mds, "get_coinmarketcap_api_key", lambda: "bad")
    monkeypatch.setattr(mds, "get_coingecko_api_key", lambda: None)

    async def fake_cmc_get(path, params=None):
        req = httpx.Request("GET", "https://pro-api.coinmarketcap.com/v1/key/info")
        resp = httpx.Response(401, json={"status": {"error_code": 1001, "error_message": "This API Key is invalid."}}, request=req)
        raise httpx.HTTPStatusError("401", request=req, response=resp)

    async def cg_429(path, params=None):
        req = httpx.Request("GET", "https://api.coingecko.com/api/v3/ping")
        raise httpx.HTTPStatusError("429", request=req, response=httpx.Response(429, request=req))

    monkeypatch.setattr(mds, "_cmc_get", fake_cmc_get)
    monkeypatch.setattr(mds, "_coingecko_get", cg_429)
    out = await mds.market_status()
    assert out["coinmarketcap"]["state"] == "auth"
    assert "new key" in out["coinmarketcap"]["hint"]
    assert out["coingecko"]["state"] == "rate_limited"


async def test_status_without_a_key(monkeypatch):
    monkeypatch.setattr(mds, "get_coinmarketcap_api_key", lambda: None)
    monkeypatch.setattr(mds, "get_coingecko_api_key", lambda: None)

    async def cg_ok(path, params=None):
        return {}

    monkeypatch.setattr(mds, "_coingecko_get", cg_ok)
    out = await mds.market_status()
    assert out["coinmarketcap"] == {"configured": False, "state": "not_configured", "hint": mds._STATUS_HINTS["not_configured"]}


async def test_a_cached_empty_list_does_not_block_the_fallback(monkeypatch):
    """An older build cached [] while CMC was failing; that must not hide Hot."""
    import time
    db = FakeFirestoreClient()
    monkeypatch.setattr(mds, "get_db", lambda: db)
    await db.collection(mds._CACHE_COLLECTION).document("most_visited:3").set({"payload": [], "fetched_at": time.time()})

    async def hot(limit):
        return [_coin("GEK", 1e9)], "coingecko"

    monkeypatch.setattr(mds, "_hot_fallback", hot)
    rows = await mds.get_most_visited(limit=3)
    assert [r["symbol"] for r in rows] == ["GEK"]
    assert mds.cmc_feed_status("most_visited")["source"] == "coingecko"


async def test_status_reports_an_expired_plan_even_when_key_info_answers(monkeypatch):
    """CMC's /v1/key/info still answers on an expired plan (seen live, 24 Oct)."""
    monkeypatch.setattr(mds, "get_coinmarketcap_api_key", lambda: "k")
    monkeypatch.setattr(mds, "get_coingecko_api_key", lambda: None)

    async def fake_cmc_get(path, params=None):
        if path == "/v1/key/info":
            return {"data": {"plan": {}, "usage": {}}}
        req = httpx.Request("GET", f"https://pro-api.coinmarketcap.com{path}")
        resp = httpx.Response(402, json={"status": {"error_code": 1004, "error_message": "Your API Key's subscription plan has expired."}}, request=req)
        raise httpx.HTTPStatusError("402", request=req, response=resp)

    async def cg_ok(path, params=None):
        return {}

    async def hot(limit):
        return [], "coingecko"

    monkeypatch.setattr(mds, "_cmc_get", fake_cmc_get)
    monkeypatch.setattr(mds, "_coingecko_get", cg_ok)
    monkeypatch.setattr(mds, "_hot_fallback", hot)
    await mds.get_most_visited(limit=2)
    out = await mds.market_status()
    assert out["coinmarketcap"]["state"] == "plan_expired"
    assert out["coinmarketcap"]["hint"] == mds._STATUS_HINTS["plan_expired"]
