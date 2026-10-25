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

from core.config import CHAIN_CONFIGS
from core.database import get_db
from services.marketplace_listings import reconcile_active_listings, record_listed_event
from services.web3_service import web3_service

logger = logging.getLogger(__name__)

DEFAULT_CHAIN_ID = 97  # BNB Testnet — the default chain new visitors land on
SUPPORTED_CHAIN_IDS = (97, 5003, 11155111, 46630)
MARKETPLACE_COLLECTION = "marketplace_indexer_state"

# Escrow event scanning. Public RPCs cap eth_getLogs ranges, so the AgentListed
# scan walks bounded windows and persists its watermark after each one. A chain
# seen for the first time starts LISTING_SCAN_LOOKBACK blocks back (or at the
# chain's `marketplace_start_block` when configured) rather than at genesis.
LISTING_SCAN_CHUNK = 5_000
LISTING_SCAN_MIN_CHUNK = 500  # some public RPCs refuse wide getLogs ranges
LISTING_SCAN_MAX_CHUNKS_PER_POLL = 20
LISTING_SCAN_LOOKBACK = 200_000


async def _latest_processed_block(chain_id: int) -> int:
    """Read the high-water-mark block from Firestore. Default = 0 if missing."""
    return await _latest_processed_block_for(f"chain_{chain_id}")


async def _latest_processed_block_for(state_key: str) -> int:
    db = get_db()
    state_ref = db.collection(MARKETPLACE_COLLECTION).document(state_key)
    try:
        doc = await state_ref.get()
    except Exception as exc:
        logger.warning("marketplace_indexer: state read failed for %s: %s", state_key, exc.__class__.__name__)
        return 0
    if not doc.exists:
        return 0
    return int((doc.to_dict() or {}).get("last_processed_block", 0))


async def _set_latest_processed_block(chain_id: int, block_number: int) -> None:
    """Persist the new high-water-mark so the next poll doesn't reprocess."""
    await _set_latest_processed_block_for(f"chain_{chain_id}", block_number)


async def _set_latest_processed_block_for(state_key: str, block_number: int) -> None:
    db = get_db()
    state_ref = db.collection(MARKETPLACE_COLLECTION).document(state_key)
    try:
        await state_ref.set({"last_processed_block": block_number, "updated_at": time.time()})
    except Exception as exc:
        # Non-fatal — worst case we re-poll the same events next time.
        logger.warning("marketplace_indexer: state write failed for %s: %s", state_key, exc.__class__.__name__)


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

    # Bump the ownership epoch. Anything bound to the previous owner — standing
    # mandates most of all — must stop the moment this line runs, and must not
    # come back if the agent is later sold to the same person again.
    prev_epoch = int(agent_snap.to_dict().get("ownership_epoch") or 0)
    await agent_snap.reference.update(
        {
            "user_wallet": new_owner,
            "ownership_updated_at": time.time(),
            "ownership_epoch": prev_epoch + 1,
        }
    )
    logger.info(
        "ownership_epoch %s -> %s for agent %s (new owner %s)",
        prev_epoch, prev_epoch + 1, agent_id, new_owner,
    )

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


async def _fetch_window(fetch, chain_id: int, start: int, latest: int, label: str):
    """Logs from `start` with the widest window the RPC accepts: halves on
    failure down to LISTING_SCAN_MIN_CHUNK, then raises. Returns (logs, end)."""
    span = LISTING_SCAN_CHUNK
    while True:
        end = min(start + span - 1, latest)
        try:
            return await fetch(start, end), end
        except Exception as exc:
            if _history_pruned(exc):
                # No RPC will ever serve this range again; retrying it every
                # poll only burns the poll budget. Skip it and move the watermark.
                logger.warning(
                    "marketplace_indexer: %s skipped pruned window chain %s [%s, %s]",
                    label, chain_id, start, end,
                )
                return [], end
            if span <= LISTING_SCAN_MIN_CHUNK:
                logger.warning(
                    "marketplace_indexer: %s failed chain %s [%s, %s]: %s: %s",
                    label, chain_id, start, end, exc.__class__.__name__, str(exc)[:160],
                )
                raise
            span //= 2


def _history_pruned(exc: Exception) -> bool:
    text = str(exc).lower()
    return "pruned" in text or "'code': 4444" in text or '"code": 4444' in text


