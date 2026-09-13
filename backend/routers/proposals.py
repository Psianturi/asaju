"""
POST /api/v1/agent/{agent_id}/propose        — Gemini generates a strategic proposal.
GET  /api/v1/agent/{agent_id}/proposals      — List proposals for an agent.
POST /api/v1/proposals/{proposal_id}/approve — Validate + recordExecutedProposal() on V4.
POST /api/v1/proposals/{proposal_id}/reject  — Mark proposal as rejected.

Flow:
  1. User clicks "Request Strategic Consult" on AgentCard.
  2. Backend fetches agent context + event history from Firestore.
  3. Gemini generates a proposal (title + description + category).
  4. Proposal saved to Firestore with keccak256 hash + 7-day TTL.
  5. User approves → backend calls recordExecutedProposal() via MINTER_ROLE.
  6. V4 emits ProposalExecuted: +5 heritageScore on-chain.
  7. Firestore updated: status=approved, tx_hash, heritage_score_after.
"""

from collections import defaultdict, deque
from typing import Literal
import logging
import secrets
import time

from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request
from google.cloud import firestore
from pydantic import BaseModel, field_validator
from web3 import Web3

from core.config import settings
from core.database import get_db
from core.kms_service import decrypt_private_key
from google.cloud.firestore_v1.base_query import FieldFilter
from services.llm_service import ProposalGenerationError, generate_agent_proposal
from services.market_data_service import get_market_snapshot
from services.web3_service import web3_service

AUDIT_COLLECTION = "audit_events"

logger = logging.getLogger(__name__)
router = APIRouter(tags=["proposals"])

AGENTS_COLLECTION = "agents"
EVENTS_COLLECTION = "agent_events"
PROPOSALS_COLLECTION = "proposals"
APPROVAL_CHALLENGES_COLLECTION = "proposal_approval_challenges"
EXECUTION_CHALLENGES_COLLECTION = "proposal_execution_challenges"

PROPOSAL_TTL_SECONDS = 7 * 24 * 3600  # 7 days
HERITAGE_XP_PER_PROPOSAL = 5
APPROVAL_CHALLENGE_TTL_SECONDS = 10 * 60
APPROVAL_RATE_LIMIT_WINDOW_SECONDS = 60
APPROVAL_RATE_LIMIT_MAX_ATTEMPTS = 5
_approval_attempts: dict[str, deque[float]] = defaultdict(deque)

MARKET_CONTEXT_STALENESS_THRESHOLD_SECONDS = 3600  # 1 hour


def _market_context_status(market_context: dict | None) -> Literal["available", "stale", "unavailable"]:
    """Determine market data freshness for proposal audit trail."""
    if market_context is None:
        return "unavailable"
    generated_at = market_context.get("generated_at")
    if not generated_at:
        return "unavailable"
    if time.time() - generated_at > MARKET_CONTEXT_STALENESS_THRESHOLD_SECONDS:
        return "stale"
    return "available"


def _write_audit_event(
    db,
    actor_wallet: str,
    agent_id: str,
    action: str,
    *,
    status: str = "success",
    proposal_id: str | None = None,
    proposal_hash: str | None = None,
    tx_hash: str | None = None,
    failure_reason: str | None = None,
    extra: dict | None = None,
) -> None:
    """Write an immutable audit event to Firestore. Failures are logged but never raised."""
    event: dict[str, object] = {
        "actor_wallet": actor_wallet,
        "agent_id": agent_id,
        "action": action,
        "status": status,
        "timestamp": time.time(),
    }
    if proposal_id is not None:
        event["proposal_id"] = proposal_id
    if proposal_hash is not None:
        event["proposal_hash"] = proposal_hash
    if tx_hash is not None:
        event["tx_hash"] = tx_hash
    if failure_reason is not None:
        event["failure_reason"] = failure_reason
    if extra is not None:
        event.update(extra)
    try:
        db.collection(AUDIT_COLLECTION).add(event)
    except Exception as exc:
        logger.warning("Failed to write audit event %s for agent %s: %s", action, agent_id, exc)


# ── Models ────────────────────────────────────────────────────────────────────


class ProposalResponse(BaseModel):
    proposal_id: str
    agent_id: str
    agent_wallet: str
    title: str
    description: str
    category: str
    proposal_hash: str
    status: str
    created_at: float
    expires_at: float
    tx_hash: str | None = None
    heritage_score_after: int | None = None
    proposals_approved_total: int | None = None
    autonomous_execution_triggered: bool | None = None
    autonomous_transfer_tx: str | None = None
    autonomous_transfer_status: str | None = None
    autonomous_transfer_amount_mnt: float | None = None
    market_context: dict | None = None
    market_context_status: Literal["available", "stale", "unavailable"] = "unavailable"


