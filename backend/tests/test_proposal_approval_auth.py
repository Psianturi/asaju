"""Regression tests for owner-wallet authorization of proposal approval/rejection."""

from eth_account import Account
from eth_account.messages import encode_defunct
import pytest

from routers.proposals import _approval_attempts
from tests.conftest import make_agent, make_wallet

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    """_approval_attempts is a module-level dict shared across the whole test
    session — without this, tests calling approve/reject on the same proposal_id
    accumulate attempts and later tests get spuriously rate-limited (429)."""
    _approval_attempts.clear()


async def _seed_pending_proposal(fake_db, owner_wallet: str) -> None:
    agent_wallet = make_wallet()
    fake_db.seed(
        "agents",
        "agent-owner",
        make_agent("agent-owner", agent_wallet, user_wallet=owner_wallet),
    )
    fake_db.seed(
        "proposals",
        "proposal-1",
        {
            "agent_id": "agent-owner",
            "agent_wallet": agent_wallet,
            "title": "Review protocol governance update",
            "description": "A bounded governance recommendation.",
            "category": "governance",
            "proposal_hash": "0x" + "12" * 32,
            "status": "pending",
            "created_at": 1.0,
            "expires_at": 4_102_444_800.0,
        },
    )


async def _challenge(client, action: str = "approve") -> dict:
    response = await client.post(f"/api/v1/proposals/proposal-1/approval-challenge?action={action}")
    assert response.status_code == 200
    return response.json()


def _sign(owner: Account, message: str) -> str:
    return Account.sign_message(encode_defunct(text=message), owner.key).signature.hex()


async def test_approval_with_invalid_signature_never_calls_web3(client, fake_db, monkeypatch):
    owner_wallet = make_wallet()
    await _seed_pending_proposal(fake_db, owner_wallet)
    challenge = await _challenge(client)
    called = False

    async def _unexpected_web3_call(**kwargs):
        nonlocal called
        called = True
        return {}

    monkeypatch.setattr(
        "routers.proposals.web3_service.send_record_executed_proposal_tx",
        _unexpected_web3_call,
    )

    response = await client.post(
        "/api/v1/proposals/proposal-1/approve",
        json={
            "nonce": challenge["nonce"],
            "signer_wallet": owner_wallet,
            "signature": "0x" + "00" * 65,
        },
    )

    assert response.status_code == 401
    assert called is False
    proposal = (await fake_db.collection("proposals").document("proposal-1").get()).to_dict()
    assert proposal["status"] == "pending"


async def test_owner_signature_can_approve_once(client, fake_db, monkeypatch):
    owner = Account.create()
    owner_wallet = owner.address
    await _seed_pending_proposal(fake_db, owner_wallet)
    challenge = await _challenge(client)
    signature = Account.sign_message(
        encode_defunct(text=challenge["message"]),
        owner.key,
    ).signature.hex()

    async def _successful_web3_call(**kwargs):
        return {
            "status": "success",
            "tx_hash": "0x" + "ab" * 32,
            "heritage_score_after": 5,
            "proposals_approved_total": 1,
        }

    monkeypatch.setattr(
        "routers.proposals.web3_service.send_record_executed_proposal_tx",
        _successful_web3_call,
    )

    response = await client.post(
        "/api/v1/proposals/proposal-1/approve",
        json={
            "nonce": challenge["nonce"],
            "signer_wallet": owner_wallet,
            "signature": signature,
        },
    )

    assert response.status_code == 200
    assert response.json()["status"] == "approved"

    replay = await client.post(
        "/api/v1/proposals/proposal-1/approve",
        json={
            "nonce": challenge["nonce"],
            "signer_wallet": owner_wallet,
            "signature": signature,
        },
    )
    assert replay.status_code == 401


