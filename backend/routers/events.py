"""
POST /api/v1/event/attend  — Core agentic workflow.

Flow:
  A) Validate & sanitise event URL (SSRF guard)
  B) Gemini generates a Wisdom Summary from event metadata
  C) Agent self-signs mintAttendanceNFT() with its own key (Mode B)
     OR MINTER_SERVICE signs for admin/explicit Mode A operations
  D) Return tx hash + token ID + wisdom summary to frontend

Signing modes:
  Mode B (mode_b=True):  agent wallet signs + pays gas — true autonomy.
                         Requires isAgentSpawned=true on V4 contract.
  Mode A (mode_b=False): MINTER_SERVICE signs — for admin ops only.
"""

import asyncio
import logging
import time
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Query
from google.cloud.firestore_v1 import Increment
from google.cloud.firestore_v1.base_query import FieldFilter
from pydantic import BaseModel, field_validator
from web3 import Web3

from core.config import settings
from core.database import get_db
from core.kms_service import decrypt_private_key
from services.llm_service import classify_event_niche, summarize_event
from services.web3_service import web3_service

AGENTS_COLLECTION = "agents"
EVENTS_COLLECTION = "agent_events"

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/event", tags=["events"])

# Allowlist mirrors the frontend's cloudRunService.ts validateEventUrl()
_ALLOWED_HOSTS: frozenset[str] = frozenset(
    {
        "youtube.com",
        "www.youtube.com",
        "youtu.be",
    }
)

def _skill_gain_field(category: str, amount: int = 1) -> dict:
    """
    V1: flat +amount per event, regardless of wisdom quality — deliberately simple
    so skill growth stays explainable ("attended 1 X event = +1 X skill") and
    doesn't inherit risk from the not-yet-validated wisdom-quality scoring.
    Wrapped here so switching to quality-weighted gain later touches only this
    function, not every call site.
    """
    return {f"skill_scores.{category}": Increment(amount)}


def _resolve_explorer_base(chain_id: int = 5003) -> str:
    from core.config import CHAIN_CONFIGS
    # Allow Cloud Run env var override for Mantle only
    if chain_id == 5003 and settings.mantle_explorer_url.strip():
        return settings.mantle_explorer_url.strip().rstrip("/")
    cfg = CHAIN_CONFIGS.get(chain_id)
    if cfg:
        return cfg["explorer_url"].rstrip("/")
    return "https://explorer.sepolia.mantle.xyz"


# ── Request / Response models ─────────────────────────────────────────────────


class AttendRequest(BaseModel):
    agent_id: str
    agent_wallet: str       # NFT recipient (agent's derived address or user's wallet)
    agent_name: str
    event_url: str
    event_title: str = ""
    platform: str = "YouTube"
    niche: str = "General"
    mode_b: bool = False    # If True, agent signs with its own private key (autonomous); else backend signs (Mode A)
    chain_id: int = 5003

    @field_validator("agent_wallet")
    @classmethod
    def validate_wallet(cls, v: str) -> str:
        if not Web3.is_address(v):
            raise ValueError("Invalid Ethereum wallet address")
        return Web3.to_checksum_address(v)

    @field_validator("event_url")
    @classmethod
    def validate_event_url(cls, v: str) -> str:
        parsed = urlparse(v)
        if parsed.scheme != "https":
            raise ValueError("Event URL must use HTTPS")
        if parsed.hostname not in _ALLOWED_HOSTS:
            raise ValueError(
                f"Host '{parsed.hostname}' is not in the allowed event URL list"
            )
        return v


class AttendResponse(BaseModel):
    success: bool
    minted: bool  # False when this video was below the milestone threshold — analyzed, not minted
    tx_hash: str | None
    token_id: str | None
    wisdom_summary: str
    gas_used: str | None
    block_number: int | None
    explorer_url: str | None
    level_up: bool
    new_total_events: int | None = None
    new_level: int | None = None


class EventHistoryItem(BaseModel):
    id: str
    agent_id: str
    chain_id: int = 5003
    event_url: str
    event_title: str
    platform: str
    wisdom_summary: str
    tx_hash: str | None
    token_id: str | None
    gas_used: str | None
    block_number: int | None
    attended_at: float
    explorer_url: str | None


# ── Endpoint ──────────────────────────────────────────────────────────────────