class ApprovalChallengeResponse(BaseModel):
    nonce: str
    message: str
    expires_at: float


class ApprovalAuthorizationRequest(BaseModel):
    nonce: str
    signer_wallet: str
    signature: str

    @field_validator("signer_wallet")
    @classmethod
    def validate_wallet(cls, value: str) -> str:
        if not Web3.is_address(value):
            raise ValueError("Invalid Ethereum wallet address")
        return Web3.to_checksum_address(value)

    @field_validator("nonce", "signature")
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Value must not be empty")
        return value


# ── Helpers ───────────────────────────────────────────────────────────────────


def _compute_proposal_hash(agent_wallet: str, title: str, created_at: float) -> str:
    """Deterministic keccak256 — verifiable against ProposalExecuted event on MantleScan."""
    return Web3.keccak(text=f"{agent_wallet}:{title}:{created_at}").hex()


def _approval_message(
    proposal_id: str,
    proposal_hash: str,
    agent_wallet: str,
    owner_wallet: str,
    nonce: str,
    expires_at: float,
    action: str = "approve",
) -> str:
    return (
        "ASAJU AI Proposal Approval\n"
        f"Action: {action} strategic proposal\n"
        f"Proposal ID: {proposal_id}\n"
        f"Proposal hash: {proposal_hash}\n"
        f"Agent wallet: {agent_wallet}\n"
        f"Owner wallet: {owner_wallet}\n"
        f"Nonce: {nonce}\n"
        f"Expires at: {int(expires_at)}\n"
        f"This signature approves the proposal and records +5 heritage score on-chain.\n"
        f"Note: This action may trigger a 0.1 MNT autonomous transfer from the agent wallet "
        f"({agent_wallet}) as part of DeFi execution. The transfer is not from your wallet."
    )


def _enforce_proposal_action_rate_limit(request: Request, proposal_id: str) -> None:
    client_host = request.client.host if request.client else "unknown"
    key = f"{client_host}:{proposal_id}"
    now = time.time()
    attempts = _approval_attempts[key]
    while attempts and now - attempts[0] >= APPROVAL_RATE_LIMIT_WINDOW_SECONDS:
        attempts.popleft()
    if len(attempts) >= APPROVAL_RATE_LIMIT_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=429,
            detail="Too many approval attempts. Try again in one minute.",
        )
    attempts.append(now)


async def _consume_approval_challenge(
    db,
    challenge_ref,
    proposal_ref,
    now: float,
    *,
    expected_action: str,
    next_status: str,
    status_timestamp_field: str,
) -> dict:
    """Atomically consume a valid, action-matched challenge and reserve its proposal."""

    def validate_and_mark(challenge_data: dict | None, proposal_data: dict | None) -> dict:
        if not challenge_data or challenge_data.get("used_at"):
            raise HTTPException(status_code=401, detail="Approval authorization has already been used")
        if challenge_data.get("expires_at", 0) < now:
            raise HTTPException(status_code=401, detail="Approval authorization has expired")
        if challenge_data.get("action") != expected_action:
            raise HTTPException(status_code=401, detail="Approval authorization was issued for a different action")
        if not proposal_data or proposal_data.get("status") != "pending":
            raise HTTPException(status_code=409, detail="Proposal is no longer pending")
        if proposal_data.get("expires_at", 0) < now:
            raise HTTPException(status_code=409, detail="Proposal has expired")
        return proposal_data

    if not hasattr(db, "transaction"):
        # The in-memory test database has no transaction support. Production Firestore
        # always takes the atomic path below.
        challenge_snapshot = await challenge_ref.get()
        proposal_snapshot = await proposal_ref.get()
        proposal_data = validate_and_mark(
            challenge_snapshot.to_dict() if challenge_snapshot.exists else None,
            proposal_snapshot.to_dict() if proposal_snapshot.exists else None,
        )
        await challenge_ref.update({"used_at": now})
        await proposal_ref.update({"status": next_status, status_timestamp_field: now})
        return proposal_data

    transaction = db.transaction()

    @firestore.async_transactional
    async def consume(transaction):
        challenge_snapshot = await challenge_ref.get(transaction=transaction)
        proposal_snapshot = await proposal_ref.get(transaction=transaction)
        proposal_data = validate_and_mark(
            challenge_snapshot.to_dict() if challenge_snapshot.exists else None,
            proposal_snapshot.to_dict() if proposal_snapshot.exists else None,
        )
        transaction.update(challenge_ref, {"used_at": now})
        transaction.update(proposal_ref, {"status": next_status, status_timestamp_field: now})
        return proposal_data

    return await consume(transaction)


