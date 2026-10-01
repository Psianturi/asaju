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
from pydantic import BaseModel, field_validator
from web3 import Web3

from services.marketplace_indexer import poll_all_supported_chains, poll_chain
from services.marketplace_listings import (
    ListingError,
    cancel_listing,
    create_listing,
    get_active_listings,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/marketplace", tags=["marketplace"])


class ListAgentRequest(BaseModel):
    agent_id: str
    seller_wallet: str
    price: float

    @field_validator("seller_wallet")
    @classmethod
    def _valid_wallet(cls, v: str) -> str:
        if not Web3.is_address(v):
            raise ValueError("Invalid wallet address")
        return Web3.to_checksum_address(v)


class CancelListingRequest(BaseModel):
    agent_id: str
    seller_wallet: str

    @field_validator("seller_wallet")
    @classmethod
    def _valid_wallet(cls, v: str) -> str:
        if not Web3.is_address(v):
            raise ValueError("Invalid wallet address")
        return Web3.to_checksum_address(v)


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


@router.post("/list")
async def post_list_agent(req: ListAgentRequest) -> dict:
    """List an agent for sale. Ownership is validated against Firestore; the
    binding transfer is the on-chain transferAgentOwnership the owner signs."""
    try:
        listing = await create_listing(req.agent_id, req.seller_wallet, req.price)
        return {"ok": True, "listing": listing}
    except ListingError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/cancel")
async def post_cancel_listing(req: CancelListingRequest) -> dict:
    """Cancel a listing. Only the seller who created it may cancel."""
    try:
        await cancel_listing(req.agent_id, req.seller_wallet)
        return {"ok": True}
    except ListingError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


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