@router.get("/list", response_model=list[EventHistoryItem])
async def list_events_by_wallet(
    wallet: str = Query(..., description="Owner wallet address (checksummed Ethereum address)"),
) -> list[EventHistoryItem]:
    """
    Return all persisted event records for agents owned by the wallet.

    This powers cross-device NFT/Event restoration on frontend wallet connect.
    """
    if not Web3.is_address(wallet):
        raise HTTPException(status_code=400, detail="Invalid wallet address")
    wallet = Web3.to_checksum_address(wallet)

    db = get_db()

    agent_ids: list[str] = []
    try:
        async for doc in (
            db.collection(AGENTS_COLLECTION)
            .where(filter=FieldFilter("user_wallet", "==", wallet))
            .stream()
        ):
            data = doc.to_dict() or {}
            agent_id = data.get("agent_id")
            if isinstance(agent_id, str) and agent_id:
                agent_ids.append(agent_id)
    except Exception as exc:
        logger.error("Firestore agent lookup failed for wallet %s: %s", wallet, exc)
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")

    if not agent_ids:
        return []

    records: list[dict] = []
    try:
        for agent_id in agent_ids:
            async for doc in (
                db.collection(EVENTS_COLLECTION)
                .where(filter=FieldFilter("agent_id", "==", agent_id))
                .stream()
            ):
                data = doc.to_dict() or {}
                records.append(
                    {
                        "id": doc.id,
                        "agent_id": data.get("agent_id", agent_id),
                        "chain_id": int(data.get("chain_id", 5003)),
                        "event_url": data.get("event_url", ""),
                        "event_title": data.get("event_title", "Event"),
                        "platform": data.get("platform", "YouTube"),
                        "wisdom_summary": data.get("wisdom_summary", ""),
                        "tx_hash": data.get("tx_hash"),
                        "token_id": data.get("token_id"),
                        "gas_used": data.get("gas_used"),
                        "block_number": data.get("block_number"),
                        "attended_at": float(data.get("attended_at", 0.0)),
                    }
                )
    except Exception as exc:
        logger.error("Firestore event query failed for wallet %s: %s", wallet, exc)
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")

    records.sort(key=lambda r: r.get("attended_at", 0.0), reverse=True)
    result: list[EventHistoryItem] = []
    for item in records:
        tx_hash = item.get("tx_hash")
        explorer_base = _resolve_explorer_base(item["chain_id"])
        result.append(
            EventHistoryItem(
                **item,
                explorer_url=f"{explorer_base}/tx/{tx_hash}" if tx_hash else None,
            )
        )

    logger.info("Listed %d persisted events for wallet %s", len(result), wallet[:10])
    return result