async def _verify_proposal_action_signature(db, proposal_id: str, authorization: "ApprovalAuthorizationRequest"):
    """Fetch the challenge, verify its signature and ownership. Returns (challenge_ref, challenge_data)."""
    try:
        challenge_ref = db.collection(APPROVAL_CHALLENGES_COLLECTION).document(authorization.nonce)
        challenge_doc = await challenge_ref.get()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Approval authorization could not be verified") from exc

    challenge_data = (challenge_doc.to_dict() or {}) if challenge_doc.exists else {}
    if not challenge_doc.exists or challenge_data.get("proposal_id") != proposal_id:
        raise HTTPException(status_code=401, detail="Approval authorization is invalid")

    try:
        recovered_wallet = Web3.to_checksum_address(
            Account.recover_message(
                encode_defunct(text=challenge_data.get("message", "")),
                signature=authorization.signature,
            )
        )
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Approval signature is invalid") from exc

    owner_wallet = challenge_data.get("owner_wallet", "")
    if recovered_wallet != authorization.signer_wallet:
        raise HTTPException(status_code=401, detail="Signature does not match the claimed wallet")
    if not Web3.is_address(owner_wallet) or recovered_wallet != Web3.to_checksum_address(owner_wallet):
        raise HTTPException(status_code=403, detail="Only the agent owner can act on this proposal")

    return challenge_ref, challenge_data


def _doc_to_response(doc_id: str, data: dict) -> ProposalResponse:
    return ProposalResponse(
        proposal_id=doc_id,
        agent_id=data["agent_id"],
        agent_wallet=data["agent_wallet"],
        title=data["title"],
        description=data["description"],
        category=data["category"],
        proposal_hash=data["proposal_hash"],
        status=data["status"],
        created_at=data["created_at"],
        expires_at=data["expires_at"],
        tx_hash=data.get("tx_hash"),
        heritage_score_after=data.get("heritage_score_after"),
        proposals_approved_total=data.get("proposals_approved_total"),
        autonomous_execution_triggered=data.get("autonomous_execution_triggered"),
        autonomous_transfer_tx=data.get("autonomous_transfer_tx"),
        autonomous_transfer_status=data.get("autonomous_transfer_status"),
        autonomous_transfer_amount_mnt=data.get("autonomous_transfer_amount_mnt"),
        market_context=data.get("market_context"),
        market_context_status=data.get("market_context_status", "unavailable"),
    )


# ── Background task ───────────────────────────────────────────────────────────


