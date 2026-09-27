import os

os.environ.setdefault("ENVIRONMENT", "development")  # keeps kms_service on the plaintext dev path

import pytest_asyncio
from eth_account import Account
from httpx import ASGITransport, AsyncClient

from tests.fake_firestore import FakeFirestoreClient


def make_wallet() -> str:
    """Fresh, valid checksummed Ethereum address — avoids hand-typed checksums."""
    return Account.create().address


def make_agent(
    agent_id: str,
    wallet: str,
    *,
    user_wallet: str,
    level: int = 3,
    total_events: int = 5,
    breeding_count: int = 0,
    max_breedings: int = 3,
    last_breeding_time: float | None = None,
    breeding_cooldown_hours: int = 0,
    niche: str = "Blockchain/DeFi",
    personality: str = "Analytical",
    generation: int = 1,
    chain_id: int = 5003,
    private_key_enc: str | None = None,
) -> dict:
    """Minimal valid agent Firestore doc — defaults satisfy every breed guardrail
    so a single override (e.g. level=1) isolates exactly one guardrail per test."""
    doc: dict = {
        "agent_id": agent_id,
        "agent_wallet": wallet,
        "agent_name": agent_id,
        "niche": niche,
        "personality": personality,
        "user_wallet": user_wallet,
        "level": level,
        "total_events": total_events,
        "breeding_count": breeding_count,
        "max_breedings": max_breedings,
        "last_breeding_time": last_breeding_time,
        "breeding_cooldown_hours": breeding_cooldown_hours,
        "generation": generation,
        "chain_id": chain_id,
        "created_at": 0.0,
        "funded": True,
    }
    if private_key_enc is not None:
        doc["private_key_enc"] = private_key_enc
    return doc


@pytest_asyncio.fixture
async def fake_db(monkeypatch):
    db = FakeFirestoreClient()
    monkeypatch.setattr("routers.agents.get_db", lambda: db)
    monkeypatch.setattr("routers.proposals.get_db", lambda: db)
    yield db


@pytest_asyncio.fixture
async def noop_background_tasks(monkeypatch):
    """breed_agents() fires two asyncio.create_task() jobs after the response is built
    (Gemini biography generation, on-chain spawnBredAgent). Replace with no-ops so
    tests don't need live Gemini/GCP/RPC credentials."""

    async def _noop(*args, **kwargs):
        return None

    monkeypatch.setattr("routers.agents._generate_and_save_biography", _noop)
    monkeypatch.setattr("routers.agents._spawn_bred_agent_on_chain", _noop)


@pytest_asyncio.fixture
async def client(fake_db, noop_background_tasks):
    from main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
