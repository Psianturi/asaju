"""Owner inbox aggregator — single endpoint that gathers everything waiting on
the owner across all agents (pending proposals, low-gas agents, paused scouts,
recent mints). Drives the global NotificationBell in the frontend.

Design:
- Per-owner isolation: every query is filtered by user_wallet.
- Best-effort: each aggregator section is wrapped in try/except so one
  failing query doesn't kill the whole inbox response.
- Capped at top N per section to keep payload small.
"""

import logging
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from google.cloud.firestore_v1.base_query import FieldFilter

from core.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/owner", tags=["owner"])

AGENTS_COLLECTION = "agents"
PROPOSALS_COLLECTION = "proposals"
SCOUT_LOGS_COLLECTION = "scout_logs"

INBOX_LIMIT_PER_SECTION = 10


async def _safe_call(coro, default):
    try:
        return await coro
    except Exception as exc:
        logger.warning("inbox aggregator call failed: %s", exc.__class__.__name__)
        return default


@router.get("/inbox")
async def get_owner_inbox(user_wallet: str = Query(...)) -> dict[str, Any]:
    """Aggregate everything waiting on the owner across all their agents.

    Sections:
      - pendingProposals: proposals awaiting approval (any category, including DeFi)
      - lowGasAgents: agents with agent_gas_balance < 0.05 MNT
      - pausedAgents: agents with auto_scout_enabled=False and a disable reason
      - recentMints: most recent scout_logs MINTED for any owned agent
    """
    if not user_wallet or not user_wallet.strip():
        raise HTTPException(status_code=400, detail="user_wallet required")

    wallet = user_wallet.lower() if isinstance(user_wallet, str) else user_wallet

    db = get_db()

    # Gather all owned agents first — every other section filters through this.
    owned_agents: list[dict] = []
    try:
        async for agent_doc in (
            db.collection(AGENTS_COLLECTION)
            .where(filter=FieldFilter("user_wallet", "==", wallet))
            .stream()
        ):
            data = agent_doc.to_dict() or {}
            data["agent_id"] = agent_doc.id
            owned_agents.append(data)
    except Exception as exc:
        logger.warning("inbox: owned agents fetch failed: %s", exc.__class__.__name__)

    agent_ids = [a.get("agent_id") for a in owned_agents if a.get("agent_id")]
    wallet_to_agent: dict[str, str] = {a.get("agent_wallet", ""): a.get("agent_id", "") for a in owned_agents}

    pending_proposals: list[dict] = []
    if agent_ids:
        async def _fetch_proposals():
            out: list[dict] = []
            for aid in agent_ids:
                async for prop_doc in (
                    db.collection(PROPOSALS_COLLECTION)
                    .where(filter=FieldFilter("agent_id", "==", aid))
                    .where(filter=FieldFilter("status", "==", "pending"))
                    .limit(INBOX_LIMIT_PER_SECTION)
                    .stream()
                ):
                    pd = prop_doc.to_dict() or {}
                    out.append(
                        {
                            "proposal_id": prop_doc.id,
                            "agent_id": aid,
                            "title": pd.get("title", ""),
                            "category": pd.get("category", "general"),
                            "created_at": pd.get("created_at"),
                        }
                    )
            return out[:INBOX_LIMIT_PER_SECTION]

        pending_proposals = await _safe_call(_fetch_proposals(), [])

    low_gas_agents: list[dict] = [
        {
            "agent_id": a.get("agent_id"),
            "agent_name": a.get("agent_name"),
            "agent_gas_balance": a.get("agent_gas_balance"),
        }
        for a in owned_agents
        if isinstance(a.get("agent_gas_balance"), (int, float)) and a.get("agent_gas_balance", 0) < 0.05
    ][:INBOX_LIMIT_PER_SECTION]

    paused_agents: list[dict] = [
        {
            "agent_id": a.get("agent_id"),
            "agent_name": a.get("agent_name"),
            "reason": a.get("auto_scout_disabled_reason", "Auto Scout paused"),
            "paused_at": a.get("auto_scout_disabled_at"),
        }
        for a in owned_agents
        if a.get("auto_scout_enabled") is False and a.get("auto_scout_disabled_reason")
    ][:INBOX_LIMIT_PER_SECTION]

    recent_mints: list[dict] = []
    if agent_ids:
        async def _fetch_recent_mints():
            out: list[dict] = []
            cutoff = time.time() - (7 * 24 * 3600)
            for aid in agent_ids:
                async for log_doc in (
                    db.collection(SCOUT_LOGS_COLLECTION)
                    .where(filter=FieldFilter("agent_id", "==", aid))
                    .where(filter=FieldFilter("action", "==", "MINTED"))
                    .where(filter=FieldFilter("run_at", ">=", cutoff))
                    .order_by("run_at", direction="DESCENDING")
                    .limit(INBOX_LIMIT_PER_SECTION)
                    .stream()
                ):
                    ld = log_doc.to_dict() or {}
                    out.append(
                        {
                            "agent_id": aid,
                            "log_id": log_doc.id,
                            "candidate_title": (ld.get("candidate_source") or {}).get("title"),
                            "candidate_url": (ld.get("candidate_source") or {}).get("url"),
                            "run_at": ld.get("run_at"),
                            "score": (ld.get("metrics") or {}).get("score"),
                        }
                    )
            out.sort(key=lambda x: x.get("run_at") or 0, reverse=True)
            return out[:INBOX_LIMIT_PER_SECTION]

        recent_mints = await _safe_call(_fetch_recent_mints(), [])

    return {
        "user_wallet": wallet,
        "generated_at": time.time(),
        "counts": {
            "pending_proposals": len(pending_proposals),
            "low_gas_agents": len(low_gas_agents),
            "paused_agents": len(paused_agents),
            "recent_mints": len(recent_mints),
            "total": len(pending_proposals) + len(low_gas_agents) + len(paused_agents),
        },
        "pending_proposals": pending_proposals,
        "low_gas_agents": low_gas_agents,
        "paused_agents": paused_agents,
        "recent_mints": recent_mints,
    }