async def _bg_autonomous_transfer(
    proposal_id: str,
    agent_id: str,
    agent_wallet: str,
    agent_private_key: str,
    chain_id: int = 5003,
) -> None:
    """
    Semi-Autonomous Proposal Execution (Option A):
    After a DeFi proposal is approved on-chain, the agent's own wallet
    transfers 0.1 native token to the autonomous vault — no human keystroke required.
    """
    vault_address = settings.autonomous_vault_address
    if not vault_address or not Web3.is_address(vault_address):
        logger.warning(
            "Autonomous transfer skipped: AUTONOMOUS_VAULT_ADDRESS not configured (proposal %s)",
            proposal_id,
        )
        return

    db = get_db()
    try:
        result = await web3_service.execute_autonomous_transfer(
            agent_wallet=agent_wallet,
            agent_private_key=agent_private_key,
            amount_mnt=0.1,
            vault_address=vault_address,
            chain_id=chain_id,
        )
        logger.info(
            "Autonomous transfer complete for proposal %s: tx=%s status=%s",
            proposal_id, result.get("tx_hash"), result.get("status"),
        )
        await db.collection(PROPOSALS_COLLECTION).document(proposal_id).update({
            "autonomous_transfer_tx": result.get("tx_hash"),
            "autonomous_transfer_status": result.get("status"),
            "autonomous_transfer_amount_mnt": result.get("amount_mnt"),
            "autonomous_transfer_at": time.time(),
        })
    except Exception as exc:
        logger.error(
            "Autonomous transfer failed for proposal %s (agent %s): %s",
            proposal_id, agent_id, exc,
        )
        try:
            await db.collection(PROPOSALS_COLLECTION).document(proposal_id).update({
                "autonomous_transfer_status": "failed",
                "autonomous_transfer_error": str(exc)[:200],
            })
        except Exception:
            pass


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("/api/v1/agent/{agent_id}/propose", response_model=ProposalResponse, status_code=201)
async def generate_proposal(agent_id: str) -> ProposalResponse:
    """
    Gemini analyses the agent's event history and generates a strategic proposal.
    Saved to Firestore with a 7-day TTL and keccak256 hash for on-chain auditability.
    """
    db = get_db()

    # Fetch agent
    try:
        agent_doc = await db.collection(AGENTS_COLLECTION).document(agent_id).get()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Database temporarily unavailable") from exc

    if not agent_doc.exists:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")

    agent_data = agent_doc.to_dict() or {}
    agent_wallet = agent_data.get("agent_wallet", "")
    agent_name = agent_data.get("agent_name", "Agent")
    niche = agent_data.get("niche", "General")
    level = agent_data.get("level", 1)
    generation = agent_data.get("generation", 1)
    genetic_traits = agent_data.get("genetic_traits") or []

    if not agent_wallet:
        raise HTTPException(status_code=400, detail="Agent has no wallet address")

    # Fetch event history for context
    event_summaries: list[str] = []
    try:
        async for ev_doc in (
            db.collection(EVENTS_COLLECTION)
            .where(filter=FieldFilter("agent_id", "==", agent_id))
            .stream()
        ):
            ev = ev_doc.to_dict() or {}
            title = ev.get("event_title", "")
            summary = ev.get("wisdom_summary", "")
            if title and summary:
                event_summaries.append(f"{title}: {summary}")
    except Exception as exc:
        logger.warning("Could not fetch event history for proposal: %s", exc)

    # Best-effort market context — a provider outage must never block proposal
    # generation, so failures here are swallowed and logged, not raised.
    market_context: dict | None = None
    try:
        market_context = await get_market_snapshot()
    except Exception as exc:
        logger.warning("Market snapshot unavailable for proposal (agent %s): %s", agent_id, exc)

    market_context_status = _market_context_status(market_context)

    # Generate proposal via Gemini
    try:
        proposal_data = await generate_agent_proposal(
            agent_name=agent_name,
            niche=niche,
            level=level,
            generation=generation,
            genetic_traits=genetic_traits,
            event_summaries=event_summaries[:6],
            market_context=market_context,
        )
    except Exception as exc:
        logger.error("Gemini proposal generation failed for agent %s: %s", agent_id, exc)
        raise HTTPException(status_code=503, detail="Proposal generation failed — LLM unavailable")

    # Block DeFi proposals when market context is unavailable or stale
    if proposal_data["category"] == "defi" and market_context_status in ("unavailable", "stale"):
        raise HTTPException(
            status_code=422,
            detail=f"DeFi proposals require fresh market data. Current market context is {market_context_status}. "
                   "Please try again when market data is available.",
        )

    now = time.time()
    proposal_hash = _compute_proposal_hash(agent_wallet, proposal_data["title"], now)

    proposal_doc = {
        "agent_id": agent_id,
        "agent_wallet": agent_wallet,
        "title": proposal_data["title"],
        "description": proposal_data["description"],
        "category": proposal_data["category"],
        "proposal_hash": proposal_hash,
        "status": "pending",
        "created_at": now,
        "expires_at": now + PROPOSAL_TTL_SECONDS,
        "market_context": market_context,
        "market_context_status": market_context_status,
    }

    try:
        _, doc_ref = await db.collection(PROPOSALS_COLLECTION).add(proposal_doc)
    except Exception as exc:
        logger.error("Firestore proposal save failed for agent %s: %s", agent_id, exc)
        raise HTTPException(status_code=503, detail="Failed to persist proposal")

    logger.info(
        "Proposal generated for agent %s: '%s' (hash: %s)",
        agent_id, proposal_data["title"], proposal_hash[:12],
    )
    _write_audit_event(
        db,
        actor_wallet=agent_data.get("user_wallet", ""),
        agent_id=agent_id,
        action="proposal_generated",
        status="success",
        proposal_id=doc_ref.id,
        proposal_hash=proposal_hash,
        extra={
            "category": proposal_data["category"],
            "market_context_status": market_context_status,
        },
    )
    return _doc_to_response(doc_ref.id, proposal_doc)


