"""/agent/list must return the same computed fields as /agent/{id}.

Regression: the list endpoint used the old builder, so every agent came back
with comprehension 0 and an empty scout log, and the dashboard said
"No videos yet" for agents with dozens of analysed videos.
"""

import pytest

from tests.conftest import make_agent, make_wallet

pytestmark = pytest.mark.asyncio


@pytest.fixture
def no_rpc(monkeypatch):
    async def balance(_wallet, _chain_id=5003):
        return 0.5

    monkeypatch.setattr("routers.agents.web3_service.get_native_balance", balance)


async def test_list_returns_scout_log_and_comprehension(client, fake_db, no_rpc):
    owner = make_wallet()
    await fake_db.collection("agents").document("agent_a").set(make_agent("agent_a", make_wallet(), user_wallet=owner))
    await fake_db.collection("agents").document("agent_b").set(make_agent("agent_b", make_wallet(), user_wallet=owner))
    for i in range(3):
        await fake_db.collection("agent_events").document(f"ev{i}").set({
            "agent_id": "agent_a",
            "event_title": f"Video {i}",
            "wisdom_summary": "Liquidity, staking yields and DeFi protocol risk explained.",
            "attended_at": 1_790_000_000 + i,
        })

    resp = await client.get("/api/v1/agent/list", params={"wallet": owner})
    assert resp.status_code == 200
    by_id = {a["agent_id"]: a for a in resp.json()}

    assert [e["title"] for e in by_id["agent_a"]["recent_scout_log"]] == ["Video 2", "Video 1", "Video 0"]
    assert by_id["agent_a"]["comprehension_score"] > 0
    # An agent with no events still builds, with defaults.
    assert by_id["agent_b"]["recent_scout_log"] == []


async def test_list_keeps_owner_query_order(client, fake_db, no_rpc):
    owner = make_wallet()
    ids = ["first", "second", "third"]
    for agent_id in ids:
        await fake_db.collection("agents").document(agent_id).set(make_agent(agent_id, make_wallet(), user_wallet=owner))
    resp = await client.get("/api/v1/agent/list", params={"wallet": owner})
    assert [a["agent_id"] for a in resp.json()] == ids
