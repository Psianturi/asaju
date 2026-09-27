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

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/marketplace", tags=["marketplace"])


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