@router.get("/api/v1/agent/{agent_id}/proposals", response_model=list[ProposalResponse])
async def list_agent_proposals(agent_id: str) -> list[ProposalResponse]:
    """Return all proposals for an agent, auto-expiring stale ones."""
    db = get_db()

    try:
        agent_doc = await db.collection(AGENTS_COLLECTION).document(agent_id).get()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Database temporarily unavailable") from exc

    if not agent_doc.exists:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")

    now = time.time()
    results: list[ProposalResponse] = []

    try:
        async for doc in (
            db.collection(PROPOSALS_COLLECTION)
            .where(filter=FieldFilter("agent_id", "==", agent_id))
            .stream()
        ):
            data = doc.to_dict() or {}
            # Auto-expire: mark as expired if TTL passed and still pending
            if data.get("status") == "pending" and data.get("expires_at", 0) < now:
                try:
                    await doc.reference.update({"status": "expired"})
                    data["status"] = "expired"
                except Exception:
                    pass
            results.append(_doc_to_response(doc.id, data))
    except Exception as exc:
        logger.error("Firestore proposal list failed for agent %s: %s", agent_id, exc)
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")

    results.sort(key=lambda p: p.created_at, reverse=True)
    logger.info("Listed %d proposals for agent %s", len(results), agent_id)
    return results


@router.post(
    "/api/v1/proposals/{proposal_id}/approval-challenge",
    response_model=ApprovalChallengeResponse,
)
async def create_approval_challenge(
    proposal_id: str,
    action: str = Query("approve", pattern="^(approve|reject)$"),
) -> ApprovalChallengeResponse:
    """Create a short-lived, single-use owner-wallet challenge for approve or reject."""
    db = get_db()
    proposal_ref = db.collection(PROPOSALS_COLLECTION).document(proposal_id)

    try:
        proposal_doc = await proposal_ref.get()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Database temporarily unavailable") from exc

    if not proposal_doc.exists:
        raise HTTPException(status_code=404, detail="Proposal not found")
    proposal_data = proposal_doc.to_dict() or {}
    now = time.time()
    if proposal_data.get("status") != "pending":
        raise HTTPException(status_code=422, detail="Only pending proposals can be actioned")
    if proposal_data.get("expires_at", 0) < now:
        raise HTTPException(status_code=422, detail="Proposal has expired")

    agent_id = proposal_data.get("agent_id", "")
    agent_doc = await db.collection(AGENTS_COLLECTION).document(agent_id).get()
    agent_data = (agent_doc.to_dict() or {}) if agent_doc.exists else {}
    owner_wallet = agent_data.get("user_wallet", "")
    agent_wallet = proposal_data.get("agent_wallet", "")
    proposal_hash = proposal_data.get("proposal_hash", "")
    if not Web3.is_address(owner_wallet) or not Web3.is_address(agent_wallet) or not proposal_hash:
        raise HTTPException(status_code=400, detail="Proposal or agent ownership data is incomplete")

    owner_wallet = Web3.to_checksum_address(owner_wallet)
    agent_wallet = Web3.to_checksum_address(agent_wallet)
    nonce = secrets.token_urlsafe(32)
    expires_at = now + APPROVAL_CHALLENGE_TTL_SECONDS
    message = _approval_message(
        proposal_id,
        proposal_hash,
        agent_wallet,
        owner_wallet,
        nonce,
        expires_at,
        action=action,
    )
    await db.collection(APPROVAL_CHALLENGES_COLLECTION).document(nonce).set(
        {
            "proposal_id": proposal_id,
            "agent_id": agent_id,
            "owner_wallet": owner_wallet,
            "action": action,
            "message": message,
            "expires_at": expires_at,
            "used_at": None,
            "created_at": now,
        }
    )
    return ApprovalChallengeResponse(nonce=nonce, message=message, expires_at=expires_at)


