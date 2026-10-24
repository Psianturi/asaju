"""New Mantle spawns go to V7 only when V7_SPAWN_CHAINS lists the chain. The
backend then signs the agent wallet's SpawnConsent so the owner can call
V7.spawnAgent(agentWallet, sig); without the flag nothing changes."""
import pytest
from eth_account import Account
from eth_account.messages import encode_typed_data
from httpx import ASGITransport, AsyncClient

from core.config import settings
from core.rate_limit import reset_state
from core.v7_spawn import sign_spawn_consent, spawn_consent_payload
from routers import agents as agents_router
from tests.conftest import make_wallet

pytestmark = pytest.mark.asyncio

V7_AGENT = "0x0fE75B47bFE360A305F5D56607d976448fF7c9e7"


async def test_consent_recovers_to_the_agent_wallet():
    agent = Account.create()
    owner = make_wallet()
    sig = sign_spawn_consent(agent.key.hex(), owner, 5003, V7_AGENT)
    payload = spawn_consent_payload(agent.address, owner, 5003, V7_AGENT)
    assert Account.recover_message(encode_typed_data(full_message=payload), signature=sig) == agent.address
    # Bound to the owner: the same signature does not cover anyone else.
    other = spawn_consent_payload(agent.address, make_wallet(), 5003, V7_AGENT)
    assert Account.recover_message(encode_typed_data(full_message=other), signature=sig) != agent.address


@pytest.fixture
async def client(fake_db):
    reset_state()
    from main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    reset_state()


async def _spawn(client, chain_id=5003):
    owner = make_wallet()
    res = await client.post(
        "/api/v1/agent/spawn",
        json={"user_wallet": owner, "agent_name": "Neo", "chain_id": chain_id},
    )
    assert res.status_code == 201, res.text
    return owner, res.json()


async def test_flag_off_keeps_the_legacy_spawn(client, fake_db, monkeypatch):
    monkeypatch.setattr(settings, "v7_spawn_chains", "")
    _, body = await _spawn(client)
    assert body["contract_version"] is None and body["spawn_consent"] is None
    stored = (await fake_db.collection("agents").document(body["agent_id"]).get()).to_dict()
    assert "contract_version" not in stored


async def test_flag_on_returns_a_consent_for_v7(client, fake_db, monkeypatch):
    monkeypatch.setattr(settings, "v7_spawn_chains", "5003")
    owner, body = await _spawn(client)
    assert body["contract_version"] == 7 and body["spawn_contract"] == V7_AGENT
    payload = spawn_consent_payload(body["agent_wallet"], owner, 5003, V7_AGENT)
    assert Account.recover_message(
        encode_typed_data(full_message=payload), signature=body["spawn_consent"]
    ) == body["agent_wallet"]
    stored = (await fake_db.collection("agents").document(body["agent_id"]).get()).to_dict()
    assert stored["contract_version"] == 7

    # A retry with the same name resumes the record and re-issues the consent.
    res = await client.post(
        "/api/v1/agent/spawn", json={"user_wallet": owner, "agent_name": "Neo", "chain_id": 5003}
    )
    assert res.json()["spawn_consent"] == body["spawn_consent"]


async def test_flag_ignores_chains_without_a_v7_deployment(client, monkeypatch):
    monkeypatch.setattr(settings, "v7_spawn_chains", "5003,97")
    _, body = await _spawn(client, chain_id=97)
    assert body["contract_version"] is None and body["spawn_consent"] is None


async def test_mark_funded_reads_the_v7_contract(client, fake_db, monkeypatch):
    monkeypatch.setattr(settings, "v7_spawn_chains", "5003")
    _, body = await _spawn(client)
    calls = []

    async def v7(wallet, chain_id):
        calls.append("v7")
        return True

    async def legacy(wallet, chain_id):
        calls.append("legacy")
        return False

    monkeypatch.setattr(agents_router.web3_service, "is_v7_agent_spawned", v7)
    monkeypatch.setattr(agents_router.web3_service, "is_agent_spawned", legacy)
    res = await client.post(f"/api/v1/agent/{body['agent_id']}/mark-funded")
    assert res.status_code == 200 and calls == ["v7"]
