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
    assert cmc_feed_status("airdrops") == {"available": False, "reason": "plan_unsupported"}

    # Nothing was written as data, so a later success is not masked by a cached [].
    payload = [{"id": 7, "name": "Drop"}]

    async def ok(path, params=None):
        return {"data": payload}

    monkeypatch.setattr("services.market_data_service._cmc_get", ok)
    mds._FEED_FAILURES["airdrops"]["at"] -= mds._FEED_RETRY_SECONDS + 1
    assert await get_airdrops(limit=4) == payload
    assert cmc_feed_status("airdrops") == {"available": True, "reason": None}


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
    assert body == {"results": [], "available": False, "reason": "plan_unsupported"}
