"""
Marketplace router — admin endpoints to trigger or inspect the marketplace
indexer. Cloud Scheduler calls these on a schedule; admins can trigger
manually after a transfer for testing.

Auth note: /index/poll requires the Cloud Scheduler OIDC token (same gate
as scheduler.py); /listings and /sync are public reads of on-chain state.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from core.auth import require_oidc
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

# /sync is public (it only copies what the chain already says) and rate
# limited. /index/poll needs the scheduler's OIDC token.
SYNC_LIMIT = 30        # per host, per minute


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
    _claims: dict = Depends(require_oidc),
) -> dict:
    """Force a poll of the AgentOwnershipTransferred event log.

    Used by the Cloud Scheduler job `marketplace-indexer` (every 5 minutes)
    and by admins after manually triggering a transfer for testing.
    """
    try:
        if chain_id is not None:
            result = await poll_chain(chain_id)
            return {"chain_id": chain_id, "result": result}
        return {"result": await poll_all_supported_chains()}
    except Exception as exc:
        logger.error("marketplace poll failed: %s", exc)
        raise HTTPException(status_code=503, detail=f"Marketplace poll failed: {exc.__class__.__name__}")
