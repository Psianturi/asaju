"""Regression test — /agents/{agent_id}/current-insight endpoint actually executes."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client():
    from main import app
    return TestClient(app)


def _mock_agent_doc(name="Naruto", niche="Trading/Investment"):
    doc = MagicMock()
    doc.exists = True
    doc.to_dict = lambda: {"name": name, "niche": niche, "level": 12}
    return doc


def test_current_insight_returns_200_for_known_agent(client):
    fake_snapshot = {
        "prices": {
            "bitcoin": {"usd": 80000, "usd_24h_change": 4.9},
            "ethereum": {"usd": 2600, "usd_24h_change": 5.8},
            "mantle": {"usd": 0.62, "usd_24h_change": 6.5},
        },
        "fear_greed": {"value": 73, "value_classification": "Greed"},
        "news": [],
        "generated_at": 1_700_000_000,
    }
    fake_col = MagicMock()
    fake_col.document.return_value.get = AsyncMock(return_value=_mock_agent_doc())
    fake_db = MagicMock()
    fake_db.collection.return_value = fake_col

    with patch("routers.agents.get_db", return_value=fake_db), \
         patch("routers.agents.get_market_snapshot", new=AsyncMock(return_value=fake_snapshot)):
        resp = client.get("/api/v1/agent/agent_1/current-insight")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["agent_id"] == "agent_1"
    assert body["agent_name"] == "Naruto"
    assert "BTC" in body["watching"]
    assert "Greed" in body["watching"]
    assert body["suggested_action"]
    assert body["sources"]
    assert body["generated_at"] > 0


def test_current_insight_404_when_agent_missing(client):
    fake_doc = MagicMock()
    fake_doc.exists = False
    fake_col = MagicMock()
    fake_col.document.return_value.get = AsyncMock(return_value=fake_doc)
    fake_db = MagicMock()
    fake_db.collection.return_value = fake_col

    with patch("routers.agents.get_db", return_value=fake_db):
        resp = client.get("/api/v1/agent/nonexistent/current-insight")
    assert resp.status_code == 404


def test_current_insight_handles_missing_market_data(client):
    """If snapshot fails or returns empty, endpoint must not crash (best-effort)."""
    fake_snapshot = {"prices": {}, "fear_greed": None, "news": [], "generated_at": 1}
    fake_col = MagicMock()
    fake_col.document.return_value.get = AsyncMock(return_value=_mock_agent_doc())
    fake_db = MagicMock()
    fake_db.collection.return_value = fake_col

    with patch("routers.agents.get_db", return_value=fake_db), \
         patch("routers.agents.get_market_snapshot", new=AsyncMock(return_value=fake_snapshot)):
        resp = client.get("/api/v1/agent/agent_1/current-insight")

    assert resp.status_code == 200
    body = resp.json()
    assert body["watching"]
    assert body["suggested_action"]
