"""Regression tests for owner-wallet authorization of DeFi proposal execution flow."""

from eth_account import Account
from eth_account.messages import encode_defunct
import pytest

from core.config import settings
from routers.proposals import _approval_attempts
from tests.conftest import make_agent, make_wallet

pytestmark = pytest.mark.asyncio

VAULT_ADDRESS = "0x" + "42" * 20  # valid checksum address


@pytest.fixture(autouse=True)
def _reset_execution_rate_limit():
    """Rate-limit state is shared across tests; clear before each test."""
    _approval_attempts.clear()


@pytest.fixture(autouse=True)
def _patch_vault_address():
    """autonomous_vault_address defaults to '' which fails Web3.is_address check."""
    original = settings.autonomous_vault_address
    settings.autonomous_vault_address = VAULT_ADDRESS
    yield
    settings.autonomous_vault_address = original


async def _seed_approved_defi_proposal(fake_db, owner_wallet: str) -> tuple[str, str]:
    """Return (agent_wallet, proposal_id)."""
    agent_wallet = make_wallet()
    fake_db.seed(
        "agents",
        "agent-defi",
        make_agent("agent-defi", agent_wallet, user_wallet=owner_wallet),
    )
    fake_db.seed(
        "proposals",
        "proposal-defi-1",
        {
            "agent_id": "agent-defi",
            "agent_wallet": agent_wallet,
            "title": "Deploy to Aave v3 USDC pool",
            "description": "Yield optimization strategy.",
            "category": "defi",
            "proposal_hash": "0x" + "ab" * 32,
            "status": "approved",
            "created_at": 1.0,
            "expires_at": 4_102_444_800.0,
            "autonomous_execution_triggered": False,
        },
    )
    return agent_wallet, "proposal-defi-1"


async def _seed_non_defi_proposal(fake_db, owner_wallet: str) -> str:
    agent_wallet = make_wallet()
    fake_db.seed(
        "agents",
        "agent-gov",
        make_agent("agent-gov", agent_wallet, user_wallet=owner_wallet),
    )
    fake_db.seed(
        "proposals",
        "proposal-gov-1",
        {
            "agent_id": "agent-gov",
            "agent_wallet": agent_wallet,
            "title": "Vote on Proposal 42",
            "description": "Governance participation.",
            "category": "governance",
            "proposal_hash": "0x" + "cd" * 32,
            "status": "approved",
            "created_at": 1.0,
            "expires_at": 4_102_444_800.0,
            "autonomous_execution_triggered": False,
        },
    )
    return "proposal-gov-1"


async def _execution_challenge(client, proposal_id: str) -> dict:
    response = await client.post(f"/api/v1/proposals/{proposal_id}/execution-challenge")
    assert response.status_code == 200
    return response.json()


def _sign_execution(owner: Account, message: str) -> str:
    return Account.sign_message(encode_defunct(text=message), owner.key).signature.hex()


class TestExecutionChallenge:
    async def test_returns_422_when_proposal_not_approved(self, client, fake_db):
        owner_wallet = make_wallet()
        agent_wallet = make_wallet()
        fake_db.seed(
            "agents",
            "agent-pending",
            make_agent("agent-pending", agent_wallet, user_wallet=owner_wallet),
        )
        fake_db.seed(
            "proposals",
            "proposal-pending",
            {
                "agent_id": "agent-pending",
                "agent_wallet": agent_wallet,
                "category": "defi",
                "status": "pending",
                "proposal_hash": "0x" + "12" * 32,
            },
        )
        response = await client.post("/api/v1/proposals/proposal-pending/execution-challenge")
        assert response.status_code == 422
        assert "approved" in response.json()["detail"].lower()

    async def test_returns_422_for_non_defi_category(self, client, fake_db):
        owner_wallet = make_wallet()
        await _seed_non_defi_proposal(fake_db, owner_wallet)
        response = await client.post("/api/v1/proposals/proposal-gov-1/execution-challenge")
        assert response.status_code == 422
        assert "defi" in response.json()["detail"].lower()

    async def test_returns_422_when_execution_already_triggered(self, client, fake_db):
        owner_wallet = make_wallet()
        agent_wallet = make_wallet()
        fake_db.seed(
            "agents",
            "agent-triggered",
            make_agent("agent-triggered", agent_wallet, user_wallet=owner_wallet),
        )
        fake_db.seed(
            "proposals",
            "proposal-triggered",
            {
                "agent_id": "agent-triggered",
                "agent_wallet": agent_wallet,
                "category": "defi",
                "status": "approved",
                "proposal_hash": "0x" + "12" * 32,
                "autonomous_execution_triggered": True,
            },
        )
        response = await client.post("/api/v1/proposals/proposal-triggered/execution-challenge")
        assert response.status_code == 422
        assert "already" in response.json()["detail"].lower()

    async def test_returns_nonce_and_message_and_expires_at(self, client, fake_db):
        owner_wallet = make_wallet()
        await _seed_approved_defi_proposal(fake_db, owner_wallet)
        challenge = await _execution_challenge(client, "proposal-defi-1")
        assert "nonce" in challenge
        assert "message" in challenge
        assert "expires_at" in challenge
        assert challenge["nonce"]
        assert "ASAJU DeFi Execution Authorization" in challenge["message"]

    async def test_challenge_stored_in_firestore(self, client, fake_db):
        owner_wallet = make_wallet()
        await _seed_approved_defi_proposal(fake_db, owner_wallet)
        challenge = await _execution_challenge(client, "proposal-defi-1")
        doc = await fake_db.collection("proposal_execution_challenges").document(challenge["nonce"]).get()
        assert doc.exists
        assert doc.to_dict()["proposal_id"] == "proposal-defi-1"
        from web3 import Web3 as W3
        assert W3.to_checksum_address(doc.to_dict()["owner_wallet"]) == W3.to_checksum_address(owner_wallet)


