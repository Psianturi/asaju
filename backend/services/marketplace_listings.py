"""Marketplace listings store — the off-chain board of agents offered for sale.

Fase 1 model (no escrow contract yet): a listing is an intent to sell. The
binding authorization is the on-chain transferAgentOwnership(), which only the
true owner can sign — so a listing is a display record, not a transfer of
custody. Ownership here is validated against the agent's Firestore user_wallet;
the chain is the real gate. Payment is arranged between the parties; the
platform does not escrow funds in this phase.

Listings are keyed by agent_id (the same hashed id the agents collection uses)
so there is at most one active listing per agent, and the indexer can close it
out by that id when the transfer lands.
"""

import logging
import time

from core.database import get_db

logger = logging.getLogger(__name__)

LISTINGS_COLLECTION = "marketplace_listings"
AGENTS_COLLECTION = "agents"

# Display fields copied onto the listing so the marketplace renders without a
# per-card join back to the agents collection.
_SNAPSHOT_FIELDS = (
    "agent_name", "niche", "personality", "level", "total_events",
    "wisdom_unlocked", "generation", "gas_spent", "agent_gas_balance",
    "chain_id", "agent_wallet",
)


class ListingError(Exception):
    """Raised when a listing cannot be created or cancelled."""


async def _load_agent(agent_id: str) -> dict:
    db = get_db()
    snap = await db.collection(AGENTS_COLLECTION).document(agent_id).get()
    if not snap.exists:
        raise ListingError("Agent not found")
    return snap.to_dict() or {}


async def create_listing(agent_id: str, seller_wallet: str, price: float) -> dict:
    """List an agent for sale. Validates the seller owns the agent (Firestore
    user_wallet) — the on-chain transfer is the binding gate."""
    if price <= 0:
        raise ListingError("Price must be greater than zero")

    agent = await _load_agent(agent_id)
    owner = (agent.get("user_wallet") or "").lower()
    if owner != seller_wallet.lower():
        raise ListingError("Only the agent owner can list it")

    now = time.time()
    listing = {
        "agent_id": agent_id,
        "seller_wallet": seller_wallet,
        "price": float(price),
        "status": "active",
        "created_at": now,
        "updated_at": now,
    }
    for f in _SNAPSHOT_FIELDS:
        if f in agent:
            listing[f] = agent[f]

    db = get_db()
    await db.collection(LISTINGS_COLLECTION).document(agent_id).set(listing)
    logger.info("marketplace: agent %s listed by %s for %s", agent_id, seller_wallet[:10], price)
    return listing


async def cancel_listing(agent_id: str, seller_wallet: str) -> None:
    """Cancel a listing. Only the seller who created it may cancel."""
    db = get_db()
    ref = db.collection(LISTINGS_COLLECTION).document(agent_id)
    snap = await ref.get()
    if not snap.exists:
        raise ListingError("Listing not found")
    data = snap.to_dict() or {}
    if (data.get("seller_wallet") or "").lower() != seller_wallet.lower():
        raise ListingError("Only the seller can cancel this listing")
    await ref.update({"status": "cancelled", "updated_at": time.time()})


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