@router.post("/api/v1/proposals/{proposal_id}/approve", response_model=ProposalResponse)
async def approve_proposal(
    proposal_id: str,
    authorization: ApprovalAuthorizationRequest,
    request: Request,
) -> ProposalResponse:
    """
    Validate proposal → call recordExecutedProposal() on V4 via MINTER_ROLE.
    V4 emits ProposalExecuted: +5 heritageScore on-chain.
    """
    _enforce_proposal_action_rate_limit(request, proposal_id)
    db = get_db()

    try:
        doc = await db.collection(PROPOSALS_COLLECTION).document(proposal_id).get()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Database temporarily unavailable") from exc

    if not doc.exists:
        raise HTTPException(status_code=404, detail="Proposal not found")

    data = doc.to_dict() or {}

    agent_wallet = data.get("agent_wallet", "")
    proposal_hash = data.get("proposal_hash", "")

    if not agent_wallet or not proposal_hash:
        raise HTTPException(status_code=400, detail="Proposal missing wallet or hash")

    agent_id = data.get("agent_id", "")
    challenge_ref, _ = await _verify_proposal_action_signature(db, proposal_id, authorization)

    proposal_ref = db.collection(PROPOSALS_COLLECTION).document(proposal_id)
    now = time.time()
    await _consume_approval_challenge(
        db, challenge_ref, proposal_ref, now,
        expected_action="approve", next_status="approving", status_timestamp_field="approval_started_at",
    )

    # Resolve the chain only after the signature is valid and the proposal has
    # been atomically reserved, so unauthorised requests never reach Web3/KMS.
    agent_doc_for_chain = await db.collection(AGENTS_COLLECTION).document(agent_id).get()
    agent_data_for_chain = (agent_doc_for_chain.to_dict() or {}) if agent_doc_for_chain.exists else {}
    agent_chain_id = agent_data_for_chain.get("chain_id", 5003)

    # Call recordExecutedProposal() on V4
    try:
        result = await web3_service.send_record_executed_proposal_tx(
            agent_wallet=agent_wallet,
            proposal_hash_hex=proposal_hash,
            chain_id=agent_chain_id,
        )
    except Exception as exc:
        await proposal_ref.update({"status": "pending", "approval_failed_at": time.time()})
        logger.error("recordExecutedProposal tx failed for proposal %s: %s", proposal_id, exc)
        raise HTTPException(status_code=503, detail=f"On-chain execution failed: {exc}")

    if result.get("status") != "success":
        await proposal_ref.update({"status": "pending", "approval_failed_at": time.time()})
        raise HTTPException(status_code=502, detail="Transaction reverted on-chain")

    update_payload = {
        "status": "approved",
        "tx_hash": result.get("tx_hash"),
        "heritage_score_after": result.get("heritage_score_after"),
        "proposals_approved_total": result.get("proposals_approved_total"),
        "approved_at": time.time(),
    }
    try:
        await doc.reference.update(update_payload)
    except Exception as exc:
        logger.warning("Firestore proposal update failed after on-chain success: %s", exc)

    data.update(update_payload)
    logger.info(
        "Proposal %s approved on-chain: tx=%s heritage=%s",
        proposal_id, result.get("tx_hash"), result.get("heritage_score_after"),
    )
    _write_audit_event(
        db,
        actor_wallet=authorization.signer_wallet,
        agent_id=agent_id,
        action="proposal_approved",
        status="success",
        proposal_id=proposal_id,
        proposal_hash=proposal_hash,
        tx_hash=result.get("tx_hash"),
        extra={
            "category": data.get("category"),
            "heritage_score_after": result.get("heritage_score_after"),
            "autonomous_execution_triggered": data.get("category") == "defi",
        },
    )

    # ── Option A: Semi-Autonomous Execution for DeFi proposals ───────────────
    # TODO(architectural): Per P1 decision, autonomous transfer should require a
    # Per P1 architectural decision: autonomous transfer requires a separate owner approval.
    # See: CURRENT_STATUS_AUDIT_2026-09-12.md decision #2.
    # The /{proposal_id}/execute endpoint handles this with its own signature challenge.

    return _doc_to_response(proposal_id, data)


@router.post("/api/v1/proposals/{proposal_id}/reject", response_model=ProposalResponse)
async def reject_proposal(
    proposal_id: str,
    authorization: ApprovalAuthorizationRequest,
    request: Request,
) -> ProposalResponse:
    """Mark a pending proposal as rejected (no on-chain action). Owner-signature gated,
    same as approval — a rejection changes the agent's proposal history, so it should
    not be callable by anyone who merely knows the proposal_id."""
    _enforce_proposal_action_rate_limit(request, proposal_id)
    db = get_db()

    try:
        doc = await db.collection(PROPOSALS_COLLECTION).document(proposal_id).get()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Database temporarily unavailable") from exc

    if not doc.exists:
        raise HTTPException(status_code=404, detail="Proposal not found")

    data = doc.to_dict() or {}
    challenge_ref, challenge_data = await _verify_proposal_action_signature(db, proposal_id, authorization)

    proposal_ref = db.collection(PROPOSALS_COLLECTION).document(proposal_id)
    now = time.time()
    await _consume_approval_challenge(
        db, challenge_ref, proposal_ref, now,
        expected_action="reject", next_status="rejected", status_timestamp_field="rejected_at",
    )

    data["status"] = "rejected"
    logger.info("Proposal %s rejected by owner", proposal_id)
    _write_audit_event(
        db,
        actor_wallet=authorization.signer_wallet,
        agent_id=data.get("agent_id", ""),
        action="proposal_rejected",
        status="success",
        proposal_id=proposal_id,
        proposal_hash=data.get("proposal_hash"),
    )
    return _doc_to_response(proposal_id, data)


class ExecutionChallengeResponse(BaseModel):
    nonce: str
    message: str
    expires_at: float


