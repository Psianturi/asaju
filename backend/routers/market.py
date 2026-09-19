"""
GET /api/v1/market/snapshot — Cached market context (price, sentiment, news)
for agent research. See services/market_data_service.py for provider details.
"""

import logging

from fastapi import APIRouter, HTTPException, Query

from services.market_data_service import (
    DEX_NETWORKS,
    get_airdrops,
    get_categories,
    get_dex_pools,
    get_dex_pools_multi,
    get_global_metrics,
    get_market_snapshot,
    get_most_visited,
    get_new_listings,
    get_ohlc,
    get_trending_gainers_losers,
    get_trending_latest,
    symbol_to_cmc_id,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/market", tags=["market"])


@router.get("/snapshot")
async def market_snapshot(
    coins: str = Query("bitcoin,ethereum,mantle", description="Comma-separated CoinGecko coin IDs"),
) -> dict:
    coin_ids = [c.strip() for c in coins.split(",") if c.strip()]
    if not coin_ids:
        raise HTTPException(status_code=400, detail="At least one coin ID is required")

    return await get_market_snapshot(coin_ids)


@router.get("/ohlc/{coin_id}")
async def market_ohlc(coin_id: str, days: int = Query(7, ge=1, le=90)) -> dict:
    candles = await get_ohlc(coin_id, days)
    return {"coin_id": coin_id, "days": days, "candles": candles}


@router.get("/dex-pools/{network}")
async def market_dex_pools(network: str, page: int = Query(1, ge=1)) -> dict:
    if network not in DEX_NETWORKS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported network '{network}'. Supported: {', '.join(DEX_NETWORKS)}",
        )
    pools = await get_dex_pools(network, page)
    return {"network": network, "page": page, "pools": pools}


@router.get("/dex-pools")
async def market_dex_pools_all() -> dict:
    """Top DEX pools across every supported high-volume network, one call."""
    return await get_dex_pools_multi()


@router.get("/trending/gainers-losers")
async def market_trending_gainers_losers(
    time_period: str = Query("24h", pattern="^(1h|24h|7d|30d)$"),
    limit: int = Query(5, ge=1, le=50),
) -> dict:
    """Top movers over the requested window. Powered by CMC, cached 10 min."""
    return {"time_period": time_period, "results": await get_trending_gainers_losers(time_period, limit)}


@router.get("/trending/latest")
async def market_trending_latest(
    time_period: str = Query("24h", pattern="^(1h|24h|7d|30d)$"),
    limit: int = Query(5, ge=1, le=50),
) -> dict:
    """Coins trending by search interest. Powered by CMC, cached 10 min."""
    return {"time_period": time_period, "results": await get_trending_latest(time_period, limit)}


@router.get("/listings/new")
async def market_new_listings(limit: int = Query(5, ge=1, le=50)) -> dict:
    """Most recently listed tokens on CMC. Cached 1 hour — low churn."""
    return {"results": await get_new_listings(limit)}


@router.get("/airdrops")
async def market_airdrops(limit: int = Query(5, ge=1, le=50)) -> dict:
    """Active airdrops — unique to CMC. Compact list, ready for pre-connect surfacing."""
    return {"results": await get_airdrops(limit)}


@router.get("/global-metrics")
async def market_global_metrics() -> dict:
    """Total market cap + BTC/ETH dominance. Macro context for proposals."""
    metrics = await get_global_metrics()
    return {"metrics": metrics}


@router.get("/most-visited")
async def market_most_visited(limit: int = Query(5, ge=1, le=50)) -> dict:
    """Trending tokens by traffic — useful for the pre-connect 'Hot right now' panel."""
    return {"results": await get_most_visited(limit)}


@router.get("/categories")
async def market_categories() -> dict:
    """All CMC categories — DeFi, AI, RWA, etc. Cached 24h."""
    return {"results": await get_categories()}


@router.get("/symbol/{symbol}/cmc-id")
async def market_symbol_to_cmc_id(symbol: str) -> dict:
    """Best-effort symbol → stable CMC id lookup. Use IDs, not symbols, in production code."""
    cmc_id = symbol_to_cmc_id(symbol)
    return {"symbol": symbol.upper(), "cmc_id": cmc_id}