async def poll_chain(chain_id: int) -> dict[str, int]:
    """Read all AgentOwnershipTransferred events since the last poll and migrate
    each one. Safe to run repeatedly: state is persisted, migrations are
    idempotent, and an unknown event (e.g. contract upgrade) is skipped.
    """
    # Bounded chunks from a lookback start: one getLogs from block 0 to latest
    # is refused by public RPCs, and the cursor then never moved.
    try:
        latest = await web3_service.get_block_number(chain_id)
    except Exception as exc:
        logger.warning("marketplace_indexer: block number read failed chain %s: %s", chain_id, exc.__class__.__name__)
        return {"logs": 0, "errors": 1}
    since_block = await _latest_processed_block(chain_id)
    if since_block <= 0:
        cfg = CHAIN_CONFIGS.get(chain_id, {})
        since_block = int(cfg.get("marketplace_start_block") or max(0, latest - LISTING_SCAN_LOOKBACK)) - 1

    logs: list[dict] = []
    scanned_to = since_block
    errors = 0
    for _ in range(LISTING_SCAN_MAX_CHUNKS_PER_POLL):
        if scanned_to >= latest:
            break
        try:
            chunk, end = await _fetch_window(
                lambda a, b: web3_service.get_event_logs(
                    event_name="AgentOwnershipTransferred", chain_id=chain_id,
                    from_block=a, to_block=b, argument_filters=None,
                ),
                chain_id, scanned_to + 1, latest, "ownership scan",
            )
        except Exception:
            errors += 1
            break
        logs.extend(chunk)
        scanned_to = end

    summary = {"logs": len(logs), "migrated_agent": 0, "migrated_proposals": 0, "skipped": 0, "errors": errors}
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

    # Every scanned chunk is done, logs or not.
    latest_block = max(latest_block, scanned_to)
    if latest_block > since_block:
        await _set_latest_processed_block(chain_id, latest_block)

    return summary


async def poll_marketplace_listings(chain_id: int) -> dict:
    """Mirror the chain's escrow listings into Firestore.

    Two passes: scan new AgentListed logs (discovers listings made outside the
    UI), then re-read every row still marked active (drops cancelled, sold and
    off-market-transferred agents). Chains without an escrow are skipped.
    """
    cfg = CHAIN_CONFIGS.get(chain_id, {})
    if not cfg.get("marketplace_address"):
        return {"skipped": 1}

    state_key = f"listings_{chain_id}"
    summary: dict[str, int] = {"listed_logs": 0, "errors": 0}
    try:
        latest = await web3_service.get_block_number(chain_id)
    except Exception as exc:
        logger.warning("marketplace_indexer: block number read failed chain %s: %s", chain_id, exc.__class__.__name__)
        return {"errors": 1}

    since = await _latest_processed_block_for(state_key)
    if since <= 0:
        since = int(cfg.get("marketplace_start_block") or max(0, latest - LISTING_SCAN_LOOKBACK)) - 1

    for _ in range(LISTING_SCAN_MAX_CHUNKS_PER_POLL):
        if since >= latest:
            break
        try:
            logs, end = await _fetch_window(
                lambda a, b: web3_service.get_marketplace_event_logs(
                    "AgentListed", chain_id=chain_id, from_block=a, to_block=b
                ),
                chain_id, since + 1, latest, "AgentListed scan",
            )
        except Exception:
            summary["errors"] += 1
            break
        for log in logs:
            agent_wallet = (log.get("args") or {}).get("agentWallet")
            if not agent_wallet:
                continue
            summary["listed_logs"] += 1
            try:
                await record_listed_event(agent_wallet)
            except Exception as exc:
                logger.warning("marketplace_indexer: listing sync failed for %s: %s", agent_wallet, exc.__class__.__name__)
                summary["errors"] += 1
        since = end
        await _set_latest_processed_block_for(state_key, since)

    summary["reconcile"] = await reconcile_active_listings(chain_id)
    return summary


async def poll_all_supported_chains() -> dict[str, dict]:
    """Iterate every chain we support and poll its events. Each chain's
    state is independent — a failure on BNB doesn't skip Mantle polling.
    """
    out: dict[str, dict] = {}
    for chain_id in SUPPORTED_CHAIN_IDS:
        result = await poll_chain(chain_id)
        result["listings"] = await poll_marketplace_listings(chain_id)
        out[str(chain_id)] = result
    return out
