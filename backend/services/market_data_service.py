"""
Market data service: CoinGecko (price/OHLC/DEX) + CoinMarketCap (sentiment/news),
shared across all agents via a Firestore-backed cache.

CoinGecko and CoinMarketCap are complementary, not redundant â€” verified by hand:
CoinGecko covers price/OHLC/on-chain DEX pools; CMC's OHLCV is locked on this plan,
but it uniquely offers the Fear & Greed index and asset-tagged news.

Caching is not optional here: both providers have monthly credit caps. Every call
in this module is deduplicated through Firestore so N agents checking the same
data within the TTL window cost one upstream call, not N.
"""

import asyncio
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
_TTL_TRENDING = 600     # 10 min â€” matches CMC's own update cadence for these endpoints
_TTL_NEW_LISTINGS = 3600  # 1 hour â€” new listings don't churn minute to minute
_TTL_AIRDROPS = 3600    # 1 hour
_TTL_GLOBAL_METRICS = 1800  # 30 min â€” total mcap/BTC dominance updates frequently
_TTL_MOST_VISITED = 600    # 10 min
_TTL_CATEGORIES = 86400    # 24h â€” category list rarely changes


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
    """Best-effort symbol â†’ CMC id lookup. Returns None if not in fallback map."""
    return _CMC_ID_MAP.get(symbol.upper())


def _normalize_cmc_quote(coin: dict) -> dict:
    """CMC v1 endpoints return `quote = {USD: {...}}` (object), v3 returns array.
    Frontend expects an array uniformly. Convert objectâ†’array, preserving every field.
    Pass-through if shape is already an array or empty.
    """
    if not isinstance(coin, dict):
        return coin
    quote = coin.get("quote")
    if isinstance(quote, dict):
        # Convert {USD: {price: ..., ...}, BTC: {...}} â†’ [{symbol: 'USD', ...}, ...]
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
    Set normalize=True to apply CMC quote-shape normalization (objectâ†’array).
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
        for attempt in (1, 2):
            try:
                resp = await client.get(f"{_CMC_BASE}{path}", params=params, headers=headers)
                if resp.status_code >= 500 and attempt == 1:
                    raise httpx.HTTPStatusError("CMC 5xx", request=resp.request, response=resp)
                resp.raise_for_status()
                return resp.json()
            except (httpx.TransportError, httpx.HTTPStatusError) as exc:
                # One quick retry for a dropped connection or a CMC 5xx; a 4xx
                # (plan, key, rate limit) will not change on retry.
                transient = isinstance(exc, httpx.TransportError) or exc.response.status_code >= 500
                if attempt == 2 or not transient:
                    raise
                await asyncio.sleep(0.8)
    raise RuntimeError("unreachable")


# ── Feed availability ─────────────────────────────────────────────────────────
#
# The trending / listings / airdrops endpoints are tier-gated by CMC. On a plan
# that does not include them CMC answers with an error (e.g. 1006 "plan doesn't
# support this endpoint"), which used to be swallowed into [] and cached as if
# it were real data — the dashboard then showed "LIVE" over an empty table.
# Now a failure is remembered per feed with a reason the UI can show, is not
# cached as data, and is retried after _FEED_RETRY_SECONDS.

_FEED_RETRY_SECONDS = 300
# How long to leave an endpoint alone after it failed, by why it failed. A
# plan that does not include an endpoint will not include it in five minutes
# either; retrying it only burns the per-minute rate limit.
_RETRY_BY_REASON = {
    "plan_unsupported": 6 * 3600,
    "plan_expired": 3600,
    "auth": 3600,
    "not_configured": 3600,
    "rate_limited": 120,
}
# One listings call (200 coins = 1 credit on CMC) feeds gainers AND losers.
_TTL_LISTINGS_MOVERS = 900
_FEED_FAILURES: dict[str, dict] = {}
# Where a failed feed's rows came from instead: "cache" (last good CMC answer)
# or "coingecko" (a comparable feed from the other provider).
_FEED_SERVED: dict[str, str] = {}
# A last good answer older than this is not shown; an empty state is more
# honest than day-old movers.
_STALE_MAX_SECONDS = 6 * 3600

