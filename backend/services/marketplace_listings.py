"""Marketplace listings mirror — a Firestore read-cache of the on-chain escrow.

The escrow contract (AsajuMarketplace / AsajuMarketplaceERC20) is the only
place a listing exists. A seller lists and cancels by signing list() / cancel()
from their own wallet, and a buyer settles through buy(). This module never
creates a listing on anyone's say-so: it only copies what
listings(agentWallet) returns on-chain, so the marketplace board can render
without one RPC call per card.

Why it works this way: the earlier off-chain board accepted list/cancel
requests with no signature and was never read by buy(). A listing made in the
UI could not actually be bought, and anyone could post or cancel a listing for
an agent they did not own.

The mirror is refreshed three ways:
  - sync_listing(agent_id): right after the owner's list / cancel / buy tx
    confirms, so the board updates without waiting for a poll.
  - reconcile_active_listings(): on every indexer poll, re-reads each active
    row, so cancellations, sales and off-market transfers drop off the board.
  - record_listed_event(): called by the indexer's AgentListed scan, to pick
    up listings made outside the UI (scripts, block explorers).

Listings are keyed by agent_id (the same hashed id the agents collection uses)
so there is at most one row per agent.
"""

import logging
import time

from core.config import CHAIN_CONFIGS
from core.database import get_db
from services.web3_service import web3_service

logger = logging.getLogger(__name__)

LISTINGS_COLLECTION = "marketplace_listings"
AGENTS_COLLECTION = "agents"

# Display fields copied onto the listing so the marketplace renders without a
# per-card join back to the agents collection.
_SNAPSHOT_FIELDS = (
    "agent_name", "niche", "personality", "level", "total_events",
    "wisdom_unlocked", "generation", "gas_spent", "agent_gas_balance",
    "chain_id", "agent_wallet", "avatar_seed",
)


class ListingError(Exception):
    """The listing cannot be synced: unknown agent, or no escrow on its chain."""


class ListingSyncUnavailable(Exception):
    """The chain could not be read. The mirror is left untouched rather than
    guessing — an RPC outage must never look like "not listed"."""


def _settlement(chain_id: int) -> tuple[int, str]:
    """(decimals, currency symbol) the escrow on this chain settles in."""
    cfg = CHAIN_CONFIGS.get(chain_id, {})
    if cfg.get("payment_token"):
        return int(cfg.get("payment_token_decimals", 18)), cfg.get("payment_token_symbol", "TOKEN")
    return 18, cfg.get("native_symbol", "ETH")


async def _load_agent(agent_id: str) -> dict:
    db = get_db()
    snap = await db.collection(AGENTS_COLLECTION).document(agent_id).get()
    if not snap.exists:
        raise ListingError("Agent not found")
    return snap.to_dict() or {}


async def _find_agent_id_by_wallet(agent_wallet: str) -> str | None:
    db = get_db()
    async for d in db.collection(AGENTS_COLLECTION).where("agent_wallet", "==", agent_wallet).limit(1).stream():
        return d.id
    return None


