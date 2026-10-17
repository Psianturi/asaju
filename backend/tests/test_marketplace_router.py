"""Marketplace router: listings are written by the chain, never by a request."""

import pytest
from httpx import ASGITransport, AsyncClient

from services.marketplace_listings import ListingError, ListingSyncUnavailable

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def api():
    from main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.mark.parametrize("path", ["/api/v1/marketplace/list", "/api/v1/marketplace/cancel"])
async def test_unsigned_list_and_cancel_endpoints_are_gone(api, path):
    resp = await api.post(path, json={"agent_id": "a", "seller_wallet": "0x" + "1" * 40, "price": 1})
    assert resp.status_code in (404, 405)


async def test_sync_returns_chain_state(api, monkeypatch):
    async def fake_sync(agent_id):
        return {"status": "active", "listing": {"agent_id": agent_id}}

    monkeypatch.setattr("routers.marketplace.sync_listing", fake_sync)
    resp = await api.post("/api/v1/marketplace/sync", params={"agent_id": "hash1"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "active"


@pytest.mark.parametrize(
    "exc, code",
    [(ListingError("no escrow"), 400), (ListingSyncUnavailable("rpc down"), 503)],
)
async def test_sync_maps_errors(api, monkeypatch, exc, code):
    async def fake_sync(agent_id):
        raise exc

    monkeypatch.setattr("routers.marketplace.sync_listing", fake_sync)
    resp = await api.post("/api/v1/marketplace/sync", params={"agent_id": "hash1"})
    assert resp.status_code == code
