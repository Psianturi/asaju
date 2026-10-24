"""
POST /api/v1/scheduler/run-all-scouts

Autonomous scout engine — called by GCP Cloud Scheduler on a fixed cron schedule.
Protected by Google OIDC authentication: only Cloud Scheduler (holding a valid
Google-signed OIDC token for our Cloud Run URL) can invoke this endpoint.

Flow per invocation:
  1. Query Firestore for agents where funded=True AND auto_scout_enabled=True
  2. Apply cooldown filter: skip agents whose last_scout_at + scout_interval_hours
     is still in the future
  3. Run eligible agents concurrently, capped at 5 simultaneous blockchain ops
     via asyncio.Semaphore
  4. Gather all results — a failure in one agent never halts the batch
  5. Update last_scout_at in Firestore for every agent that was attempted
"""

import asyncio
import logging
import time
import uuid

from fastapi import APIRouter, Depends
from google.cloud.firestore_v1.base_query import FieldFilter

from core.auth import require_oidc
from core.agent_mandate import active_mandate
from core.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/scheduler", tags=["scheduler"])

AGENTS_COLLECTION = "agents"


async def _run_one_scout(
    agent_id: str,
    semaphore: asyncio.Semaphore,
    scheduler_run_id: str,
) -> dict:
    """
    Run a single agent's scout cycle under the shared semaphore.

    Returns a result dict with at minimum {"agent_id": ..., "status": ...}.
    Never raises — exceptions are caught and returned as {"status": "error"}.
    """
    async with semaphore:
        # Local import avoids circular dependency at module level
        from routers.agents import run_auto_scout

        try:
            result = await run_auto_scout(agent_id=agent_id, scheduler_run_id=scheduler_run_id)
        except Exception as exc:
            logger.error(
                "Scheduler: scout failed for agent %s (run=%s): %s",
                agent_id,
                scheduler_run_id,
                exc.__class__.__name__,
            )
            return {"agent_id": agent_id, "status": "error"}

        # Stamp last_scout_at regardless of attended/no_new_events outcome
        try:
            db = get_db()
            await db.collection(AGENTS_COLLECTION).document(agent_id).update(
                {"last_scout_at": time.time()}
            )
        except Exception as exc:
            # Non-fatal — scout happened, just the timestamp write failed
            logger.warning(
                "Scheduler: last_scout_at update failed for agent %s: %s",
                agent_id,
                exc.__class__.__name__,
            )

        return {"agent_id": agent_id, "status": result.get("status", "unknown")}


@router.post("/run-all-scouts")
async def run_all_scouts(_claims: dict = Depends(require_oidc)) -> dict:
    """
    Triggered by Cloud Scheduler. Discovers and attends events for all eligible agents.

    Eligibility criteria (both must be true):
    - funded == True          (agent has gas for autonomous tx signing)
    - auto_scout_enabled == True  (user has opted the agent into autonomous scouting)
    - Cooldown expired: last_scout_at is None  OR
      now >= last_scout_at + scout_interval_hours * 3600
    """
    db = get_db()
    now = time.time()
    scheduler_run_id = f"sched_{int(now)}_{uuid.uuid4().hex[:8]}"
    eligible_ids: list[str] = []
    skipped = 0

    # ── Dual-condition Firestore query ────────────────────────────────────────
    try:
        query = (
            db.collection(AGENTS_COLLECTION)
            .where(filter=FieldFilter("funded", "==", True))
            .where(filter=FieldFilter("auto_scout_enabled", "==", True))
        )
        async for doc in query.stream():
            data = doc.to_dict() or {}
            agent_id = data.get("agent_id", doc.id)

            # ── Cooldown check ────────────────────────────────────────────────
            last_at = data.get("last_scout_at")
            interval_h = data.get("scout_interval_hours", 6)

            if last_at is not None:
                next_due = last_at + interval_h * 3600
                if now < next_due:
                    remaining_min = int((next_due - now) / 60)
                    logger.info(
                        "Scheduler: skipping agent %s — cooldown active (%dm remaining)",
                        agent_id,
                        remaining_min,
                    )
                    skipped += 1
                    continue

            eligible_ids.append(agent_id)

    except Exception as exc:
        logger.error(
            "Scheduler: Firestore eligibility query failed: %s",
            exc.__class__.__name__,
        )
        return {"status": "error", "detail": "Database query failed", "processed": 0}

    # ── Mandate screening ────────────────────────────────────────────────────
    # Opting an agent into Auto Scout is not enough on its own: every run needs a
    # mandate the owner signed, because the scheduler holds no wallet. Filter here
    # so an agent without one is skipped with a reason, rather than being counted
    # eligible and then failing mid-run with an opaque error.
    mandate_ready: list[str] = []
    no_mandate = 0
    for agent_id in eligible_ids:
        doc = await db.collection(AGENTS_COLLECTION).document(agent_id).get()
        data = doc.to_dict() or {}
        chain_id = int(data.get("chain_id") or 5003)
        mandate = await active_mandate(
            db, agent_id=agent_id, chain_id=chain_id, action="attend_event"
        )
        if mandate is None:
            logger.info(
                "Scheduler: skipping agent %s — no active mandate for attend_event "
                "(owner must grant one from the agent page)",
                agent_id,
            )
            no_mandate += 1
            continue
        mandate_ready.append(agent_id)

    eligible_ids = mandate_ready

    logger.info(
        "Scheduler: %d agents eligible, %d on cooldown, %d without a mandate (run=%s)",
        len(eligible_ids),
        skipped,
        no_mandate,
        scheduler_run_id,
    )

    if not eligible_ids:
        return {
            "status": "ok",
            "scheduler_run_id": scheduler_run_id,
            "processed": 0,
            "skipped": skipped,
        "no_mandate": no_mandate,
            "attended": 0,
            "no_new_events": 0,
            "errors": 0,
        }

    # ── Concurrent safe processing (max 5 simultaneous blockchain ops) ────────
    semaphore = asyncio.Semaphore(5)
    tasks = [
        _run_one_scout(agent_id, semaphore, scheduler_run_id)
        for agent_id in eligible_ids
    ]
    raw_results = await asyncio.gather(*tasks, return_exceptions=True)

    attended = 0
    no_events = 0
    errors = 0

    for r in raw_results:
        if isinstance(r, Exception):
            errors += 1
        elif isinstance(r, dict):
            s = r.get("status")
            if s == "attended":
                attended += 1
            elif s == "no_new_events":
                no_events += 1
            else:
                errors += 1

    logger.info(
        "Scheduler run complete: run=%s processed=%d attended=%d no_events=%d errors=%d skipped=%d",
        scheduler_run_id,
        len(eligible_ids),
        attended,
        no_events,
        errors,
        skipped,
    )

    return {
        "status": "ok",
        "scheduler_run_id": scheduler_run_id,
        "processed": len(eligible_ids),
        "skipped": skipped,
        "no_mandate": no_mandate,
        "attended": attended,
        "no_new_events": no_events,
        "errors": errors,
    }