async def test_approve_prefers_mode_b_agent_private_key(client, fake_db, monkeypatch):
    """Regression: the router must pass the agent's decrypted private key
    (Mode B) when available, and never silently fall back to MINTER_SERVICE
    (Mode A) for a user-facing action. We assert by recording the kwargs
    sent to the web3 layer and checking agent_private_key is the agent's hex."""

    from eth_account import Account as EthAccount

    # Build an agent that has its own private key in storage. We must use
    # make_wallet so the test harness recognises the account format, but the
    # private_key_enc is what the router decrypts and passes to web3.
    from tests.conftest import make_agent as _make_agent

    agent_owner = EthAccount.create()
    agent_owner_addr = agent_owner.address
    agent_wallet = EthAccount.create()  # The on-chain agent identity.
    agent_privkey_hex = agent_wallet.key.hex()
    if not agent_privkey_hex.startswith("0x"):
        agent_privkey_hex = "0x" + agent_privkey_hex

    fake_db.seed(
        "agents",
        "agent-with-key",
        _make_agent("agent-with-key", agent_wallet.address, user_wallet=agent_owner_addr,
                    private_key_enc=agent_privkey_hex),
    )
    proposal_hash = "0x" + "ab" * 32
    fake_db.seed(
        "proposals",
        "proposal-mode-b",
        {
            "agent_id": "agent-with-key",
            "agent_wallet": agent_wallet.address,
            "title": "Test Mode B",
            "description": "Should be signed by agent",
            "category": "governance",
            "proposal_hash": proposal_hash,
            "status": "pending",
            "created_at": 1.0,
            "expires_at": 4_102_444_800.0,
        },
    )

    captured: dict = {}

    async def _capturing_web3_call(*, agent_wallet, proposal_hash_hex, chain_id,
                                    agent_private_key=None, **_):
        captured["agent_wallet"] = agent_wallet
        captured["agent_private_key"] = agent_private_key
        captured["chain_id"] = chain_id
        return {
            "status": "success",
            "tx_hash": "0x" + "cd" * 32,
            "heritage_score_after": 5,
            "proposals_approved_total": 1,
        }

    monkeypatch.setattr(
        "routers.proposals.web3_service.send_record_executed_proposal_tx",
        _capturing_web3_call,
    )

    challenge = await client.post(
        "/api/v1/proposals/proposal-mode-b/approval-challenge?action=approve"
    )
    assert challenge.status_code == 200
    challenge_data = challenge.json()
    # Sign the approval challenge with the OWNER wallet (not the agent
    # wallet). The agent wallet is the on-chain actor that pays gas for
    # recordExecutedProposal; the owner wallet is the one authorising the
    # action. See _verify_proposal_action_signature in routers/proposals.py.
    signature = Account.sign_message(encode_defunct(text=challenge_data["message"]),
                                    agent_owner.key).signature.hex()
    if not signature.startswith("0x"):
        signature = "0x" + signature

    response = await client.post(
        "/api/v1/proposals/proposal-mode-b/approve",
        json={
            "nonce": challenge_data["nonce"],
            "signer_wallet": agent_owner_addr,
            "signature": signature,
        },
    )
    assert response.status_code == 200

    # Mode B verification: the router passed the agent's key (not None).
    assert captured["agent_private_key"] is not None
    assert captured["agent_private_key"] == agent_privkey_hex
    # And the agent wallet address is the one on-chain (not the owner).
    assert captured["agent_wallet"] == agent_wallet.address