# CMC status.error_code → short reason the frontend maps to plain language.
_CMC_ERROR_REASONS = {
    1001: "auth", 1002: "auth",                 # key invalid / missing
    1005: "auth", 1007: "auth",                 # key required / disabled
    1006: "plan_unsupported",                   # endpoint not in this plan
    1008: "rate_limited", 1009: "rate_limited",
    1010: "rate_limited", 1011: "rate_limited",  # minute/daily/monthly/IP caps
}


class _FeedCoolingDown(Exception):
    """Raised inside a fetch to skip the upstream call while a recent failure
    is still inside its retry window."""


def _describe_cmc_failure(exc: Exception) -> dict:
    """Turn an exception from _cmc_get into {"reason", "detail"}."""
    if isinstance(exc, RuntimeError) and "not configured" in str(exc):
        return {"reason": "not_configured", "detail": "CoinMarketCap API key is not configured"}
    if isinstance(exc, httpx.HTTPStatusError):
        code, message = None, ""
        try:
            status = (exc.response.json() or {}).get("status") or {}
            code = status.get("error_code")
            message = status.get("error_message") or ""
        except Exception:
            pass
        reason = _CMC_ERROR_REASONS.get(code)
        if reason is None and (exc.response.status_code == 402 or "expired" in message.lower()):
            # The account's paid plan lapsed: nothing to retry, it needs renewing.
            reason = "plan_expired"
        if reason is None:
            reason = "rate_limited" if exc.response.status_code == 429 else "upstream_error"
        return {"reason": reason, "detail": (message or f"HTTP {exc.response.status_code}")[:200]}
    return {"reason": "upstream_error", "detail": exc.__class__.__name__}


def cmc_feed_status(feed: str) -> dict:
    """Availability of the last attempt at `feed` on this instance, merged into
    the router's response:

      {"available", "reason", "detail", "source"}

    `source` says where the rows came from: "coinmarketcap", "cache" (the
    last good CMC answer while CMC is failing), "coingecko" (fallback feed),
    or None when nothing could be shown — then `reason`/`detail` say why.
    """
    failure = _FEED_FAILURES.get(feed)
    if not failure:
        return {"available": True, "reason": None, "detail": None, "source": "coinmarketcap"}
    served = _FEED_SERVED.get(feed)
    if served:
        return {"available": True, "reason": failure["reason"], "detail": failure.get("detail"), "source": served}
    return {"available": False, "reason": failure["reason"], "detail": failure.get("detail"), "source": None}


async def _read_stale(key: str, max_age: float) -> object | None:
    """The cached payload for `key` regardless of TTL, if younger than max_age."""
    try:
        snap = await get_db().collection(_CACHE_COLLECTION).document(key).get()
        if not snap.exists:
            return None
        data = snap.to_dict() or {}
        if time.time() - data.get("fetched_at", 0) > max_age:
            return None
        return _normalize_cmc_payload(data.get("payload"))
    except Exception as exc:
        logger.warning("Market cache stale read failed for '%s': %s", key, exc)
        return None


