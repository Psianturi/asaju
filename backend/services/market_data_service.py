"""
Market data service: CoinGecko (price/OHLC/DEX) + CoinMarketCap (sentiment/news),
shared across all agents via a Firestore-backed cache.

CoinGecko and CoinMarketCap are complementary, not redundant — verified by hand:
CoinGecko covers price/OHLC/on-chain DEX pools; CMC's OHLCV is locked on this plan,
but it uniquely offers the Fear & Greed index and asset-tagged news.

Caching is not optional here: both providers have monthly credit caps. Every call
in this module is deduplicated through Firestore so N agents checking the same
data within the TTL window cost one upstream call, not N.
"""

import logging
import time

import httpx

from core.database import get_db
from core.secrets import get_coingecko_api_key, get_coinmarketcap_api_key

logger = logging.getLogger(__name__)

_CACHE_COLLECTION = "market_cache"

_COINGECKO_BASE = "https://api.coingecko.com/api/v3"
_CMC_BASE = "https://pro-api.coinmarketcap.com"

# TTLs chosen for credit economy, not just freshness.
_TTL_PRICE = 300        # 5 min
_TTL_OHLC = 900         # 15 min
_TTL_FEAR_GREED = 3600  # 1 hour
_TTL_NEWS = 1800        # 30 min
_TTL_TRENDING = 600     # 10 min — matches CMC's own update cadence for these endpoints
_TTL_NEW_LISTINGS = 3600  # 1 hour — new listings don't churn minute to minute


async def _cached(key: str, ttl_seconds: int, fetch):
    """Return cached payload if fresh, otherwise call fetch() and persist the result."""
    db = get_db()
    doc_ref = db.collection(_CACHE_COLLECTION).document(key)
    now = time.time()

    try:
        snapshot = await doc_ref.get()
        if snapshot.exists:
            data = snapshot.to_dict() or {}
            if now - data.get("fetched_at", 0) < ttl_seconds:
                return data.get("payload")
    except Exception as exc:
        logger.warning("Market cache read failed for '%s': %s", key, exc)

    payload = await fetch()

    try:
        await doc_ref.set({"payload": payload, "fetched_at": now})
    except Exception as exc:
        logger.warning("Market cache write failed for '%s': %s", key, exc)

    return payload


async def _coingecko_get(path: str, params: dict | None = None) -> dict | list:
    headers = {}
    api_key = get_coingecko_api_key()
    if api_key:
        headers["x-cg-demo-api-key"] = api_key

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(f"{_COINGECKO_BASE}{path}", params=params, headers=headers)
        resp.raise_for_status()
        return resp.json()


async def _cmc_get(path: str, params: dict | None = None) -> dict:
    api_key = get_coinmarketcap_api_key()
    if not api_key:
        raise RuntimeError("COINMARKETCAP_API_KEY not configured")

    headers = {"X-CMC_PRO_API_KEY": api_key}
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(f"{_CMC_BASE}{path}", params=params, headers=headers)
        resp.raise_for_status()
        return resp.json()


async def get_prices(coin_ids: list[str]) -> dict:
    """Live prices + 24h change for the given CoinGecko coin IDs. Cached 5 min."""
    key = "price:" + ",".join(sorted(coin_ids))

    async def fetch():
        try:
            return await _coingecko_get(
                "/simple/price",
                {
                    "ids": ",".join(coin_ids),
                    "vs_currencies": "usd",
                    "include_24hr_change": "true",
                    "include_market_cap": "true",
                },
            )
        except Exception as exc:
            logger.warning("CoinGecko price fetch failed: %s", exc)
            return {}

    return await _cached(key, _TTL_PRICE, fetch)


async def get_ohlc(coin_id: str, days: int = 7) -> list:
    """OHLC candlesticks for one coin. Cached 15 min. CMC's OHLCV is locked on our plan."""
    key = f"ohlc:{coin_id}:{days}"

    async def fetch():
        try:
            return await _coingecko_get(f"/coins/{coin_id}/ohlc", {"vs_currency": "usd", "days": days})
        except Exception as exc:
            logger.warning("CoinGecko OHLC fetch failed for %s: %s", coin_id, exc)
            return []

    return await _cached(key, _TTL_OHLC, fetch)