class ExecutionAuthorizationRequest(BaseModel):
    nonce: str
    signer_wallet: str
    signature: str

    @field_validator("signer_wallet")
    @classmethod
    def validate_wallet(cls, value: str) -> str:
        if not Web3.is_address(value):
            raise ValueError("Invalid Ethereum wallet address")
        return Web3.to_checksum_address(value)

    @field_validator("nonce", "signature")
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Value must not be empty")
        return value


def _execution_message(
    proposal_id: str,
    proposal_hash: str,
    agent_wallet: str,
    vault_address: str,
    amount_mnt: float,
    owner_wallet: str,
    nonce: str,
    expires_at: float,
) -> str:
    return (
        "ASAJU DeFi Execution Authorization\n"
        f"Proposal ID: {proposal_id}\n"
        f"Proposal hash: {proposal_hash}\n"
        f"Agent wallet: {agent_wallet}\n"
        f"Transfer to vault: {vault_address}\n"
        f"Amount: {amount_mnt} MNT\n"
        f"Owner wallet: {owner_wallet}\n"
        f"Nonce: {nonce}\n"
        f"Expires at: {int(expires_at)}\n"
        f"This authorizes a {amount_mnt} MNT transfer from the agent wallet to the vault."
    )


def _enforce_execution_rate_limit(request: Request, proposal_id: str) -> None:
    client_host = request.client.host if request.client else "unknown"
    key = f"{client_host}:execute:{proposal_id}"
    now = time.time()
    attempts = _approval_attempts[key]
    while attempts and now - attempts[0] >= APPROVAL_RATE_LIMIT_WINDOW_SECONDS:
        attempts.popleft()
    if len(attempts) >= APPROVAL_RATE_LIMIT_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=429,
            detail="Too many execution attempts. Try again in one minute.",
        )
    attempts.append(now)


@router.post(
    "/api/v1/proposals/{proposal_id}/execution-challenge",
    response_model=ExecutionChallengeResponse,
)
async def create_execution_challenge(
    proposal_id: str,
    request: Request,
) -> ExecutionChallengeResponse:
    """Create a single-use challenge for autonomous DeFi execution (transfer from agent wallet)."""
    _enforce_execution_rate_limit(request, proposal_id)
    db = get_db()

    try:
        doc = await db.collection(PROPOSALS_COLLECTION).document(proposal_id).get()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Database temporarily unavailable") from exc

    if not doc.exists:
        raise HTTPException(status_code=404, detail="Proposal not found")

    data = doc.to_dict() or {}

    if data.get("status") != "approved":
        raise HTTPException(status_code=422, detail="Only approved proposals can be executed")
    if data.get("category") != "defi":
        raise HTTPException(status_code=422, detail="Only DeFi proposals require execution")
    if data.get("autonomous_execution_triggered"):
        raise HTTPException(status_code=422, detail="Execution has already been triggered for this proposal")

    agent_id = data.get("agent_id", "")
    agent_doc = await db.collection(AGENTS_COLLECTION).document(agent_id).get()
    agent_data = (agent_doc.to_dict() or {}) if agent_doc.exists else {}
    owner_wallet = agent_data.get("user_wallet", "")
    agent_wallet = data.get("agent_wallet", "")
    proposal_hash = data.get("proposal_hash", "")
    vault_address = settings.autonomous_vault_address

    if not all(Web3.is_address(a) for a in [owner_wallet, agent_wallet, vault_address]):
        raise HTTPException(status_code=400, detail="Agent or vault wallet address is invalid")

    owner_wallet = Web3.to_checksum_address(owner_wallet)
    agent_wallet = Web3.to_checksum_address(agent_wallet)
    nonce = secrets.token_urlsafe(32)
    expires_at = time.time() + APPROVAL_CHALLENGE_TTL_SECONDS
    message = _execution_message(
        proposal_id,
        proposal_hash,
        agent_wallet,
        vault_address,
        0.1,
        owner_wallet,
        nonce,
        expires_at,
    )
    await db.collection(EXECUTION_CHALLENGES_COLLECTION).document(nonce).set(
        {
            "proposal_id": proposal_id,
            "agent_id": agent_id,
            "owner_wallet": owner_wallet,
            "agent_wallet": agent_wallet,
            "vault_address": vault_address,
            "amount_mnt": 0.1,
            "message": message,
            "expires_at": expires_at,
            "used_at": None,
            "created_at": time.time(),
        }
    )
    return ExecutionChallengeResponse(nonce=nonce, message=message, expires_at=expires_at)


