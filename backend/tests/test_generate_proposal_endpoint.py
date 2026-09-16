"""Regression test: POST /api/v1/agent/{id}/propose must actually succeed.

This endpoint had a NameError bug (referenced an undefined `data`/`user_wallet`
instead of `agent_data`) that made every real call crash with a 500 — no test
exercised the endpoint's HTTP path, so it shipped and stayed broken.
"""

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, patch

from tests.fake_firestore import FakeFirestoreClient

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def client(monkeypatch):
    fake_db = FakeFirestoreClient()
    monkeypatch.setattr("core.database.get_db", lambda: fake_db)
    monkeypatch.setattr("routers.proposals.get_db", lambda: fake_db)

    await fake_db.collection("agents").document("agent1").set({
        "agent_wallet": "0xAgentWallet",
        "agent_name": "TestAgent",
        "niche": "Trading/Investment",
        "level": 3,
        "generation": 1,
        "genetic_traits": [],
        "user_wallet": "0xOwnerWallet",
        "custom_instructions": "Focus on low-risk plays",
        "custom_agenda": "Learn DeFi basics this week",
    })

    from main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def test_propose_endpoint_succeeds(client):
    with patch(
        "routers.proposals.generate_agent_proposal",
        new=AsyncMock(return_value={"title": "Test", "description": "desc", "category": "education"}),
    ) as mock_generate:
        response = await client.post("/api/v1/agent/agent1/propose")

    assert response.status_code == 201
    body = response.json()
    assert body["agent_id"] == "agent1"
    assert body["title"] == "Test"
    assert body["status"] == "pending"

    # The owner's custom_instructions/custom_agenda must reach the LLM call —
    # this is exactly the read that used to crash with NameError.
    _, kwargs = mock_generate.call_args
    assert kwargs["custom_instructions"] == "Focus on low-risk plays"
    assert kwargs["custom_agenda"] == "Learn DeFi basics this week"


async def test_propose_endpoint_404_for_unknown_agent(client):
    response = await client.post("/api/v1/agent/does-not-exist/propose")
    assert response.status_code == 404
