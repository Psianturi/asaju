"""Regression tests for milestone-gated minting.

POST /api/v1/event/attend used to call mintAttendanceNFT() unconditionally
for every analyzed video, burning an agent's gas reserve linearly with usage.
It now only mints when the video crosses a level boundary (the same formula
already used for progression: level = (total_events // 2) + 1) — every video
still gets a wisdom summary and a Firestore record either way.
"""

import pytest
import pytest_asyncio
from google.cloud.firestore_v1.base_query import FieldFilter
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, patch

from tests.conftest import make_agent, make_wallet
from tests.fake_firestore import FakeFirestoreClient

pytestmark = pytest.mark.asyncio

CHAIN_ID = 11155111  # Ethereum Sepolia — has a hardcoded contract_address in CHAIN_CONFIGS


@pytest_asyncio.fixture
async def client(monkeypatch):
    fake_db = FakeFirestoreClient()
    monkeypatch.setattr("core.database.get_db", lambda: fake_db)
    monkeypatch.setattr("routers.events.get_db", lambda: fake_db)
    monkeypatch.setattr(
        "routers.events.summarize_event",
        AsyncMock(return_value="A concise wisdom summary of the video."),
    )
    monkeypatch.setattr(
        "routers.events.classify_event_niche",
        AsyncMock(return_value="Blockchain/DeFi"),
    )
    # Every attend needs the owner's signature or mandate; these tests are about
    # milestone minting, so they run under a stand-in mandate.
    monkeypatch.setattr(
        "routers.events.consume_mandate_run",
        AsyncMock(return_value={"owner_wallet": "0xowner", "runs_used_today": 1, "max_runs_per_day": 5}),
    )

    from main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac, fake_db


async def _attend(client, agent_id: str, agent_wallet: str):
    return await client.post(
        "/api/v1/event/attend",
        json={
            "agent_id": agent_id,
            "agent_wallet": agent_wallet,
            "agent_name": "TestAgent",
            "event_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "event_title": "Test Video",
            "niche": "Blockchain/DeFi",
            "mode_b": False,
            "chain_id": CHAIN_ID,
        },
    )


async def test_below_milestone_skips_mint_entirely(client):
    ac, fake_db = client
    wallet = make_wallet()
    # total_events=0, level=1 -> after this event: events=1, level=max(1,(1//2)+1)=1 -> no level-up
    await fake_db.collection("agents").document("agent1").set(
        make_agent("agent1", wallet, user_wallet=make_wallet(), level=1, total_events=0, chain_id=CHAIN_ID)
    )

    with patch("routers.events.web3_service.mint_attendance_nft", new=AsyncMock()) as mock_mint:
        response = await _attend(ac, "agent1", wallet)

    assert response.status_code == 200
    body = response.json()
    assert body["minted"] is False
    assert body["tx_hash"] is None
    assert body["success"] is True
    assert body["new_total_events"] == 1
    assert body["new_level"] == 1
    mock_mint.assert_not_called()  # no gas spent below a milestone

    # The video is still recorded even though nothing was minted.
    events = [
        d async for d in fake_db.collection("agent_events")
        .where(filter=FieldFilter("agent_id", "==", "agent1")).stream()
    ]
    assert len(events) == 1
    assert events[0].to_dict()["tx_hash"] is None
    assert events[0].to_dict()["minted"] is False


async def test_reaching_milestone_mints(client):
    ac, fake_db = client
    wallet = make_wallet()
    # total_events=1, level=1 -> after this event: events=2, level=max(1,(2//2)+1)=2 -> level-up
    await fake_db.collection("agents").document("agent1").set(
        make_agent("agent1", wallet, user_wallet=make_wallet(), level=1, total_events=1, chain_id=CHAIN_ID)
    )

    mint_return = {
        "status": "success",
        "tx_hash": "0xabc123",
        "token_id": "7",
        "gas_used": "150000",
        "block_number": 42,
        "level_up": True,
        "signing_mode": "A",
    }
    with patch(
        "routers.events.web3_service.mint_attendance_nft",
        new=AsyncMock(return_value=mint_return),
    ) as mock_mint:
        response = await _attend(ac, "agent1", wallet)

    assert response.status_code == 200
    body = response.json()
    assert body["minted"] is True
    assert body["tx_hash"] == "0xabc123"
    assert body["new_total_events"] == 2
    assert body["new_level"] == 2
    mock_mint.assert_called_once()

    events = [
        d async for d in fake_db.collection("agent_events")
        .where(filter=FieldFilter("agent_id", "==", "agent1")).stream()
    ]
    assert len(events) == 1
    assert events[0].to_dict()["tx_hash"] == "0xabc123"
    assert events[0].to_dict()["minted"] is True