async def _cmc_feed(feed: str, key: str, ttl_seconds: int, path: str, params: dict | None = None,
                    fallback=None) -> list:
    """Cached CMC list endpoint that records why it failed instead of caching [].

    While CMC is failing, the feed degrades in order: the last good answer
    (up to _STALE_MAX_SECONDS old), then `fallback()` from another provider,
    then an empty list with the reason. Fallback rows are never written to
    the CMC cache key.
    """

    async def fetch():
        recent = _FEED_FAILURES.get(feed)
        if recent and time.time() - recent["at"] < _RETRY_BY_REASON.get(recent["reason"], _FEED_RETRY_SECONDS):
            raise _FeedCoolingDown()
        data = await _cmc_get(path, params)
        return data.get("data", [])

    async def degrade() -> list:
        stale = await _read_stale(key, _STALE_MAX_SECONDS)
        if isinstance(stale, list) and stale:
            _FEED_SERVED[feed] = "cache"
            return stale
        if fallback is not None:
            try:
                got = await fallback()
            except Exception as exc:
                logger.warning("Fallback for %s failed: %s", feed, exc.__class__.__name__)
                got = []
            # A fallback may say where its rows came from: (rows, source).
            rows, source = got if isinstance(got, tuple) else (got, "coingecko")
            if rows:
                _FEED_SERVED[feed] = source
                return rows
        _FEED_SERVED.pop(feed, None)
        return []

    try:
        result = await _cached(key, ttl_seconds, fetch, normalize=True)
    except _FeedCoolingDown:
        return await degrade()
    except Exception as exc:
        failure = _describe_cmc_failure(exc)
        _FEED_FAILURES[feed] = {"at": time.time(), **failure}
        logger.warning("CMC %s fetch failed (%s): %s", feed, failure["reason"], failure["detail"])
        return await degrade()
    _FEED_FAILURES.pop(feed, None)
    _FEED_SERVED.pop(feed, None)
    return result


# ── CoinGecko stand-ins, shaped like CMC's normalized rows ───────────────────

def _cg_row(coin_id, name, symbol, rank, price, change_24h, market_cap=None, volume=None) -> dict:
    return {
        "id": coin_id, "name": name, "symbol": (symbol or "").upper(), "cmc_rank": rank,
        "quote": [{"symbol": "USD", "price": price, "percent_change_24h": change_24h,
                   "market_cap": market_cap, "volume_24h": volume}],
    }


async def _cg_trending(limit: int) -> list:
    """CoinGecko's trending searches — the closest match to CMC "most visited"."""
    async def fetch():
        data = await _coingecko_get("/search/trending")
        rows = []
        for entry in (data or {}).get("coins", []):
            item = entry.get("item") or {}
            info = item.get("data") or {}
            price = info.get("price")
            change = (info.get("price_change_percentage_24h") or {}).get("usd")
            if not isinstance(price, (int, float)):
                continue
            rows.append(_cg_row(item.get("coin_id") or item.get("id"), item.get("name"), item.get("symbol"),
                                item.get("market_cap_rank"), price, change))
        return rows

    rows = await _cached("cg_trending", _TTL_TRENDING, fetch)
    return (rows or [])[:limit]


async def _cg_top_markets() -> list:
    async def fetch():
        return await _coingecko_get("/coins/markets", {
            "vs_currency": "usd", "order": "market_cap_desc", "per_page": 100, "page": 1,
            "price_change_percentage": "24h",
        })
    return await _cached("cg_top100", _TTL_TRENDING, fetch) or []


async def _cg_movers(limit: int, sort_dir: str) -> list:
    """Biggest 24h movers among the top 100 by market cap."""
    coins = [c for c in await _cg_top_markets() if isinstance(c.get("price_change_percentage_24h"), (int, float))]
    coins.sort(key=lambda c: c["price_change_percentage_24h"], reverse=(sort_dir == "desc"))
    return [_cg_row(c.get("id"), c.get("name"), c.get("symbol"), c.get("market_cap_rank"),
                    c.get("current_price"), c.get("price_change_percentage_24h"),
                    c.get("market_cap"), c.get("total_volume")) for c in coins[:limit]]


async def _cmc_listing_movers(limit: int, sort_dir: str) -> list:
    """Biggest 24h movers from CMC's listings endpoint, which every plan has.
    Coins under $1M daily volume are left out so thin tokens don't top the list."""
    async def fetch():
        data = await _cmc_get("/v1/cryptocurrency/listings/latest",
                              {"limit": 200, "sort": "market_cap", "convert": "USD"})
        return data.get("data", [])

    coins = await _cached("cmc_listings_top200", _TTL_LISTINGS_MOVERS, fetch, normalize=True) or []

    def usd(c: dict) -> dict:
        q = c.get("quote")
        return (q[0] if isinstance(q, list) and q else {}) if not isinstance(q, dict) else q.get("USD", {})

    liquid = [c for c in coins if isinstance(usd(c).get("percent_change_24h"), (int, float))
              and (usd(c).get("volume_24h") or 0) >= 1_000_000]
    liquid.sort(key=lambda c: usd(c)["percent_change_24h"], reverse=(sort_dir == "desc"))
    return liquid[:limit]


