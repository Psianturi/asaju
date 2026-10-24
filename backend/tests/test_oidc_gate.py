"""Scheduler/indexer endpoints: a Google ID token is not enough, it must come
from the scheduler's service account. Any Google account can mint an ID token
for our audience, so issuer + audience alone let anyone trigger every scout."""
import pytest
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.asyncio

SCHEDULER_SA = "21898396920-compute@developer.gserviceaccount.com"


@pytest.fixture
async def client(monkeypatch):
    claims = {}

    def fake_verify(token, request, audience=None):
        if token == "bad":
            raise ValueError("bad token")
        return dict(claims)

    monkeypatch.setattr("google.oauth2.id_token.verify_oauth2_token", fake_verify)

    async def poll_all():
        return {"ok": True}

    monkeypatch.setattr("routers.marketplace.poll_all_supported_chains", poll_all)
    from main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac, claims


def _as(claims, email, verified=True):
    claims.clear()
    claims.update({"iss": "https://accounts.google.com", "email": email, "email_verified": verified})


async def test_poll_without_token_is_refused(client):
    ac, _ = client
    assert (await ac.post("/api/v1/marketplace/index/poll")).status_code == 401


async def test_poll_with_an_invalid_token_is_refused(client):
    ac, _ = client
    r = await ac.post("/api/v1/marketplace/index/poll", headers={"Authorization": "Bearer bad"})
    assert r.status_code == 401


@pytest.mark.parametrize("path", ["/api/v1/marketplace/index/poll", "/api/v1/scheduler/run-all-scouts"])
async def test_a_valid_token_from_another_account_is_refused(client, path):
    ac, claims = client
    _as(claims, "attacker@some-other-project.iam.gserviceaccount.com")
    assert (await ac.post(path, headers={"Authorization": "Bearer t"})).status_code == 403
    _as(claims, SCHEDULER_SA, verified=False)
    assert (await ac.post(path, headers={"Authorization": "Bearer t"})).status_code == 403


async def test_the_scheduler_account_gets_through(client):
    ac, claims = client
    _as(claims, SCHEDULER_SA)
    r = await ac.post("/api/v1/marketplace/index/poll", headers={"Authorization": "Bearer t"})
    assert r.status_code == 200 and r.json() == {"result": {"ok": True}}
