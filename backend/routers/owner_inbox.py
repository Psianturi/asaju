"""Owner inbox aggregator — single endpoint that gathers everything waiting on
the owner across all agents (pending proposals, low-gas agents, paused scouts,
recent mints, recent scout runs, per-agent learning progress).

Design:
- Per-owner isolation: every query is filtered by user_wallet.
- Best-effort: each aggregator section is wrapped in try/except so one
  failing query doesn't kill the whole inbox response.
- Capped at top N per section to keep payload small.

This is the primary notification surface for the "agent learned while you
were away" feature — the owner opens the dashboard and sees exactly what
the agent did overnight, without needing push notifications (which require
external services and cost more).
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


async def _fetch_agent_events(db, agent_id: str) -> list[dict]:
    """Stream all events for one agent. Returned as plain dicts (id stripped).
    Used by the inbox aggregator to compute comprehension without a second
    Firestore round-trip from the dashboard."""
    from google.cloud.firestore_v1.base_query import FieldFilter
    out: list[dict] = []
    async for ev_doc in (
        db.collection("agent_events")
        .where(filter=FieldFilter("agent_id", "==", agent_id))
        .stream()
    ):
        ev = ev_doc.to_dict() or {}
        ev["doc_id"] = ev_doc.id
        out.append(ev)
    return out


def _compute_comprehension_inline(events: list[dict]) -> dict:
    """Lightweight comprehension computation matching the canonical service in
    services/comprehension_service.py. Kept inline here so the inbox endpoint
    doesn't depend on every layer of the app being importable at request time."""
    if not events:
        return {"score": 0, "next_milestone": 20, "progress_to_next": 20}

    titles = {e.get("event_title") for e in events if e.get("event_title")}
    coverage = min(len(titles), 10)
    sample_narratives = [
        (e.get("wisdom_summary") or e.get("event_title") or "").lower() for e in events
    ]
    text = " ".join(sample_narratives)
    niche_hits = sum(1 for kw in ("bitcoin", "ethereum", "defi", "crypto", "trading",
                                  "invest", "stock", "ai", "ml", "tech", "machine learning",
                                  "yoga", "wellness", "fitness", "meditation")
                    if kw in text)
    depth = min(niche_hits // 2, 4)
    density = 0
    days: dict[str, int] = {}
    for e in events:
        ts = e.get("attended_at") or e.get("created_at")
        if not ts:
            continue
        try:
            d = __import__("datetime").datetime.fromtimestamp(float(ts)).strftime("%Y-%m-%d")
            days[d] = days.get(d, 0) + 1
        except Exception:
            continue
    density = min(max(days.values()) if days else 0, 7)

    score = min(100, coverage * 5 + depth * 8 + density * 4)
    next_milestone = 20
    for m in (20, 40, 60, 80, 100):
        if m > score:
            next_milestone = m
            break
    else:
        next_milestone = None  # capped at 100
    progress_to_next = (next_milestone - score) if next_milestone is not None else 0
    return {
        "score": score,
        "next_milestone": next_milestone,
        "progress_to_next": progress_to_next,
    }


@router.get("/inbox")
async def get_owner_inbox(user_wallet: str = Query(...)) -> dict[str, Any]:
    """Aggregate everything waiting on the owner across all their agents.

    Sections:
      - pendingProposals: proposals awaiting approval (any category, including DeFi)
      - lowGasAgents: agents with agent_gas_balance < 0.05 MNT
      - pausedAgents: agents with auto_scout_enabled=False and a disable reason
      - recentMints: most recent scout_logs MINTED for any owned agent
      - recentScoutRuns: every Auto Scout tick (MINTED + SKIPPED) for the last 7d —
        this is the primary notification surface for "what did my agent do while
        I was away". Both successes and skips are listed, since skip rate is
        itself a useful signal (e.g. agent hit cooldown or low-relevance candidates).
      - agentProgress: per-agent live comprehension + last_scout_at + last_event_at,
        so the owner can see each agent's position on the learning arc without
        having to open each card.
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

    # Recent scout runs — every Auto Scout tick (MINTED + SKIPPED) is shown so
    # the owner can see *what the agent did while they were away*. Includes both
    # successes and skips, since the skip rate is itself a useful signal.
    recent_scout_runs: list[dict] = []
    if agent_ids:
        async def _fetch_recent_runs():
            out: list[dict] = []
            cutoff = time.time() - (7 * 24 * 3600)
            for aid in agent_ids:
                async for log_doc in (
                    db.collection(SCOUT_LOGS_COLLECTION)
                    .where(filter=FieldFilter("agent_id", "==", aid))
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
                            "action": ld.get("action"),
                            "reason_code": ld.get("reason_code"),
                            "reason_description": ld.get("reason_description"),
                            "candidate_title": (ld.get("candidate_source") or {}).get("title"),
                            "run_at": ld.get("run_at"),
                            "score": (ld.get("metrics") or {}).get("score"),
                        }
                    )
            out.sort(key=lambda x: x.get("run_at") or 0, reverse=True)
            return out[:INBOX_LIMIT_PER_SECTION]

        recent_scout_runs = await _safe_call(_fetch_recent_runs(), [])

    # Agent comprehension milestones — show when each owned agent last crossed a
    # milestone (level-up or comprehension step). Computed live from the event
    # history so the owner can see *where each agent is on its learning arc*.
    agent_progress: list[dict] = []
    for a in owned_agents:
        aid = a.get("agent_id", "")
        if not aid:
            continue
        events = await _safe_call(_fetch_agent_events(db, aid), [])
        comp = _compute_comprehension_inline(events)
        agent_progress.append(
            {
                "agent_id": aid,
                "agent_name": a.get("agent_name"),
                "comprehension_score": comp["score"],
                "comprehension_next_milestone": comp["next_milestone"],
                "comprehension_progress_to_next": comp["progress_to_next"],
                "last_scout_at": a.get("last_scout_at"),
                "last_event_at": max(
                    (e.get("attended_at") or e.get("created_at") or 0) for e in events
                ) if events else None,
                "total_events": len(events),
            }
        )

    return {
        "user_wallet": wallet,
        "generated_at": time.time(),
        "counts": {
            "pending_proposals": len(pending_proposals),
            "low_gas_agents": len(low_gas_agents),
            "paused_agents": len(paused_agents),
            "recent_mints": len(recent_mints),
            "recent_scout_runs": len(recent_scout_runs),
            "owned_agents": len(owned_agents),
            "total": (
                len(pending_proposals)
                + len(low_gas_agents)
                + len(paused_agents)
                + len(recent_mints)
            ),
        },
        "pending_proposals": pending_proposals,
        "low_gas_agents": low_gas_agents,
        "paused_agents": paused_agents,
        "recent_mints": recent_mints,
        "recent_scout_runs": recent_scout_runs,
        "agent_progress": agent_progress,
    }