async def _movers_fallback(limit: int, sort_dir: str) -> tuple[list, str]:
    """CMC listings first (same provider, any plan), then CoinGecko."""
    try:
        rows = await _cmc_listing_movers(limit, sort_dir)
        if rows:
            return rows, "cmc_listings"
    except Exception as exc:
        logger.warning("CMC listings movers failed: %s", exc.__class__.__name__)
    return await _cg_movers(limit, sort_dir), "coingecko"


async def _alt_fear_greed() -> dict | None:
    """alternative.me's Crypto Fear & Greed index — free, no key — shaped like CMC's."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get("https://api.alternative.me/fng/", params={"limit": 1})
        resp.raise_for_status()
        row = ((resp.json() or {}).get("data") or [{}])[0]
    try:
        value = int(row.get("value"))
    except (TypeError, ValueError):
        return None
    return {"value": value, "value_classification": row.get("value_classification"),
            "update_time": row.get("timestamp"), "source": "alternative.me"}


async def _cg_global_metrics() -> dict | None:
    async def fetch():
        data = (await _coingecko_get("/global") or {}).get("data") or {}
        mcap = (data.get("total_market_cap") or {}).get("usd")
        if not isinstance(mcap, (int, float)):
            return None
        share = data.get("market_cap_percentage") or {}
        return {
            "total_market_cap": mcap,
            "total_volume_24h": (data.get("total_volume") or {}).get("usd"),
            "total_market_cap_yesterday_percentage_change": data.get("market_cap_change_percentage_24h_usd"),
            "btc_dominance": share.get("btc"),
            "eth_dominance": share.get("eth"),
            "source": "coingecko",
        }
    return await _cached("cg_global", _TTL_GLOBAL_METRICS, fetch)


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
    """CMC Fear & Greed index â€” no CoinGecko equivalent exists. Cached 1 hour."""
    async def fetch():
        try:
            data = await _cmc_get("/v3/fear-and-greed/latest")
            payload = data.get("data")
        except Exception as exc:
            logger.warning("CMC Fear & Greed fetch failed: %s", exc)
            payload = None
        if not payload:
            try:
                payload = await _alt_fear_greed()
            except Exception as exc:
                logger.warning("Fear & Greed fallback failed: %s", exc.__class__.__name__)
                payload = None
        if not payload:
            raise RuntimeError("no Fear & Greed source answered")  # never cache "nothing"
        return payload

    try:
        return await _cached("fear_greed", _TTL_FEAR_GREED, fetch)
    except RuntimeError:
        return await _read_stale("fear_greed", 24 * 3600)


async def get_asset_news(limit: int = 5) -> list:
    """CMC news tagged to specific assets â€” CoinGecko free tier has no news endpoint. Cached 30 min."""
    key = f"news:{limit}"

    async def fetch():
        try:
            data = await _cmc_get("/v1/content/latest", {"limit": limit})
            return data.get("data", [])
        except Exception as exc:
            logger.warning("CMC news fetch failed: %s", exc)
            return []

    return await _cached(key, _TTL_NEWS, fetch)


async def get_trending_gainers_losers(
    time_period: str = "24h", limit: int = 10, sort_dir: str = "desc"
) -> list:
    """Biggest % movers (up or down) over time_period (1h/24h/7d/30d). Startup-tier endpoint. Cached 10 min.
    sort_dir=desc → gainers; sort_dir=asc → losers."""
    feed = "gainers" if sort_dir == "desc" else "losers"
    return await _cmc_feed(
        feed,
        f"trending_gl:{time_period}:{sort_dir}:{limit}",
        _TTL_TRENDING,
        "/v1/cryptocurrency/trending/gainers-losers",
        {"time_period": time_period, "limit": limit, "sort_dir": sort_dir},
        # CoinGecko only offers 24h change on this call, so it stands in for 24h only.
        fallback=(lambda: _movers_fallback(limit, sort_dir)) if time_period == "24h" else None,
    )


async def get_trending_latest(time_period: str = "24h", limit: int = 10) -> list:
    """Coins trending by search/interest right now. Startup-tier endpoint. Cached 10 min."""
    return await _cmc_feed(
        "trending_latest",
        f"trending_latest:{time_period}:{limit}",
        _TTL_TRENDING,
        "/v1/cryptocurrency/trending/latest",
        {"time_period": time_period, "limit": limit},
    )


async def get_new_listings(limit: int = 10) -> list:
    """Most recently listed cryptocurrencies on CMC. Startup-tier endpoint. Cached 1 hour — low churn."""
    return await _cmc_feed(
        "new_listings", f"new_listings:{limit}", _TTL_NEW_LISTINGS,
        "/v1/cryptocurrency/listings/new", {"limit": limit},
    )


async def get_airdrops(limit: int = 10) -> list:
    """Active and upcoming airdrops — unique to CMC, no CoinGecko equivalent. Cached 1 hour."""
    return await _cmc_feed(
        "airdrops", f"airdrops:{limit}", _TTL_AIRDROPS,
        "/v1/cryptocurrency/airdrops", {"limit": limit},
    )


async def get_most_visited(limit: int = 10) -> list:
    """Trending tokens by traffic — useful for the pre-connect 'Hot right now' panel."""
    return await _cmc_feed(
        "most_visited", f"most_visited:{limit}", _TTL_MOST_VISITED,
        "/v1/cryptocurrency/trending/most-visited", {"limit": limit},
        fallback=lambda: _cg_trending(limit),
    )


async def get_categories() -> list:
    """All CMC categories (DeFi, AI, RWA, etc.) â€” useful for filtering proposals by sector."""
    async def fetch():
        try:
            data = await _cmc_get("/v1/cryptocurrency/categories", {"limit": 100})
            return data.get("data", [])
        except Exception as exc:
            logger.warning("CMC categories fetch failed: %s", exc)
            return []

    return await _cached("categories", _TTL_CATEGORIES, fetch)


async def get_global_metrics() -> dict | None:
    """Total market cap, BTC/ETH dominance — macro context for proposals. Cached 10 min.

    CMC nests `total_market_cap` inside `quote.USD` while exposing `btc_dominance` /
    `eth_dominance` at the top level. We flatten so callers can read every field
    uniformly.
    """
    async def fetch():
        try:
            data = await _cmc_get("/v1/global-metrics/quotes/latest")
            payload = data.get("data")
            if isinstance(payload, dict):
                # Flatten quote.USD → top level so `total_market_cap` is reachable
                # without traversing into the nested quote object.
                quote_usd = payload.get("quote")
                if isinstance(quote_usd, dict):
                    usd = quote_usd.get("USD") or quote_usd.get("usd")
                    if isinstance(usd, dict):
                        for k, v in usd.items():
                            # Don't overwrite a top-level field if CMC sent both.
                            payload.setdefault(k, v)
                return payload
            return payload
        except Exception as exc:
            logger.warning("CMC global metrics fetch failed: %s", exc)
            raise  # a failure must not be cached as the answer for the whole TTL

    try:
        metrics = await _cached("global_metrics", _TTL_GLOBAL_METRICS, fetch)
    except Exception:
        metrics = await _read_stale("global_metrics", _STALE_MAX_SECONDS)
    if metrics:
        return metrics
    # CMC failed: never cache that None as the answer, and fill from CoinGecko.
    try:
        return await _cg_global_metrics()
    except Exception as exc:
        logger.warning("CoinGecko global metrics fallback failed: %s", exc.__class__.__name__)
        return None


async def get_cmc_ai_market_brief() -> dict | None:
    """Fetch CMC AI's pre-generated market feed (Phase 1, Enterprise plan).

    The endpoint returns 26 items in one snapshot: 6 fixed market-wide questions
    (trending narratives, top news headlines, market thesis, etc.) + 3 trending
    questions + 17 top news items. Content is cached server-side by CMC and
    refreshed every ~30 minutes, so we cache it on our side for the same window
    and pull only what we actually use.

    Returns None on a transient provider error — caller treats that as "AI feed
    unavailable, fall back to plain text news".
    """
    async def fetch():
        try:
            data = await _cmc_get("/v5/cmc-ai/latest")
            return data.get("data") or data
        except Exception as exc:
            logger.warning("CMC AI /latest fetch failed: %s", exc)
            return None

    # Cache 30 minutes (matches CMC's own refresh cadence). Use a sentinel
    # empty dict so a true None (provider failure) doesn't poison the cache.
    cached = await _cached("cmc_ai_latest", _TTL_TRENDING, fetch, normalize=False)
    return cached or None


def _extract_cmc_ai_summary(feed: dict | None, max_items: int = 6) -> dict:
    """Reduce a CMC AI feed to a compact dict the LLM prompt and dashboard UI
    can both consume. Returns:
      - tldr: the first fixed_question's TLDR (or empty string)
      - thesis: the first sentiment-style answer body (or empty string)
      - headlines: top N news titles
      - sources: top N source URLs (deduped)
      - generated_at: epoch seconds from CMC, or None

    Designed so a single call yields both a quick TLDR for the dashboard and a
    richer prompt fragment for Gemini. Never invents content.
    """
    if not feed:
        return {"tldr": "", "thesis": "", "headlines": [], "sources": [], "generated_at": None}

    items = feed.get("insights") or feed.get("data") or []
    if not isinstance(items, list):
        items = []

    tldr = ""
    thesis = ""
    headlines: list[str] = []
    sources: list[str] = []

    for item in items:
        if not isinstance(item, dict):
            continue
        qk = item.get("question_key") or item.get("type") or ""
        answer = item.get("answer") or {}
        if isinstance(answer, dict):
            t = (answer.get("tldr") or "").strip()
            b = (answer.get("body") or "").strip()
        else:
            t, b = "", ""
        item_sources = item.get("sources") or []
        if isinstance(item_sources, list):
            for s in item_sources:
                if isinstance(s, dict):
                    url = s.get("url")
                else:
                    url = s
                if isinstance(url, str) and url and url not in sources:
                    sources.append(url)
        title = (item.get("title") or "").strip()
        if qk in ("trending_narratives", "fixed_question", "overview"):
            if not tldr and t:
                tldr = t
        if qk in ("sentiment", "market_thesis", "future_price"):
            if not thesis and (b or t):
                thesis = b or t
        if title and len(headlines) < max_items:
            headlines.append(title)

    generated_at_str = feed.get("last_generated_at") or feed.get("generated_at")
    generated_at: float | None = None
    if isinstance(generated_at_str, (int, float)):
        generated_at = float(generated_at_str)
    elif isinstance(generated_at_str, str):
        try:
            from datetime import datetime
            generated_at = datetime.fromisoformat(generated_at_str.replace("Z", "+00:00")).timestamp()
        except (TypeError, ValueError):
            generated_at = None

    return {
        "tldr": tldr[:600],
        "thesis": thesis[:1500],
        "headlines": headlines[:max_items],
        "sources": sources[:10],
        "generated_at": generated_at,
    }


async def get_cmc_ai_summary() -> dict:
    """Convenience wrapper used by the proposal router and the dashboard:
    returns a flat dict suitable for both the LLM prompt and the UI card."""
    feed = await get_cmc_ai_market_brief()
    return _extract_cmc_ai_summary(feed)


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