class TestExecuteWithInvalidSignature:
    async def test_rejects_invalid_signature_without_calling_web3(self, client, fake_db, monkeypatch):
        owner_wallet = make_wallet()
        await _seed_approved_defi_proposal(fake_db, owner_wallet)
        challenge = await _execution_challenge(client, "proposal-defi-1")
        called = False

        async def _unexpected_web3(**kwargs):
            nonlocal called
            called = True
            return {}

        monkeypatch.setattr(
            "routers.proposals.web3_service.execute_autonomous_transfer",
            _unexpected_web3,
        )

        response = await client.post(
            f"/api/v1/proposals/proposal-defi-1/execute",
            json={
                "nonce": challenge["nonce"],
                "signer_wallet": owner_wallet,
                "signature": "0x" + "00" * 65,
            },
        )
        assert response.status_code == 401
        assert not called


class TestExecuteNonceReplay:
    async def test_rejects_reused_nonce(self, client, fake_db, monkeypatch):
        owner_account = Account.create()
        owner_wallet = owner_account.address
        agent_wallet, proposal_id = await _seed_approved_defi_proposal(fake_db, owner_wallet)
        fake_db.collection("agents")._docs["agent-defi"]["private_key_enc"] = "0x" + "aa" * 32
        challenge = await _execution_challenge(client, proposal_id)
        signature = _sign_execution(owner_account, challenge["message"])

        async def _no_op_transfer(**kwargs):
            return {"tx_hash": "0x" + "ff" * 32, "status": "success", "amount_mnt": 0.1}

        monkeypatch.setattr(
            "routers.proposals.web3_service.execute_autonomous_transfer",
            _no_op_transfer,
        )

        response1 = await client.post(
            f"/api/v1/proposals/{proposal_id}/execute",
            json={
                "nonce": challenge["nonce"],
                "signer_wallet": owner_account.address,
                "signature": signature,
            },
        )
        assert response1.status_code == 200

        response2 = await client.post(
            f"/api/v1/proposals/{proposal_id}/execute",
            json={
                "nonce": challenge["nonce"],
                "signer_wallet": owner_account.address,
                "signature": signature,
            },
        )
        assert response2.status_code == 401
        assert "already" in response2.json()["detail"].lower()


class TestExecuteExpiredNonce:
    async def test_rejects_expired_challenge(self, client, fake_db, monkeypatch):
        owner_wallet = make_wallet()
        agent_wallet = make_wallet()
        fake_db.seed(
            "agents",
            "agent-exp",
            make_agent("agent-exp", agent_wallet, user_wallet=owner_wallet),
        )
        fake_db.seed(
            "proposals",
            "proposal-exp",
            {
                "agent_id": "agent-exp",
                "agent_wallet": agent_wallet,
                "category": "defi",
                "status": "approved",
                "proposal_hash": "0x" + "ee" * 32,
                "autonomous_execution_triggered": False,
            },
        )
        expired_nonce = "expired-test-nonce"
        fake_db.seed(
            "proposal_execution_challenges",
            expired_nonce,
            {
                "proposal_id": "proposal-exp",
                "agent_id": "agent-exp",
                "owner_wallet": owner_wallet,
                "agent_wallet": agent_wallet,
                "vault_address": "0x" + "11" * 20,
                "amount_mnt": 0.1,
                "message": "any message",
                "expires_at": 0.0,
                "used_at": None,
                "created_at": 0.0,
            },
        )
        owner_account = Account.create()
        response = await client.post(
            "/api/v1/proposals/proposal-exp/execute",
            json={
                "nonce": expired_nonce,
                "signer_wallet": owner_account.address,
                "signature": _sign_execution(owner_account, "any message"),
            },
        )
        assert response.status_code == 401
        assert "expired" in response.json()["detail"].lower()


class TestExecuteWrongSigner:
    async def test_rejects_signature_from_wrong_wallet(self, client, fake_db):
        owner_wallet = make_wallet()
        await _seed_approved_defi_proposal(fake_db, owner_wallet)
        challenge = await _execution_challenge(client, "proposal-defi-1")
        wrong_account = Account.create()
        response = await client.post(
            f"/api/v1/proposals/proposal-defi-1/execute",
            json={
                "nonce": challenge["nonce"],
                "signer_wallet": wrong_account.address,
                "signature": _sign_execution(wrong_account, challenge["message"]),
            },
        )
        assert response.status_code == 403
        assert "owner" in response.json()["detail"].lower()