async def test_stats_advance_across_several_non_milestone_videos(client):
    """total_events must keep incrementing off-chain even while several
    consecutive videos stay below the next milestone — this is the whole
    point of decoupling 'analyzed' from 'minted'."""
    ac, fake_db = client
    wallet = make_wallet()
    await fake_db.collection("agents").document("agent1").set(
        make_agent("agent1", wallet, user_wallet=make_wallet(), level=2, total_events=2, chain_id=CHAIN_ID)
    )

    mint_return = {
        "status": "success", "tx_hash": "0xdef456", "token_id": "8",
        "gas_used": "150000", "block_number": 43, "level_up": True, "signing_mode": "A",
    }
    with patch(
        "routers.events.web3_service.mint_attendance_nft",
        new=AsyncMock(return_value=mint_return),
    ) as mock_mint:
        # events 2 -> 3: level = max(2, 3//2+1) = max(2,2) = 2, no level-up
        r1 = await _attend(ac, "agent1", wallet)
        assert r1.json()["minted"] is False
        assert r1.json()["new_total_events"] == 3

        # events 3 -> 4: level = max(2, 4//2+1) = max(2,3) = 3, level-up -> mints
        r2 = await _attend(ac, "agent1", wallet)
        assert r2.json()["minted"] is True
        assert r2.json()["new_total_events"] == 4
        assert r2.json()["new_level"] == 3

    assert mock_mint.await_count == 1  # only the second call crossed a milestone


async def test_mode_a_without_signature_or_mandate_is_refused(client, monkeypatch):
    """Mode A mints with the platform's gas on Mantle and always calls the model,
    so it needs the owner too — not just mode B."""
    ac, db = client
    await db.collection("agents").document("agent-noauth").set(
        {"agent_id": "agent-noauth", "agent_wallet": "0x" + "ab" * 20, "chain_id": CHAIN_ID, "total_events": 0, "funded": True}
    )

    async def no_mandate(*_a, **_k):
        raise PermissionError("No active mandate authorises 'attend_event' for agent agent-noauth.")

    monkeypatch.setattr("routers.events.consume_mandate_run", no_mandate)
    resp = await _attend(ac, "agent-noauth", "0x" + "ab" * 20)
    assert resp.status_code == 403
    assert resp.json()["detail"]["code"] == "NO_MANDATE"


async def test_mandate_cannot_mint_to_another_wallet(client):
    """A mandate authorises this agent only; the mint target must be its own wallet."""
    ac, db = client
    await db.collection("agents").document("agent-bind").set(
        {"agent_id": "agent-bind", "agent_wallet": "0x" + "ab" * 20, "chain_id": CHAIN_ID, "total_events": 1, "funded": True}
    )
    resp = await _attend(ac, "agent-bind", "0x" + "cd" * 20)
    assert resp.status_code == 409


async def test_attend_refuses_an_agent_never_spawned_on_chain(client):
    """A spawn whose transaction failed must not learn (or call the model)."""
    ac, db = client
    await db.collection("agents").document("agent-pending").set(
        {"agent_id": "agent-pending", "agent_wallet": "0x" + "ab" * 20, "chain_id": CHAIN_ID,
         "total_events": 0, "funded": False, "ownership_status": "original-creator"}
    )
    resp = await _attend(ac, "agent-pending", "0x" + "ab" * 20)
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "AGENT_NOT_ACTIVATED"


async def test_v7_agent_records_every_video_as_a_self_signed_lesson(client):
    ac, fake_db = client
    wallet = make_wallet()
    agent = make_agent("agent7", wallet, user_wallet=make_wallet(), level=1, total_events=0, chain_id=5003)
    agent["contract_version"] = 7
    await fake_db.collection("agents").document("agent7").set(agent)

    lesson = {"status": "success", "tx_hash": "0xl35", "token_id": "1", "gas_used": "60000",
              "block_number": 9, "level_up": False, "signing_mode": "B"}
    with patch("routers.events.web3_service.record_v7_lesson", new=AsyncMock(return_value=lesson)) as rec, \
         patch("routers.events.web3_service.mint_attendance_nft", new=AsyncMock()) as mint:
        res = await ac.post("/api/v1/event/attend", json={
            "agent_id": "agent7", "agent_wallet": wallet, "agent_name": "V7",
            "event_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "event_title": "T",
            "niche": "Blockchain/DeFi", "mode_b": False, "chain_id": 5003,
        })

    assert res.status_code == 200, res.text
    assert res.json()["tx_hash"] == "0xl35"  # below a milestone, still on-chain
    mint.assert_not_called()
    args = rec.call_args.args
    assert args[0] == wallet and args[1] == agent["private_key_enc"] and args[4] == 5003
