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
_TTL_AIRDROPS = 3600    # 1 hour
_TTL_GLOBAL_METRICS = 600  # 10 min — total mcap/BTC dominance updates frequently
_TTL_MOST_VISITED = 600    # 10 min
_TTL_CATEGORIES = 86400    # 24h — category list rarely changes


# CMC best practice: use stable IDs, not symbols (symbols can clash or rebrand).
# Populated lazily from /cryptocurrency/map; falls back to known-good IDs.
_CMC_ID_MAP: dict[str, int] = {
    "BTC": 1,
    "ETH": 1027,
    "USDT": 825,
    "USDC": 3408,
    "BNB": 1839,
    "SOL": 5426,
    "XRP": 52,
    "ADA": 2010,
    "DOGE": 74,
    "MATIC": 3890,
    "MNT": 27075,
    "ARB": 11841,
}


def symbol_to_cmc_id(symbol: str) -> int | None:
    """Best-effort symbol → CMC id lookup. Returns None if not in fallback map."""
    return _CMC_ID_MAP.get(symbol.upper())


def _normalize_cmc_quote(coin: dict) -> dict:
    """CMC v1 endpoints return `quote = {USD: {...}}` (object), v3 returns array.
    Frontend expects an array uniformly. Convert object→array, preserving every field.
    Pass-through if shape is already an array or empty.
    """
    if not isinstance(coin, dict):
        return coin
    quote = coin.get("quote")
    if isinstance(quote, dict):
        # Convert {USD: {price: ..., ...}, BTC: {...}} → [{symbol: 'USD', ...}, ...]
        coin["quote"] = [
            {"symbol": sym, **vals} if isinstance(vals, dict) else {"symbol": sym, "value": vals}
            for sym, vals in quote.items()
        ]
    elif quote is None:
        coin["quote"] = []
    return coin


def _normalize_cmc_payload(payload: object) -> object:
    """Recursively normalize every coin in the CMC response array/object."""
    if isinstance(payload, list):
        return [_normalize_cmc_coin(c) for c in payload]
    if isinstance(payload, dict):
        # If this looks like a single coin (has id/name/symbol + quote), normalize it
        if "quote" in payload and ("id" in payload or "name" in payload or "symbol" in payload):
            return _normalize_cmc_quote(payload)
        # Otherwise recurse into values (covers {"data": [...]}, {BTC: {...}}, etc.)
        return {k: _normalize_cmc_payload(v) for k, v in payload.items()}
    return payload


def _normalize_cmc_coin(coin: object) -> object:
    return _normalize_cmc_quote(coin) if isinstance(coin, dict) else coin


async def _cached(key: str, ttl_seconds: int, fetch, normalize: bool = False):
    """Return cached payload if fresh, otherwise call fetch() and persist the result.
    Set normalize=True to apply CMC quote-shape normalization (object→array).
    """
    db = get_db()
    doc_ref = db.collection(_CACHE_COLLECTION).document(key)
    now = time.time()

    try:
        snapshot = await doc_ref.get()
        if snapshot.exists:
            data = snapshot.to_dict() or {}
            payload = data.get("payload")
            if normalize and payload is not None:
                payload = _normalize_cmc_payload(payload)
            if now - data.get("fetched_at", 0) < ttl_seconds:
                return payload
    except Exception as exc:
        logger.warning("Market cache read failed for '%s': %s", key, exc)

    payload = await fetch()
    if normalize:
        payload = _normalize_cmc_payload(payload)

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

    return await _cached(key, _TTL_TRENDING, fetch, normalize=True)


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

    return await _cached(key, _TTL_TRENDING, fetch, normalize=True)


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

    return await _cached(key, _TTL_NEW_LISTINGS, fetch, normalize=True)


async def get_airdrops(limit: int = 10) -> list:
    """Active and upcoming airdrops — unique to CMC, no CoinGecko equivalent. Cached 1 hour."""
    key = f"airdrops:{limit}"

    async def fetch():
        try:
            data = await _cmc_get("/v1/cryptocurrency/airdrops", {"limit": limit})
            return data.get("data", [])
        except Exception as exc:
            logger.warning("CMC airdrops fetch failed: %s", exc)
            return []

    return await _cached(key, _TTL_AIRDROPS, fetch, normalize=True)


async def get_most_visited(limit: int = 10) -> list:
    """Trending tokens by traffic — useful for the pre-connect 'Hot right now' panel."""
    key = f"most_visited:{limit}"

    async def fetch():
        try:
            data = await _cmc_get("/v1/cryptocurrency/trending/most-visited", {"limit": limit})
            return data.get("data", [])
        except Exception as exc:
            logger.warning("CMC most visited fetch failed: %s", exc)
            return []

    return await _cached(key, _TTL_MOST_VISITED, fetch, normalize=True)


async def get_categories() -> list:
    """All CMC categories (DeFi, AI, RWA, etc.) — useful for filtering proposals by sector."""
    async def fetch():
        try:
            data = await _cmc_get("/v1/cryptocurrency/categories", {"limit": 100})
            return data.get("data", [])
        except Exception as exc:
            logger.warning("CMC categories fetch failed: %s", exc)
            return []

    return await _cached("categories", _TTL_CATEGORIES, fetch)


async def get_global_metrics() -> dict | None:
    """Total market cap, BTC/ETH dominance — macro context for proposals. Cached 10 min."""
    async def fetch():
        try:
            data = await _cmc_get("/v1/global-metrics/quotes/latest")
            return data.get("data")
        except Exception as exc:
            logger.warning("CMC global metrics fetch failed: %s", exc)
            return None

    # Not normalizing — global metrics has no `quote` array (btc_dominance/eth_dominance live at top level).
    return await _cached("global_metrics", _TTL_GLOBAL_METRICS, fetch)


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