@router.post("/api/v1/proposals/{proposal_id}/execute", response_model=ProposalResponse)
async def execute_proposal_transfer(
    proposal_id: str,
    authorization: ExecutionAuthorizationRequest,
    request: Request,
) -> ProposalResponse:
    """
    Execute the autonomous transfer for an approved DeFi proposal.
    Requires a separate owner signature bound to the execution challenge (not the proposal hash).
    """
    _enforce_execution_rate_limit(request, proposal_id)
    db = get_db()

    try:
        challenge_ref = db.collection(EXECUTION_CHALLENGES_COLLECTION).document(authorization.nonce)
        challenge_doc = await challenge_ref.get()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Execution authorization could not be verified") from exc

    challenge_data = (challenge_doc.to_dict() or {}) if challenge_doc.exists else {}
    if not challenge_doc.exists or challenge_data.get("proposal_id") != proposal_id:
        raise HTTPException(status_code=401, detail="Execution authorization is invalid")

    now = time.time()
    if challenge_data.get("used_at"):
        raise HTTPException(status_code=401, detail="Execution authorization has already been used")
    if challenge_data.get("expires_at", 0) < now:
        raise HTTPException(status_code=401, detail="Execution authorization has expired")

    try:
        recovered_wallet = Web3.to_checksum_address(
            Account.recover_message(
                encode_defunct(text=challenge_data.get("message", "")),
                signature=authorization.signature,
            )
        )
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Execution signature is invalid") from exc

    owner_wallet = challenge_data.get("owner_wallet", "")
    if recovered_wallet != authorization.signer_wallet:
        raise HTTPException(status_code=401, detail="Signature does not match the claimed wallet")
    if not Web3.is_address(owner_wallet) or recovered_wallet != Web3.to_checksum_address(owner_wallet):
        raise HTTPException(status_code=403, detail="Only the agent owner can authorize execution")

    await challenge_ref.update({"used_at": now})

    doc = await db.collection(PROPOSALS_COLLECTION).document(proposal_id).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Proposal not found")
    data = doc.to_dict() or {}
    agent_id = data.get("agent_id", "")

    agent_doc = await db.collection(AGENTS_COLLECTION).document(agent_id).get()
    agent_data = (agent_doc.to_dict() or {}) if agent_doc.exists else {}
    stored_key = agent_data.get("private_key_enc") or agent_data.get("private_key")
    if not stored_key:
        _write_audit_event(
            db,
            actor_wallet=recovered_wallet,
            agent_id=agent_id,
            action="proposal_executed",
            status="failure",
            proposal_id=proposal_id,
            proposal_hash=data.get("proposal_hash"),
            failure_reason="Agent has no private key",
        )
        raise HTTPException(status_code=400, detail="Agent has no private key — cannot execute transfer")

    agent_private_key = decrypt_private_key(stored_key)
    agent_chain_id = agent_data.get("chain_id", 5003)

    try:
        result = await web3_service.execute_autonomous_transfer(
            agent_wallet=challenge_data.get("agent_wallet"),
            agent_private_key=agent_private_key,
            amount_mnt=challenge_data.get("amount_mnt", 0.1),
            vault_address=challenge_data.get("vault_address"),
            chain_id=agent_chain_id,
        )
        await doc.reference.update({
            "autonomous_execution_triggered": True,
            "autonomous_transfer_tx": result.get("tx_hash"),
            "autonomous_transfer_status": result.get("status"),
            "autonomous_transfer_amount_mnt": result.get("amount_mnt"),
            "autonomous_executed_at": time.time(),
        })
        _write_audit_event(
            db,
            actor_wallet=recovered_wallet,
            agent_id=agent_id,
            action="proposal_executed",
            status=result.get("status", "unknown"),
            proposal_id=proposal_id,
            proposal_hash=data.get("proposal_hash"),
            tx_hash=result.get("tx_hash"),
        )
        logger.info(
            "Autonomous execution complete for proposal %s: tx=%s status=%s",
            proposal_id, result.get("tx_hash"), result.get("status"),
        )
    except Exception as exc:
        _write_audit_event(
            db,
            actor_wallet=recovered_wallet,
            agent_id=agent_id,
            action="proposal_executed",
            status="failure",
            proposal_id=proposal_id,
            proposal_hash=data.get("proposal_hash"),
            failure_reason=str(exc)[:200],
        )
        logger.error("Autonomous execution failed for proposal %s: %s", proposal_id, exc)
        raise HTTPException(status_code=503, detail=f"Execution failed: {exc}")

    updated_doc = await doc.reference.get()
    return _doc_to_response(proposal_id, updated_doc.to_dict() or data)
