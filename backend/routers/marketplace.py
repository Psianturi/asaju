"""
Marketplace router — admin endpoints to trigger or inspect the marketplace
indexer. Cloud Scheduler calls these on a schedule; admins can trigger
manually after a transfer for testing.

Auth note: this router lives behind the same MINTER_ROLE / OIDC gate as the
existing scheduler.py endpoints. We don't expose migration to the public —
only the marketplace owner sees their own agents migrate, and that
happens automatically via the poller, not via this API.
"""

import logging

from fastapi import APIRouter, HTTPException, Query, Request

from core.rate_limit import enforce as enforce_rate_limit
from services.marketplace_indexer import poll_all_supported_chains, poll_chain
from services.marketplace_listings import (
    ListingError,
    ListingSyncUnavailable,
    get_active_listings,
    sync_listing,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/marketplace", tags=["marketplace"])

# Both endpoints below are unauthenticated by design — /sync only copies what
# the chain already says, and /index/poll is reachable by anyone who finds it.
# That makes them the cheapest way to turn up writes and chain RPC load, so
# they get their own budget.
SYNC_LIMIT = 30        # per host, per minute
POLL_LIMIT = 6         # per host, per hour — a full poll is expensive


@router.get("/listings")
async def list_listings(
    chain_id: int | None = Query(None, description="Filter to one chain, or all if omitted"),
) -> dict:
    """Public: active agent listings for the marketplace view."""
    try:
        return {"listings": await get_active_listings(chain_id)}
    except Exception as exc:
        logger.warning("marketplace listings fetch failed: %s", exc.__class__.__name__)
        return {"listings": []}


@router.post("/sync")
async def post_sync_listing(agent_id: str = Query(...), request: Request = None) -> dict:
    """Refresh one agent's row from the on-chain escrow.

    Listing and cancelling happen on-chain, signed by the owner's wallet; the
    UI calls this right after that tx confirms so the board updates without
    waiting for the indexer. It needs no auth because it writes nothing a
    caller chooses — only what listings(agentWallet) already says on-chain.
    """
    enforce_rate_limit(request, "marketplace-sync", limit=SYNC_LIMIT, window_seconds=60)
    try:
        return await sync_listing(agent_id)
    except ListingError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ListingSyncUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.post("/index/poll")
async def trigger_poll(
    chain_id: int | None = Query(None, description="Poll just this chain, or all if omitted"),
    request: Request = None,
) -> dict:
    """Force a poll of the AgentOwnershipTransferred event log.

    Used by the Cloud Scheduler job `marketplace-indexer` (every 5 minutes)
    and by admins after manually triggering a transfer for testing.
    """
    enforce_rate_limit(request, "marketplace-poll", limit=POLL_LIMIT, window_seconds=3600)
    try:
        if chain_id is not None:
            result = await poll_chain(chain_id)
            return {"chain_id": chain_id, "result": result}
        return {"result": await poll_all_supported_chains()}
    except Exception as exc:
        logger.error("marketplace poll failed: %s", exc)
        raise HTTPException(status_code=503, detail=f"Marketplace poll failed: {exc.__class__.__name__}")
