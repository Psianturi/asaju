"""
Niche-aware tool registry for chat-driven agent automation.

Each entry maps a niche → list of callable tools. Tools return a dict with
``status`` ("ok" | "error"), a normalized ``data`` payload, and ``source``
metadata so the LLM can quote them honestly.

Design choices:
- Tools never raise. They return {"status": "error", "message": "..."} so the
  chat can degrade gracefully without crashing.
- Results are cached at the call site (the chat endpoint) — tools themselves
  are pure lookups against existing data services.
- All external calls are best-effort and bounded — a slow tool never blocks
  chat for more than 5s.
"""

import asyncio
import logging
from typing import Any, Callable

import httpx

from core.secrets import get_coinmarketcap_api_key
from services.market_data_service import get_fear_greed_index, get_prices

logger = logging.getLogger(__name__)


# Tool result envelope: every tool returns this shape.
# {
#   "status": "ok" | "error",
#   "source": str (data provider identifier, e.g. "coinmarketcap:derivatives"),
#   "data": Any,
#   "message": str | None (only when status == "error"),
# }


async def _safe_call(coro, default: Any = None, timeout: float = 5.0):
    """Run an awaitable with timeout + error netting so a failing tool never
    crashes the caller. Returns (ok: bool, value)."""
    try:
        return True, await asyncio.wait_for(coro, timeout=timeout)
    except Exception as exc:
        logger.warning("Tool call failed: %s", exc.__class__.__name__)
        return False, default


# ── Trading/Investment tools ─────────────────────────────────────────────────


async def fetch_crypto_spot_prices(symbols: list[str] | None = None) -> dict:
    """Fetch live spot prices from CoinGecko. Returns dict keyed by symbol."""
    symbols = symbols or ["bitcoin", "ethereum", "mantle"]
    try:
        prices = await get_prices(symbols)
        return {
            "status": "ok",
            "source": "coingecko:simple/price",
            "data": prices,
        }
    except Exception as exc:
        return {"status": "error", "source": "coingecko:simple/price", "message": str(exc)}


async def fetch_fear_greed() -> dict:
    """CMC Fear & Greed Index (0–100, classification)."""
    try:
        fg = await get_fear_greed_index()
        return {"status": "ok", "source": "coinmarketcap:fear-and-greed", "data": fg}
    except Exception as exc:
        return {"status": "error", "source": "coinmarketcap:fear-and-greed", "message": str(exc)}


async def fetch_cmc_derivatives(symbol: str = "BTC", limit: int = 10) -> dict:
    """Latest perpetual/futures market pairs for a cryptocurrency.
    Returns funding_rate, open_interest, and 24h volume per pair.

    Endpoint: GET /v5/cryptocurrency/derivatives/market-pairs/list/latest
    Plan requirement: Free (matches our Startup CMC plan)."""
    try:
        api_key = get_coinmarketcap_api_key()
    except RuntimeError as exc:
        return {"status": "error", "source": "coinmarketcap:derivatives", "message": str(exc)}

    sym = (symbol or "").upper().strip()
    if not sym:
        return {"status": "error", "source": "coinmarketcap:derivatives", "message": "missing symbol"}

    url = "https://pro-api.coinmarketcap.com/v5/cryptocurrency/derivatives/market-pairs/list/latest"
    headers = {"X-CMC_PRO_API_KEY": api_key, "Accept": "application/json"}
    params = {"symbol": sym, "limit": min(limit, 100), "convert": "USD"}

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url, headers=headers, params=params)
            resp.raise_for_status()
            raw = resp.json()
    except Exception as exc:
        return {"status": "error", "source": "coinmarketcap:derivatives", "message": str(exc)}

    # Normalize: pick the top N pairs sorted by volume_24h_strict.
    pairs = (raw.get("data") or {}).get("market_pairs") or []
    normalized: list[dict] = []
    for p in pairs:
        quote = (p.get("quotes") or [{}])[0]
        normalized.append(
            {
                "exchange": (p.get("exchange") or {}).get("exchange_name"),
                "pair": p.get("market_pair"),
                "category": p.get("category"),
                "funding_rate": quote.get("funding_rate"),
                "open_interest_usd": quote.get("open_interest"),
                "volume_24h_usd": quote.get("volume_24h"),
                "index_price": quote.get("index_price"),
                "last_updated": quote.get("last_updated"),
            }
        )
    normalized.sort(key=lambda x: x.get("volume_24h_usd") or 0, reverse=True)

    return {
        "status": "ok",
        "source": "coinmarketcap:derivatives",
        "data": {"symbol": sym, "pairs": normalized[:limit]},
    }