@router.post("/attend", response_model=AttendResponse)
async def attend_event(req: AttendRequest) -> AttendResponse:
    """
    Autonomous event-attendance workflow.

    Mode B (mode_b=True): Agent decrypts its own key and self-signs the TX.
                          Agent wallet pays gas. Requires isAgentSpawned=true on V4.
    Mode A (mode_b=False): MINTER_SERVICE signs (admin / explicit fallback).

    Step A — AI: Gemini generates a Wisdom Summary for the event.
    Step B — Web3: Agent signs mintAttendanceNFT() with its own key (Mode B).
    Step C — Return: tx hash, token ID, explorer link, and wisdom text.
    """
    # Guard: contract must be deployed before minting
    from core.config import CHAIN_CONFIGS
    if req.chain_id == 5003:
        contract_addr_check = settings.contract_address
    else:
        contract_addr_check = CHAIN_CONFIGS.get(req.chain_id, {}).get("contract_address", "")

    if not contract_addr_check or not Web3.is_address(contract_addr_check):
        raise HTTPException(
            status_code=503,
            detail=(
                f"Smart contract not configured for chain {req.chain_id}. "
                "Deploy the contract and update CHAIN_CONFIGS or CONTRACT_ADDRESS env var."
            ),
        )

    # Ensure a persisted agent cannot be accidentally operated on another chain.
    db = get_db()
    try:
        agent_doc = await db.collection(AGENTS_COLLECTION).document(req.agent_id).get()
    except Exception as exc:
        logger.error("Failed to load agent %s: %s", req.agent_id, exc)
        raise HTTPException(status_code=503, detail="Failed to retrieve agent state") from exc
    if not agent_doc.exists:
        raise HTTPException(status_code=404, detail=f"Agent '{req.agent_id}' not found")
    agent_data = agent_doc.to_dict() or {}
    if int(agent_data.get("chain_id", 5003)) != req.chain_id:
        raise HTTPException(status_code=409, detail="Agent is registered on a different network")

    if not req.event_title:
        req.event_title = "YouTube Event"

    # ── Mode B: load agent private key for true autonomous signing ────────
    agent_private_key: str | None = None
    agent_is_funded = False
    if req.mode_b:
        try:
            agent_is_funded = bool(agent_data.get("funded", False))
            stored_key = agent_data.get("private_key_enc") or agent_data.get("private_key")
            if not stored_key:
                raise HTTPException(
                    status_code=400,
                    detail="Agent has no private key stored (re-spawn agent to fix)",
                )
            try:
                agent_private_key = decrypt_private_key(stored_key)
            except Exception as kms_exc:
                logger.warning("KMS decrypt failed, using plaintext key: %s", kms_exc)
                agent_private_key = stored_key
            logger.info(
                "Mode B: agent %s will self-sign (funded=%s)",
                req.agent_id, agent_is_funded,
            )
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("Failed to load agent key for Mode B: %s", exc)
            raise HTTPException(status_code=503, detail="Failed to retrieve agent credentials")

    # ── Step A: Wisdom Summary ─────────────────────────────────────────────
    # Shared wisdom cache (Spektra-inspired): if this exact video was already
    # attested by another agent, include the prior wisdom as context so the
    # new summary is differentiated (not a duplicate), but never blocked.
    prior_wisdom_context: str | None = None
    try:
        # Match on canonical YouTube video ID so ?t= / &v= variants don't miss.
        from services.wisdom_cache import lookup_prior_wisdom
        prior_wisdom_context = await lookup_prior_wisdom(req.event_url, exclude_agent_id=req.agent_id, user_wallet=agent_data.get('user_wallet'))
    except Exception as exc:  # cache is best-effort — never block attendance
        logger.warning("Wisdom cache lookup failed (non-fatal): %s", exc)

    wisdom_summary = await summarize_event(
        event_title=req.event_title,
        event_url=req.event_url,
        platform=req.platform,
        agent_name=req.agent_name,
        prior_wisdom_context=prior_wisdom_context,
    )
    logger.info("Wisdom generated for agent %s: %.80s", req.agent_id, wisdom_summary)

    # ── Milestone gate: only mint when this video crosses a level boundary ──
    # Every video gets a wisdom summary and a Firestore record regardless (see
    # below); minting an on-chain NFT for every single one was burning an
    # agent's gas reserve linearly with usage for no added signal (see
    # docs/BUSINESS_MODEL_AND_ARCHITECTURE.md §7). Milestone = the same
    # level formula already used for progression, so "reaching level N"
    # stays the one, single definition of a milestone everywhere in the app.
    current_events = agent_data.get("total_events", 0)
    current_level = agent_data.get("level", 1)
    prospective_level = max(current_level, ((current_events + 1) // 2) + 1)
    should_mint = prospective_level > current_level

    # ── Steps B + C: Mint on Mantle (milestone videos only) ─────────────────
    # Mode B: agent signs with own key, agent pays gas (no fallback to minter).
    # Mode A: MINTER_SERVICE signs (admin ops, recordExecutedProposal, explicit Mode A).
    mint_result: dict = {}
    if should_mint:
        try:
            mint_result = await web3_service.mint_attendance_nft(
                agent_wallet=req.agent_wallet,
                event_title=req.event_title,
                event_url=req.event_url,
                platform=req.platform,
                agent_name=req.agent_name,
                summary=wisdom_summary,
                niche=req.niche,
                agent_private_key=agent_private_key,
                allow_mode_b_fallback=False,  # strict: agent must pay own gas, no silent minter fallback
                chain_id=req.chain_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except PermissionError as exc:
            raise HTTPException(
                status_code=422,
                detail={
                    "code": "AGENT_NOT_AUTHORIZED",
                    "message": str(exc),
                },
            )
        except RuntimeError as exc:
            msg = str(exc)
            code = "AGENT_OUT_OF_GAS" if "out of gas" in msg.lower() else "MODE_B_STRICT_REJECTED"
            raise HTTPException(
                status_code=422,
                detail={
                    "code": code,
                    "message": msg,
                },
            )
        except ConnectionError as exc:
            raise HTTPException(
                status_code=503, detail=f"Mantle RPC unavailable: {exc}"
            )
        except Exception as exc:
            logger.error("mintAttendanceNFT failed for agent %s: %s", req.agent_id, exc)
            raise HTTPException(
                status_code=500,
                detail="NFT minting failed. Check Cloud Run logs for details.",
            )
        tx_hash = mint_result.get("tx_hash")
        success = mint_result.get("status") == "success"
        level_up = mint_result.get("level_up", False)
        # signing_mode from web3_service reflects what actually signed (agent vs minter service)
        signing_mode = mint_result.get("signing_mode", "B" if req.mode_b else "A")
    else:
        # Below a milestone: no on-chain call, no gas spent. The video is still
        # fully analyzed and recorded (see the Firestore writes below) — it
        # just isn't proven on-chain until the agent's next level-up.
        tx_hash = None
        success = True
        level_up = False
        signing_mode = "none"
        logger.info(
            "Agent %s: video analyzed, milestone not reached (events %d→%d, level stays %d) — skipping mint",
            req.agent_id, current_events, current_events + 1, current_level,
        )

    explorer_base = _resolve_explorer_base(req.chain_id)

    # ── Update agent stats in Firestore ───────────────────────────────────
    detected_niche: str | None = None
    if success:
        detected_niche = await classify_event_niche(wisdom_summary)
    new_total_events: int | None = None
    new_level: int | None = None
    if success:
        agent_ref = db.collection(AGENTS_COLLECTION).document(req.agent_id)
        try:
            agent_doc = await agent_ref.get()
            if agent_doc.exists:
                data = agent_doc.to_dict() or {}
                autonomous_sigs = data.get("autonomous_signatures", 0)
                if signing_mode == "B":
                    autonomous_sigs += 1

                current_events = data.get("total_events", 0) + 1
                current_level = data.get("level", 1)
                new_level = max(current_level, (current_events // 2) + 1)
                if level_up and new_level <= current_level:
                    new_level = current_level + 1
                update_payload = {
                    "total_events": Increment(1),
                    "level": new_level,
                    "autonomous_signatures": autonomous_sigs,
                    **_skill_gain_field(detected_niche),
                }
                new_total_events = current_events
                logger.info(
                    "Agent %s stats updated: total_events=%d level=%d mode=%s",
                    req.agent_id, current_events, new_level, signing_mode,
                )

                await agent_ref.update(update_payload)
            else:
                logger.warning("Agent %s not found in Firestore — skipping stat update", req.agent_id)
        except Exception as exc:
            # Non-fatal: mint succeeded, stats update is best-effort
            logger.error("Firestore agent stat update failed for %s: %s", req.agent_id, exc)

        # ── Persist event record in Firestore ─────────────────────────────
        try:
            event_doc = {
                "user_wallet": agent_data.get("user_wallet", ""),
                "agent_id": req.agent_id,
                "agent_wallet": req.agent_wallet,
                "agent_name": req.agent_name,
                "chain_id": req.chain_id,
                "niche": req.niche,  # agent's static preset niche at time of attendance
                "detected_niche": detected_niche,  # V1: Gemini-classified actual content category
                "event_url": req.event_url,
                "event_title": req.event_title,
                "platform": req.platform,
                "wisdom_summary": wisdom_summary,
                "tx_hash": tx_hash,
                "token_id": mint_result.get("token_id"),
                "gas_used": str(mint_result.get("gas_used", "")),
                "block_number": mint_result.get("block_number"),
                "attended_at": time.time(),
                "mode": signing_mode,
                "minted": tx_hash is not None,
            }
            await db.collection(EVENTS_COLLECTION).add(event_doc)
        except Exception as exc:
            logger.error("Firestore event record save failed for agent %s: %s", req.agent_id, exc)

    return AttendResponse(
        success=success,
        minted=tx_hash is not None,
        tx_hash=tx_hash,
        token_id=mint_result.get("token_id"),
        wisdom_summary=wisdom_summary,
        gas_used=mint_result.get("gas_used"),
        block_number=mint_result.get("block_number"),
        explorer_url=f"{explorer_base}/tx/{tx_hash}" if tx_hash else None,
        level_up=level_up,
        new_total_events=new_total_events,
        new_level=new_level,
    )
