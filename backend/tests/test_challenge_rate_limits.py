"""Challenge endpoints write a Firestore document per call; they are now rate
limited per client IP like /event/agent-auth-challenge already was."""
import pytest
from httpx import ASGITransport, AsyncClient

from core.rate_limit import reset_state

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def client(monkeypatch):
    async def stub(*_a, **_k):
        return {"nonce": "n", "message": "m"}

    for name in ("issue_mandate_challenge", "issue_mandate_revocation_challenge",
                 "confirm_mandate_revocation", "grant_mandate"):
        monkeypatch.setattr(f"routers.events.{name}", stub)
    monkeypatch.setattr("routers.events.get_db", lambda: object())
    reset_state()
    from main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    reset_state()


@pytest.mark.parametrize("path,limit", [
    ("/api/v1/event/agent-mandate?agent_id=a&agent_wallet=0x" + "11" * 20, 10),
    ("/api/v1/event/agent-mandate/revoke?agent_id=a", 10),
    ("/api/v1/event/agent-mandate/confirm?nonce=n&signature=s", 20),
    ("/api/v1/event/agent-mandate/revoke/confirm?nonce=n&signature=s", 20),
])
async def test_mandate_endpoints_are_rate_limited(client, path, limit):
    headers = {"x-forwarded-for": "198.51.100.9"}
    for _ in range(limit):
        assert (await client.post(path, headers=headers)).status_code == 200
    assert (await client.post(path, headers=headers)).status_code == 429
    # Another client is unaffected.
    assert (await client.post(path, headers={"x-forwarded-for": "198.51.100.10"})).status_code == 200


async def test_room_challenge_is_rate_limited(client, monkeypatch):
    async def left(*_a, **_k):
        return 5

    async def issue(*_a, **_k):
        return {"nonce": "n", "message": "m"}

    monkeypatch.setattr("routers.rooms.agent_room.rooms_left_today", left)
    monkeypatch.setattr("routers.rooms.agent_room.issue_room_challenge", issue)
    monkeypatch.setattr("routers.rooms.get_db", lambda: object())
    body = {"owner": "0x" + "ab" * 20, "agent_ids": ["a", "b"], "topic": "t"}
    statuses = [
        (await client.post("/api/v1/rooms/challenge", json=body, headers={"x-forwarded-for": "198.51.100.9"})).status_code
        for _ in range(11)
    ]
    assert statuses == [200] * 10 + [429]
