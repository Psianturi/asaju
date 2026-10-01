"""
Marketplace indexer — listens to AgentOwnershipTransferred events on V5 and
migrates the off-chain Firestore record so the buyer sees what they bought.

Why polling and not subscriptions: Cloud Run has no long-running process
guarantee. Each instance lives only as long as a request is being served
(or up to ~15 minutes idle). A websocket / w3.eth.subscribe() would
silently break the next time the instance scales to zero. Polling every
1–2 minutes via Cloud Scheduler is the boring solution that actually works
on serverless.

What we migrate per transfer event:
  - agents.{agent_wallet}.user_wallet                ← newOwner (the buyer)
  - agents.{agent_wallet}.private_key_enc            ← UNCHANGED (on-chain identity)
  - proposals (where agent_id == agent_wallet).*     ← ownership reassigned

What we explicitly do NOT touch:
  - The on-chain agent_wallet itself (NFTs stay with the agent identity).
  - agent_stats on-chain (preserved across transfers by contract design).
  - The agent's private_key_enc (KMS-encrypted; transferring it would
    leak the seller's signing material to the buyer via the API).

If the Firestore doc's user_wallet is not equal to event.previousOwner, we
skip the migration with a warning — somebody edited it manually, or the
backend is replaying the same block range. Idempotent.
"""

import asyncio
import logging
import time
from typing import Any

from core.database import get_db
from services.web3_service import web3_service

logger = logging.getLogger(__name__)

DEFAULT_CHAIN_ID = 97  # BNB Testnet — the default chain new visitors land on
SUPPORTED_CHAIN_IDS = (97, 5003, 11155111)
MARKETPLACE_COLLECTION = "marketplace_indexer_state"


async def _latest_processed_block(chain_id: int) -> int:
    """Read the high-water-mark block from Firestore. Default = 0 if missing."""
    db = get_db()
    state_ref = db.collection(MARKETPLACE_COLLECTION).document(f"chain_{chain_id}")
    try:
        doc = await state_ref.get()
    except Exception as exc:
        logger.warning("marketplace_indexer: state read failed for chain %s: %s", chain_id, exc.__class__.__name__)
        return 0
    if not doc.exists:
        return 0
    return int((doc.to_dict() or {}).get("last_processed_block", 0))


async def _set_latest_processed_block(chain_id: int, block_number: int) -> None:
    """Persist the new high-water-mark so the next poll doesn't reprocess."""
    db = get_db()
    state_ref = db.collection(MARKETPLACE_COLLECTION).document(f"chain_{chain_id}")
    try:
        await state_ref.set({"last_processed_block": block_number, "updated_at": time.time()})
    except Exception as exc:
        # Non-fatal — worst case we re-poll the same events next time.
        logger.warning("marketplace_indexer: state write failed for chain %s: %s", chain_id, exc.__class__.__name__)


