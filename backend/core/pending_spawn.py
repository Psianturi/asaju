"""
A directly spawned agent exists only once the chain says so.

POST /agent/spawn writes the agent record before the owner's spawnAgent()
transaction; if that transaction never lands, the record is just an abandoned
attempt. These helpers keep such records out of lists, counts and quotas, and
promote a record to live as soon as isAgentSpawned() confirms it (covers a
browser that closed before calling /mark-funded).
"""
from __future__ import annotations

import asyncio
import logging
import time

logger = logging.getLogger(__name__)

ARCHIVED_AGENTS_COLLECTION = "archived_agents"
# An unconfirmed attempt younger than this may still have a transaction in flight.
ABANDON_AFTER_SECONDS = 10 * 60


def is_direct(data: dict) -> bool:
    return data.get("ownership_status") != "bred"


def is_pending(data: dict) -> bool:
    """A direct spawn whose on-chain spawnAgent() has not been confirmed."""
    return is_direct(data) and not data.get("funded")


async def confirm_on_chain(db, collection: str, data: dict, timeout: float = 4.0) -> bool | None:
    """True when the chain has the agent (and the record is promoted), False when
    it does not, None when the chain could not be read."""
    from services.web3_service import web3_service

    wallet = data.get("agent_wallet")
    if not wallet:
        return False
    try:
        spawned = await asyncio.wait_for(
            web3_service.is_agent_spawned(wallet, int(data.get("chain_id") or 5003)), timeout=timeout
        )
    except Exception:
        return None
    if spawned is None:
        return None
    if spawned:
        data.update({"funded": True, "spawned_on_v4": True})
        try:
            await db.collection(collection).document(data["agent_id"]).update(
                {"funded": True, "spawned_on_v4": True}
            )
        except Exception as exc:
            logger.warning("Could not promote confirmed agent %s: %s", data.get("agent_id"), exc)
    return bool(spawned)


async def archive_abandoned(db, collection: str, data: dict) -> bool:
    """Move an old, unconfirmed attempt out of the agents collection (key kept)."""
    if time.time() - float(data.get("created_at") or 0) < ABANDON_AFTER_SECONDS:
        return False
    agent_id = data.get("agent_id")
    try:
        await db.collection(ARCHIVED_AGENTS_COLLECTION).document(agent_id).set(
            {**data, "archived_at": time.time(), "archived_reason": "spawn never confirmed on-chain"}
        )
        await db.collection(collection).document(agent_id).delete()
    except Exception as exc:
        logger.warning("Could not archive abandoned spawn %s: %s", agent_id, exc)
        return False
    logger.info("Archived abandoned spawn attempt %s", agent_id)
    return True