# High-volume networks worth watching alongside ASAJU's own chain (mantle).
# IDs verified live against /onchain/networks/{id}/pools, not guessed from docs.
DEX_NETWORKS: dict[str, str] = {
    "eth": "Ethereum",
    "bsc": "BNB Chain",
    "arbitrum": "Arbitrum",
    "base": "Base",
    "polygon_pos": "Polygon",
    "optimism": "Optimism",
    "solana": "Solana",
    "mantle": "Mantle",
}


async def get_dex_pools(network: str = "mantle", page: int = 1) -> list:
    """Live DEX pool prices on one network (GeckoTerminal via CoinGecko). Cached 5 min."""
    key = f"dex_pools:{network}:{page}"

    async def fetch():
        try:
            data = await _coingecko_get(f"/onchain/networks/{network}/pools", {"page": page})
            return data.get("data", [])
        except Exception as exc:
            logger.warning("CoinGecko DEX pools fetch failed for %s: %s", network, exc)
            return []

    return await _cached(key, _TTL_PRICE, fetch)


async def get_dex_pools_multi(networks: list[str] | None = None) -> dict:
    """Top pools across several high-volume networks in one call, each independently cached."""
    networks = networks or list(DEX_NETWORKS.keys())
    return {net: await get_dex_pools(net) for net in networks}


async def get_fear_greed_index() -> dict | None:
    """CMC Fear & Greed index — no CoinGecko equivalent exists. Cached 1 hour."""
    async def fetch():
        try:
            data = await _cmc_get("/v3/fear-and-greed/latest")
            return data.get("data")
        except Exception as exc:
            logger.warning("CMC Fear & Greed fetch failed: %s", exc)
            return None

    return await _cached("fear_greed", _TTL_FEAR_GREED, fetch)


async def get_asset_news(limit: int = 5) -> list:
    """CMC news tagged to specific assets — CoinGecko free tier has no news endpoint. Cached 30 min."""
    key = f"news:{limit}"

    async def fetch():
        try:
            data = await _cmc_get("/v1/content/latest", {"limit": limit})
            return data.get("data", [])
        except Exception as exc:
            logger.warning("CMC news fetch failed: %s", exc)
            return []

    return await _cached(key, _TTL_NEWS, fetch)


async def get_trending_gainers_losers(time_period: str = "24h", limit: int = 10) -> list:
    """Biggest % movers (up or down) over time_period (1h/24h/7d/30d). Startup-tier endpoint. Cached 10 min."""
    key = f"trending_gl:{time_period}:{limit}"

    async def fetch():
        try:
            data = await _cmc_get(
                "/v1/cryptocurrency/trending/gainers-losers",
                {"time_period": time_period, "limit": limit},
            )
            return data.get("data", [])
        except Exception as exc:
            logger.warning("CMC trending gainers/losers fetch failed: %s", exc)
            return []

    return await _cached(key, _TTL_TRENDING, fetch)


async def get_trending_latest(time_period: str = "24h", limit: int = 10) -> list:
    """Coins trending by search/interest right now. Startup-tier endpoint. Cached 10 min."""
    key = f"trending_latest:{time_period}:{limit}"

    async def fetch():
        try:
            data = await _cmc_get(
                "/v1/cryptocurrency/trending/latest",
                {"time_period": time_period, "limit": limit},
            )
            return data.get("data", [])
        except Exception as exc:
            logger.warning("CMC trending latest fetch failed: %s", exc)
            return []

    return await _cached(key, _TTL_TRENDING, fetch)


async def get_new_listings(limit: int = 10) -> list:
    """Most recently listed cryptocurrencies on CMC. Startup-tier endpoint. Cached 1 hour — low churn."""
    key = f"new_listings:{limit}"

    async def fetch():
        try:
            data = await _cmc_get("/v1/cryptocurrency/listings/new", {"limit": limit})
            return data.get("data", [])
        except Exception as exc:
            logger.warning("CMC new listings fetch failed: %s", exc)
            return []

    return await _cached(key, _TTL_NEW_LISTINGS, fetch)


async def get_market_snapshot(coin_ids: list[str] | None = None) -> dict:
    """One combined read: prices + sentiment + news, each independently cached."""
    coin_ids = coin_ids or ["bitcoin", "ethereum", "mantle"]

    prices = await get_prices(coin_ids)
    fear_greed = await get_fear_greed_index()
    news = await get_asset_news(limit=5)

    return {
        "prices": prices,
        "fear_greed": fear_greed,
        "news": news,
        "generated_at": time.time(),
    }