async def sync_listing(agent_id: str) -> dict:
    """Copy this agent's on-chain listing into the mirror.

    Returns {"status": "active" | "cancelled" | "sold" | "stale" | "none",
    "listing": <row or None>}. A row is shown as active only while the escrow
    says it is active *and* its seller still owns the agent — otherwise buy()
    would revert, so showing it would only mislead buyers.
    """
    agent = await _load_agent(agent_id)
    chain_id = int(agent.get("chain_id", 5003))
    agent_wallet = (agent.get("agent_wallet") or "").strip()
    if not agent_wallet:
        raise ListingError("Agent has no wallet recorded")
    if not CHAIN_CONFIGS.get(chain_id, {}).get("marketplace_address"):
        raise ListingError(f"No marketplace escrow on chain {chain_id}")

    try:
        onchain = await web3_service.get_marketplace_listing(agent_wallet, chain_id)
    except Exception as exc:
        logger.warning("marketplace: listing read failed for %s on chain %s: %s", agent_id, chain_id, exc.__class__.__name__)
        raise ListingSyncUnavailable(f"Could not read the marketplace on chain {chain_id}") from exc
    if onchain is None:
        raise ListingError(f"No marketplace escrow on chain {chain_id}")

    owner = await web3_service.get_agent_owner(agent_wallet, chain_id)
    if not owner:
        raise ListingSyncUnavailable(f"Could not read the agent owner on chain {chain_id}")

    db = get_db()
    ref = db.collection(LISTINGS_COLLECTION).document(agent_id)
    existing_snap = await ref.get()
    existing = (existing_snap.to_dict() or {}) if existing_snap.exists else {}
    now = time.time()
    seller = onchain["seller"]

    if onchain["active"] and seller.lower() == owner.lower():
        decimals, currency = _settlement(chain_id)
        same_listing = (
            existing.get("status") == "active"
            and (existing.get("seller_wallet") or "").lower() == seller.lower()
            and existing.get("price_wei") == str(onchain["price_wei"])
        )
        listing = {
            "agent_id": agent_id,
            "seller_wallet": seller,
            "price_wei": str(onchain["price_wei"]),  # string: wei overflows Firestore int64
            "price": onchain["price_wei"] / 10**decimals,
            "currency": currency,
            "status": "active",
            "source": "chain",
            "created_at": existing.get("created_at", now) if same_listing else now,
            "updated_at": now,
        }
        for f in _SNAPSHOT_FIELDS:
            if f in agent:
                listing[f] = agent[f]
        listing["chain_id"] = chain_id
        await ref.set(listing)
        return {"status": "active", "listing": listing}

    if onchain["active"]:
        # Escrow still holds a listing, but its seller no longer owns the agent
        # (transferred off-market). buy() reverts on it, so hide it.
        status = "stale"
    elif existing.get("status") == "active":
        previous_seller = (existing.get("seller_wallet") or "").lower()
        status = "sold" if previous_seller and previous_seller != owner.lower() else "cancelled"
    else:
        return {"status": "none", "listing": None}

    if existing_snap.exists and existing.get("status") == "active":
        update = {"status": status, "updated_at": now}
        if status == "sold":
            update.update({"sold_to": owner, "sold_at": now})
        await ref.update(update)
        existing.update(update)
    return {"status": status, "listing": existing or None}


async def record_listed_event(agent_wallet: str) -> dict:
    """Indexer hook for an AgentListed log: resolve the agent and re-read its
    listing from the chain (the log alone may already be out of date)."""
    agent_id = await _find_agent_id_by_wallet(agent_wallet)
    if agent_id is None:
        logger.info("marketplace: AgentListed for unknown agent wallet %s, skipping", agent_wallet)
        return {"status": "unknown_agent", "listing": None}
    return await sync_listing(agent_id)


async def reconcile_active_listings(chain_id: int | None = None) -> dict[str, int]:
    """Re-read every active row from the chain. Rows whose chain cannot be read
    are left as they are and retried on the next poll."""
    db = get_db()
    agent_ids: list[str] = []
    async for doc in db.collection(LISTINGS_COLLECTION).where("status", "==", "active").stream():
        data = doc.to_dict() or {}
        if chain_id is not None and data.get("chain_id") != chain_id:
            continue
        agent_ids.append(data.get("agent_id") or doc.id)

    summary = {"checked": 0, "still_active": 0, "closed": 0, "errors": 0}
    for agent_id in agent_ids:
        summary["checked"] += 1
        try:
            result = await sync_listing(agent_id)
        except (ListingError, ListingSyncUnavailable) as exc:
            logger.warning("marketplace: reconcile skipped %s: %s", agent_id, exc)
            summary["errors"] += 1
            continue
        if result["status"] == "active":
            summary["still_active"] += 1
        else:
            summary["closed"] += 1
    return summary


async def get_active_listings(chain_id: int | None = None) -> list[dict]:
    """Return active listings, optionally filtered to one chain."""
    db = get_db()
    out: list[dict] = []
    async for doc in db.collection(LISTINGS_COLLECTION).where("status", "==", "active").stream():
        data = doc.to_dict() or {}
        if chain_id is not None and data.get("chain_id") != chain_id:
            continue
        out.append(data)
    out.sort(key=lambda d: d.get("created_at", 0), reverse=True)
    return out
