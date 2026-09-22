"""Regression tests for owner inbox aggregator."""

import time

import pytest
from httpx import ASGITransport, AsyncClient

from main import app
from tests.fake_firestore import FakeFirestoreClient
from tests.conftest import make_agent, make_wallet

pytestmark = pytest.mark.asyncio

# A real checksummed address, not a placeholder string like "0xowner" — the
# endpoint always lowercases its query wallet internally, and agents.py
# always stores user_wallet checksummed (mixed-case). A placeholder that's
# already all-lowercase can't expose a case mismatch between those two; this
# is exactly what let the case-sensitivity bug below ship unnoticed.
WALLET = make_wallet()


@pytest.fixture
def client(monkeypatch):
    db = FakeFirestoreClient()
    # Patch the get_db function on every module that uses it
    monkeypatch.setattr("routers.owner_inbox.get_db", lambda: db)
    monkeypatch.setattr("routers.agents.get_db", lambda: db)
    monkeypatch.setattr("routers.proposals.get_db", lambda: db)
    return db


def _seed_agent(client, agent_id, agent_wallet, **overrides):
    base = make_agent(agent_id, agent_wallet, user_wallet=WALLET)
    base.update(overrides)
    client.seed("agents", agent_id, base)
    return base


async def test_inbox_requires_user_wallet():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/owner/inbox")
    assert r.status_code in (400, 422)  # FastAPI returns 422 for missing query param


async def test_inbox_returns_empty_when_no_agents():
    db = FakeFirestoreClient()
    import routers.owner_inbox as inbox_mod
    inbox_mod.get_db = lambda: db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(f"/api/v1/owner/inbox?user_wallet={WALLET}")
    assert r.status_code == 200
    body = r.json()
    assert body["counts"]["total"] == 0
    assert body["pending_proposals"] == []
    assert body["low_gas_agents"] == []
    assert body["paused_agents"] == []


async def test_inbox_aggregates_pending_proposals():
    db = FakeFirestoreClient()
    import routers.owner_inbox as inbox_mod
    inbox_mod.get_db = lambda: db
    _seed_agent(db, "agent-a", "0xwalletA")
    db.seed("proposals", "prop-1", {"agent_id": "agent-a", "title": "Yield harvest", "category": "defi", "status": "pending", "created_at": 1.0})
    db.seed("proposals", "prop-2", {"agent_id": "agent-a", "title": "Vote proposal 42", "category": "governance", "status": "pending", "created_at": 2.0})

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(f"/api/v1/owner/inbox?user_wallet={WALLET}")
    assert r.status_code == 200
    body = r.json()
    assert body["counts"]["pending_proposals"] == 2
    titles = {p["title"] for p in body["pending_proposals"]}
    assert "Yield harvest" in titles
    assert "Vote proposal 42" in titles


async def test_inbox_surfaces_low_gas_agents():
    db = FakeFirestoreClient()
    import routers.owner_inbox as inbox_mod
    inbox_mod.get_db = lambda: db
    _seed_agent(db, "agent-low", "0xA", agent_gas_balance=0.02)
    _seed_agent(db, "agent-ok", "0xB", agent_gas_balance=0.5)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(f"/api/v1/owner/inbox?user_wallet={WALLET}")
    body = r.json()
    assert body["counts"]["low_gas_agents"] == 1
    assert body["low_gas_agents"][0]["agent_id"] == "agent-low"


async def test_inbox_surfaces_paused_agents_with_reason():
    db = FakeFirestoreClient()
    import routers.owner_inbox as inbox_mod
    inbox_mod.get_db = lambda: db
    _seed_agent(
        db,
        "agent-paused",
        "0xA",
        auto_scout_enabled=False,
        auto_scout_disabled_reason="Top up the agent wallet",
        auto_scout_disabled_at=time.time(),
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(f"/api/v1/owner/inbox?user_wallet={WALLET}")
    body = r.json()
    assert body["counts"]["paused_agents"] == 1
    assert body["paused_agents"][0]["reason"] == "Top up the agent wallet"


async def test_inbox_does_not_leak_other_owners_data():
    db = FakeFirestoreClient()
    import routers.owner_inbox as inbox_mod
    inbox_mod.get_db = lambda: db
    # Two owners
    _seed_agent(db, "agent-alice", "0xA1", user_wallet=WALLET)
    _seed_agent(db, "agent-bob", "0xB1", user_wallet="0xother")
    db.seed("proposals", "prop-alice", {"agent_id": "agent-alice", "title": "alice prop", "category": "defi", "status": "pending"})
    db.seed("proposals", "prop-bob", {"agent_id": "agent-bob", "title": "bob prop", "category": "defi", "status": "pending"})

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(f"/api/v1/owner/inbox?user_wallet={WALLET}")
    body = r.json()
    titles = {p["title"] for p in body["pending_proposals"]}
    assert "alice prop" in titles
    assert "bob prop" not in titles


async def test_inbox_matches_wallet_regardless_of_query_case():
    """agents.user_wallet is always stored checksummed. A caller passing an
    all-lowercase wallet (e.g. copied from a block explorer, or a wallet
    provider that returns lowercase) must still match — this is the exact
    bug that made owned_agents, and everything cascading from it, always 0."""
    db = FakeFirestoreClient()
    import routers.owner_inbox as inbox_mod
    inbox_mod.get_db = lambda: db
    _seed_agent(db, "agent-a", "0xA", user_wallet=WALLET)
    db.seed("proposals", "prop-1", {"agent_id": "agent-a", "title": "lowercase-query prop", "category": "defi", "status": "pending"})

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(f"/api/v1/owner/inbox?user_wallet={WALLET.lower()}")
    assert r.status_code == 200
    body = r.json()
    assert body["counts"]["owned_agents"] == 1
    assert body["counts"]["pending_proposals"] == 1


async def test_inbox_recent_mints_in_descending_order():
    db = FakeFirestoreClient()
    import routers.owner_inbox as inbox_mod
    inbox_mod.get_db = lambda: db
    _seed_agent(db, "agent-a", "0xA")
    now = time.time()
    db.seed("scout_logs", "log-old", {
        "agent_id": "agent-a", "action": "MINTED", "run_at": now - 3600,
        "candidate_source": {"title": "Old video", "url": "https://youtu.be/old"},
        "metrics": {"score": 75},
    })
    db.seed("scout_logs", "log-new", {
        "agent_id": "agent-a", "action": "MINTED", "run_at": now - 60,
        "candidate_source": {"title": "New video", "url": "https://youtu.be/new"},
        "metrics": {"score": 88},
    })

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(f"/api/v1/owner/inbox?user_wallet={WALLET}")
    body = r.json()
    assert body["counts"]["recent_mints"] == 2
    assert body["recent_mints"][0]["candidate_title"] == "New video"