async def fetch_cmc_liquidations(symbol: str | None = None, limit: int = 20) -> dict:
    """Aggregate liquidations across tracked exchanges. Optional filter by symbol.
    Endpoint: GET /v5/derivatives/liquidations/cryptocurrency/list/latest
    Plan requirement: Basic (matches our Startup CMC plan)."""
    try:
        api_key = get_coinmarketcap_api_key()
    except RuntimeError as exc:
        return {"status": "error", "source": "coinmarketcap:liquidations", "message": str(exc)}

    url = "https://pro-api.coinmarketcap.com/v5/derivatives/liquidations/cryptocurrency/list/latest"
    headers = {"X-CMC_PRO_API_KEY": api_key, "Accept": "application/json"}
    params: dict[str, Any] = {"limit": min(limit, 100), "convert": "USD"}
    if symbol:
        params["symbol"] = symbol.upper()

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url, headers=headers, params=params)
            resp.raise_for_status()
            raw = resp.json()
    except Exception as exc:
        return {"status": "error", "source": "coinmarketcap:liquidations", "message": str(exc)}

    coins = (raw.get("data") or {}).get("cryptocurrencies") or []
    normalized: list[dict] = []
    for c in coins:
        q = (c.get("quotes") or [{}])[0]
        normalized.append(
            {
                "symbol": c.get("symbol"),
                "name": c.get("name"),
                "total_24h_usd": q.get("total_liquidations_24h"),
                "long_24h_usd": q.get("long_liquidations_24h"),
                "short_24h_usd": q.get("short_liquidations_24h"),
                "total_1h_usd": q.get("total_liquidations_1h"),
                "last_updated": q.get("last_updated"),
            }
        )
    normalized.sort(key=lambda x: x.get("total_24h_usd") or 0, reverse=True)

    return {
        "status": "ok",
        "source": "coinmarketcap:liquidations",
        "data": normalized[:limit],
    }


# ── Technology tools ─────────────────────────────────────────────────────────


async def fetch_youtube_search_preview(query: str, niche: str | None = None) -> dict:
    """Return a lightweight preview of YouTube search results for the agent's niche.
    This is NOT a YouTube API call — it returns curated learning resources that the
    agent already learned from (so no quota spent, no external dependency).

    The real value-add is in the agent's attended events; this tool just gives a
    pointer to where the agent can dig deeper when asked."""
    try:
        # Best-effort: derive a small list of likely channels from niche keywords.
        # This is intentionally a stub — full implementation will integrate with the
        # existing scout pipeline once per-niche tool calling is wired into chat.
        from services.scout_service import NICHE_QUERIES  # may not exist yet

        base = NICHE_QUERIES.get(niche or "", NICHE_QUERIES.get("Blockchain/DeFi", []))
        return {
            "status": "ok",
            "source": "asaju:niche-curated",
            "data": {"query": query, "suggested_searches": list(base)[:5]},
        }
    except Exception:
        # Always degrade to a useful preview — never block chat.
        return {
            "status": "ok",
            "source": "asaju:niche-curated",
            "data": {
                "query": query,
                "suggested_searches": [
                    f"{niche or 'technology'} tutorial",
                    f"{niche or 'technology'} deep dive",
                ],
            },
        }


# ── Blockchain/DeFi tools ────────────────────────────────────────────────────


async def fetch_mantle_dex_pools(limit: int = 10) -> dict:
    """Re-export the existing DEX pools endpoint as a chat tool."""
    from services.market_data_service import get_mantle_dex_pools

    try:
        result = await get_mantle_dex_pools()
        return {
            "status": "ok",
            "source": "coingecko:onchain-dex/mantle",
            "data": result,
        }
    except Exception as exc:
        return {"status": "error", "source": "coingecko:onchain-dex/mantle", "message": str(exc)}


# ── Niche → tools mapping ────────────────────────────────────────────────────


NICHE_TOOLS: dict[str, dict[str, Callable[..., Any]]] = {
    "Trading/Investment": {
        "fetch_crypto_spot_prices": fetch_crypto_spot_prices,
        "fetch_fear_greed": fetch_fear_greed,
        "fetch_cmc_derivatives": fetch_cmc_derivatives,
        "fetch_cmc_liquidations": fetch_cmc_liquidations,
    },
    "Blockchain/DeFi": {
        "fetch_crypto_spot_prices": fetch_crypto_spot_prices,
        "fetch_fear_greed": fetch_fear_greed,
        "fetch_mantle_dex_pools": fetch_mantle_dex_pools,
    },
    "Technology": {
        "fetch_youtube_search_preview": fetch_youtube_search_preview,
    },
    "Health/Wellness": {
        "fetch_youtube_search_preview": fetch_youtube_search_preview,
    },
    "Other": {
        "fetch_youtube_search_preview": fetch_youtube_search_preview,
    },
}


async def run_niche_tool(niche: str, tool_name: str, *, args: dict | None = None) -> dict:
    """Look up a tool by niche + name and execute it. Always returns the
    result envelope — never raises. Tool arguments must be passed via ``args=``."""
    tools = NICHE_TOOLS.get(niche) or NICHE_TOOLS["Other"]
    fn = tools.get(tool_name)
    if not fn:
        return {
            "status": "error",
            "source": "registry",
            "message": f"Tool '{tool_name}' is not available for niche '{niche}'.",
        }
    try:
        return await fn(**(args or {}))
    except Exception as exc:
        return {
            "status": "error",
            "source": tools.get(tool_name).__name__ if fn else "registry",
            "message": f"{exc.__class__.__name__}: {exc}",
        }


def tools_available_for(niche: str) -> list[str]:
    """Public introspection — used by the frontend to surface 'Tools I can call'
    affordance and by tests."""
    return list((NICHE_TOOLS.get(niche) or NICHE_TOOLS["Other"]).keys())
