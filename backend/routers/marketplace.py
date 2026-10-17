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

from fastapi import APIRouter, HTTPException, Query

from services.marketplace_indexer import poll_all_supported_chains, poll_chain
from services.marketplace_listings import (
    ListingError,
    ListingSyncUnavailable,
    get_active_listings,
    sync_listing,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/marketplace", tags=["marketplace"])


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
async def post_sync_listing(agent_id: str = Query(...)) -> dict:
    """Refresh one agent's row from the on-chain escrow.

    Listing and cancelling happen on-chain, signed by the owner's wallet; the
    UI calls this right after that tx confirms so the board updates without
    waiting for the indexer. It needs no auth because it writes nothing a
    caller chooses — only what listings(agentWallet) already says on-chain.
    """
    try:
        return await sync_listing(agent_id)
    except ListingError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ListingSyncUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.post("/index/poll")
async def trigger_poll(
    chain_id: int | None = Query(None, description="Poll just this chain, or all if omitted"),
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