async def _migrate_transfer(agent_wallet: str, new_owner: str, previous_owner_event: str | None = None) -> dict[str, int]:
    """Update the Firestore agent doc + reassign its pending proposals.

    The `previous_owner_event` arg lets us sanity-check that Firestore's
    user_wallet matches what the event says the previous owner was — if
    someone manually edited Firestore we don't silently overwrite their fix.

    Returns a small summary dict the caller can log. The on-chain agent_wallet
    identity is preserved — only ownership-related fields are touched.
    """
    db = get_db()

    # Agent docs are keyed by a hashed agent_id, with the wallet stored in a
    # field — so find the agent by its agent_wallet field, not by document id.
    agent_snap = None
    async for d in db.collection("agents").where("agent_wallet", "==", agent_wallet).limit(1).stream():
        agent_snap = d
        break

    if agent_snap is None:
        logger.warning(
            "marketplace_indexer: agent doc for wallet %s not found for transfer, skipping",
            agent_wallet,
        )
        return {"skipped": 1}

    data = agent_snap.to_dict() or {}
    agent_id = agent_snap.id
    firestore_owner = (data.get("user_wallet") or "").lower()

    # The "skip if Firestore disagrees with the event" guard. We compare
    # against `previousOwner` from the event when provided — that's the
    # owner BEFORE the transfer. If Firestore already says something else
    # (e.g. a bot already migrated, or somebody edited manually), we skip
    # to avoid silently overwriting their fix.
    if previous_owner_event:
        expected_previous = previous_owner_event.lower()
        if firestore_owner and firestore_owner != expected_previous:
            logger.warning(
                "marketplace_indexer: Firestore user_wallet=%s does not match event previousOwner=%s for agent=%s — SKIPPING. Investigate manually.",
                firestore_owner,
                expected_previous,
                agent_wallet,
            )
            return {"skipped": 1, "reason": "owner_mismatch"}

    # Proposals are keyed by the hashed agent_id, not the wallet.
    proposals_updated = 0
    async for prop_doc in db.collection("proposals").where("agent_id", "==", agent_id).stream():
        await prop_doc.reference.update({"owner_wallet_at_proposal": new_owner})
        proposals_updated += 1

    await agent_snap.reference.update({"user_wallet": new_owner, "ownership_updated_at": time.time()})

    # Close out any active marketplace listing for this agent now that it sold.
    listings_sold = 0
    try:
        listing_ref = db.collection("marketplace_listings").document(agent_id)
        listing_snap = await listing_ref.get()
        if listing_snap.exists and (listing_snap.to_dict() or {}).get("status") == "active":
            await listing_ref.update({"status": "sold", "sold_to": new_owner, "sold_at": time.time()})
            listings_sold = 1
    except Exception as exc:
        logger.warning("marketplace_indexer: could not mark listing sold for %s: %s", agent_id, exc.__class__.__name__)

    return {
        "migrated_agent": 1,
        "migrated_proposals": proposals_updated,
        "listings_sold": listings_sold,
    }


async def poll_chain(chain_id: int) -> dict[str, int]:
    """Read all AgentOwnershipTransferred events since the last poll and migrate
    each one. Safe to run repeatedly: state is persisted, migrations are
    idempotent, and an unknown event (e.g. contract upgrade) is skipped.
    """
    since_block = await _latest_processed_block(chain_id)
    try:
        logs = await web3_service.get_event_logs(
            event_name="AgentOwnershipTransferred",
            chain_id=chain_id,
            from_block=since_block,
            to_block="latest",
            argument_filters=None,
        )
    except Exception as exc:
        logger.warning("marketplace_indexer: get_logs failed chain %s from %s: %s", chain_id, since_block, exc.__class__.__name__)
        return {"logs": 0, "errors": 1}

    if not logs:
        return {"logs": 0}

    summary = {"logs": len(logs), "migrated_agent": 0, "migrated_proposals": 0, "skipped": 0}
    latest_block = since_block

    for log in logs:
        args = log.get("args") or {}
        agent_wallet = args.get("agentWallet")
        new_owner = args.get("newOwner")
        previous_owner = args.get("previousOwner")
        if not agent_wallet or not new_owner:
            logger.warning("marketplace_indexer: log missing agentWallet/newOwner, skipping: %s", log)
            latest_block = max(latest_block, log.get("blockNumber", latest_block))
            continue
        if new_owner.lower() == "0x0000000000000000000000000000000000000000":
            # Genesis-style spawn event. Still advance the watermark so we
            # don't re-process it on every poll, but don't try to migrate.
            latest_block = max(latest_block, log.get("blockNumber", latest_block))
            continue

        try:
            result = await _migrate_transfer(
                agent_wallet,
                new_owner,
                previous_owner_event=previous_owner,
            )
            summary["migrated_agent"] += result.get("migrated_agent", 0)
            summary["migrated_proposals"] += result.get("migrated_proposals", 0)
            summary["skipped"] += result.get("skipped", 0)
        except Exception as exc:
            logger.warning("marketplace_indexer: migrate failed for %s: %s", agent_wallet, exc.__class__.__name__)
            summary["skipped"] += 1

        latest_block = max(latest_block, log.get("blockNumber", latest_block))

    if latest_block > since_block:
        await _set_latest_processed_block(chain_id, latest_block)

    return summary


async def poll_all_supported_chains() -> dict[str, dict]:
    """Iterate every chain we support and poll its events. Each chain's
    state is independent — a failure on BNB doesn't skip Mantle polling.
    """
    out: dict[str, dict] = {}
    for chain_id in SUPPORTED_CHAIN_IDS:
        out[str(chain_id)] = await poll_chain(chain_id)
    return out
