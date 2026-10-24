"""Auto Scout end to end, minus the network: the gas gate reads the agent's
own chain, a missing mandate is reported as such, and the mint cap counts
real Auto Scout mints."""

import time
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from routers import agents as agents_module
from routers.agents import AGENTS_COLLECTION, SCOUT_LOGS_COLLECTION
from services import scout_service
from services.scout_service import _threshold_for_balance
from tests.test_scout_mint_cap import _FakeDocRef, _FakeFirestore



@pytest.fixture(autouse=True)
def _doc_set(monkeypatch):
    """The shared fake has no set(); the scout log writes with it."""
    async def _set(self, data):
        self._data = dict(data)
        self.parent._docs[self.doc_id] = self._data
    monkeypatch.setattr(_FakeDocRef, "set", _set, raising=False)

BNB = 97
CANDIDATE = {"video_id": "v1", "title": "DeFi summit keynote", "description": "lending markets",
             "channel": "Conf", "published_at": "2026-10-01T00:00:00Z", "url": "https://www.youtube.com/watch?v=v1"}


@pytest.mark.asyncio
async def test_threshold_is_relative_to_the_chains_provision():
    # Mantle behaviour is unchanged (provision 0.5 MNT).
    assert _threshold_for_balance(0.15, 0.5) == 80
    assert _threshold_for_balance(0.08, 0.5) == 90
    assert _threshold_for_balance(0.02, 0.5) == 95
    # A BNB agent with most of a small provision left is a healthy agent, not an empty one.
    assert _threshold_for_balance(0.008, 0.01) == 80
    assert _threshold_for_balance(0.0, 0.0) == 95


@pytest.mark.asyncio
async def test_discovery_reads_gas_on_the_agents_own_chain(monkeypatch):
    db = _FakeFirestore()
    monkeypatch.setattr("core.database.get_db", lambda: db)
    monkeypatch.setattr(scout_service, "search_youtube", AsyncMock(return_value=[dict(CANDIDATE)]))
    monkeypatch.setattr("services.llm_service._fetch_youtube_transcript", AsyncMock(return_value="transcript"))
    monkeypatch.setattr(scout_service, "_score_candidates_with_gemini",
                        AsyncMock(side_effect=lambda c, **kw: [{**c[0], "score": 85, "justification": "on niche"}]))
    seen = {}

    async def balance(addr, chain_id=5003):
        seen["balance_chain"] = chain_id
        return 0.008 if chain_id == BNB else 0.0

    async def provision(chain_id=5003):
        seen["provision_chain"] = chain_id
        return 0.01

    from services.web3_service import web3_service
    monkeypatch.setattr(web3_service, "get_native_balance", balance)
    monkeypatch.setattr(web3_service, "get_agent_provision", provision)

    out = await scout_service.discover_event(agent_id="a1", niche="Blockchain/DeFi", agent_name="A",
                                             agent_wallet="0x" + "1" * 40, chain_id=BNB)
    assert seen == {"balance_chain": BNB, "provision_chain": BNB}
    assert out["status"] == "ready_to_mint" and out["threshold_applied"] == 80


def _agent_db(chain_id=BNB):
    db = _FakeFirestore()
    db.collection(AGENTS_COLLECTION)._docs["a1"] = {
        "agent_id": "a1", "agent_name": "A", "niche": "Blockchain/DeFi", "agent_wallet": "0x" + "1" * 40,
        "funded": True, "chain_id": chain_id,
    }
    return db


@pytest.mark.asyncio
async def test_run_without_a_mandate_is_logged_as_no_mandate(monkeypatch):
    db = _agent_db()
    monkeypatch.setattr(agents_module, "get_db", lambda: db)
    monkeypatch.setattr("services.scout_service.discover_event", AsyncMock(return_value={
        "status": "ready_to_mint", "candidate": dict(CANDIDATE), "score": 85, "threshold_applied": 80, "agent_gas_balance": 0.008}))
    refused = HTTPException(status_code=403, detail={"code": "NO_MANDATE", "message": "No active mandate"})
    monkeypatch.setattr("routers.events.attend_event", AsyncMock(side_effect=refused))

    with pytest.raises(HTTPException) as exc:
        await agents_module.run_auto_scout(agent_id="a1")
    assert exc.value.status_code == 403
    logs = list(db.collection(SCOUT_LOGS_COLLECTION)._docs.values())
    assert logs and logs[-1]["reason_code"] == "NO_MANDATE"


@pytest.mark.asyncio
async def test_mint_cap_counts_real_auto_scout_mints(monkeypatch):
    db = _agent_db()
    now = time.time()
    for i in range(3):
        db.collection(SCOUT_LOGS_COLLECTION)._docs[f"l{i}"] = {
            "agent_id": "a1", "action": "MINTED", "run_at": now - 3600 * (i + 1), "minted": True}
    monkeypatch.setattr(agents_module, "get_db", lambda: db)
    monkeypatch.setattr("services.scout_service.discover_event", AsyncMock(return_value={
        "status": "ready_to_mint", "candidate": dict(CANDIDATE), "score": 85, "threshold_applied": 80, "agent_gas_balance": 0.008}))
    attend = AsyncMock()
    monkeypatch.setattr("routers.events.attend_event", attend)

    out = await agents_module.run_auto_scout(agent_id="a1")
    assert out["reason_code"] == "MINT_CAP_REACHED"
    attend.assert_not_called()


@pytest.mark.asyncio
async def test_unreadable_mint_count_skips_instead_of_minting_uncapped(monkeypatch):
    db = _agent_db()
    logs = db.collection(SCOUT_LOGS_COLLECTION)

    def broken_where(*_a, **_k):
        raise RuntimeError("FailedPrecondition: index missing")

    monkeypatch.setattr(logs, "where", broken_where)
    monkeypatch.setattr(agents_module, "get_db", lambda: db)
    monkeypatch.setattr("services.scout_service.discover_event", AsyncMock(return_value={
        "status": "ready_to_mint", "candidate": dict(CANDIDATE), "score": 85, "threshold_applied": 80, "agent_gas_balance": 0.008}))
    attend = AsyncMock()
    monkeypatch.setattr("routers.events.attend_event", attend)

    out = await agents_module.run_auto_scout(agent_id="a1")
    assert out["reason_code"] == "MINT_CAP_REACHED"
    assert "could not be counted" in out["message"]
    attend.assert_not_called()


@pytest.mark.asyncio
async def test_mantle_contract_has_a_default_when_env_is_unset(monkeypatch):
    from core import config
    monkeypatch.setattr(config.settings, "contract_address", "")
    assert config.mantle_contract_address() == config.MANTLE_CONTRACT_DEFAULT
    monkeypatch.setattr(config.settings, "contract_address", "0x" + "ab" * 20)
    assert config.mantle_contract_address() == "0x" + "ab" * 20