async def test_approve_refuses_when_agent_has_no_private_key(client, fake_db, monkeypatch):
    """Safety belt: if the agent has no private_key_enc in Firestore, we
    refuse the approval with 409 rather than silently subsidising it via
    MINTER_SERVICE. The user sees a clear message to top up the agent first."""

    from tests.conftest import make_agent as _make_agent
    owner_account = Account.create()
    owner_addr = owner_account.address
    owner_key = owner_account.key.hex()
    if not owner_key.startswith("0x"):
        owner_key = "0x" + owner_key
    agent_wallet = make_wallet()
    fake_db.seed(
        "agents",
        "agent-no-key",
        _make_agent("agent-no-key", agent_wallet, user_wallet=owner_addr,
                    no_private_key=True, funded=True),
    )
    fake_db.seed(
        "proposals",
        "proposal-no-key",
        {
            "agent_id": "agent-no-key",
            "agent_wallet": agent_wallet,
            "title": "Test refusal",
            "description": "Should refuse cleanly",
            "category": "governance",
            "proposal_hash": "0x" + "cd" * 32,
            "status": "pending",
            "created_at": 1.0,
            "expires_at": 4_102_444_800.0,
        },
    )

    called = False

    async def _must_not_call(*args, **kwargs):
        nonlocal called
        called = True
        return {}

    monkeypatch.setattr(
        "routers.proposals.web3_service.send_record_executed_proposal_tx",
        _must_not_call,
    )

    challenge = await client.post(
        "/api/v1/proposals/proposal-no-key/approval-challenge?action=approve"
    )
    assert challenge.status_code == 200
    challenge_data = challenge.json()
    signature = Account.sign_message(encode_defunct(text=challenge_data["message"]),
                                    owner_account.key).signature.hex()

    response = await client.post(
        "/api/v1/proposals/proposal-no-key/approve",
        json={
            "nonce": challenge_data["nonce"],
            "signer_wallet": owner_addr,
            "signature": signature,
        },
    )
    assert response.status_code == 409
    assert "private key" in response.json()["detail"].lower()
    assert called is False, "web3 must not be called when the safety belt blocks"


async def test_reject_with_invalid_signature_is_rejected(client, fake_db):
    owner_wallet = make_wallet()
    await _seed_pending_proposal(fake_db, owner_wallet)
    challenge = await _challenge(client, action="reject")

    response = await client.post(
        "/api/v1/proposals/proposal-1/reject",
        json={
            "nonce": challenge["nonce"],
            "signer_wallet": owner_wallet,
            "signature": "0x" + "00" * 65,
        },
    )

    assert response.status_code == 401
    proposal = (await fake_db.collection("proposals").document("proposal-1").get()).to_dict()
    assert proposal["status"] == "pending"


async def test_owner_signature_can_reject_once(client, fake_db):
    owner = Account.create()
    await _seed_pending_proposal(fake_db, owner.address)
    challenge = await _challenge(client, action="reject")
    signature = _sign(owner, challenge["message"])

    response = await client.post(
        "/api/v1/proposals/proposal-1/reject",
        json={"nonce": challenge["nonce"], "signer_wallet": owner.address, "signature": signature},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "rejected"

    replay = await client.post(
        "/api/v1/proposals/proposal-1/reject",
        json={"nonce": challenge["nonce"], "signer_wallet": owner.address, "signature": signature},
    )
    assert replay.status_code == 401


async def test_approve_challenge_cannot_be_used_to_reject(client, fake_db):
    owner = Account.create()
    await _seed_pending_proposal(fake_db, owner.address)
    challenge = await _challenge(client, action="approve")
    signature = _sign(owner, challenge["message"])

    response = await client.post(
        "/api/v1/proposals/proposal-1/reject",
        json={"nonce": challenge["nonce"], "signer_wallet": owner.address, "signature": signature},
    )

    assert response.status_code == 401
    proposal = (await fake_db.collection("proposals").document("proposal-1").get()).to_dict()
    assert proposal["status"] == "pending"


async def test_reject_challenge_cannot_be_used_to_approve(client, fake_db, monkeypatch):
    owner = Account.create()
    await _seed_pending_proposal(fake_db, owner.address)
    challenge = await _challenge(client, action="reject")
    signature = _sign(owner, challenge["message"])
    called = False

    async def _unexpected_web3_call(**kwargs):
        nonlocal called
        called = True
        return {}

    monkeypatch.setattr("routers.proposals.web3_service.send_record_executed_proposal_tx", _unexpected_web3_call)

    response = await client.post(
        "/api/v1/proposals/proposal-1/approve",
        json={"nonce": challenge["nonce"], "signer_wallet": owner.address, "signature": signature},
    )

    assert response.status_code == 401
    assert called is False