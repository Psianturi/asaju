"""Regression tests for niche-aware tool registry."""

import pytest

from services.tools_registry import (
    NICHE_TOOLS,
    fetch_crypto_spot_prices,
    fetch_fear_greed,
    fetch_youtube_search_preview,
    run_niche_tool,
    tools_available_for,
)


pytestmark = pytest.mark.asyncio


# ── Taxonomy ────────────────────────────────────────────────────────────────


def test_every_niche_has_at_least_one_tool():
    assert all(len(tools) >= 1 for tools in NICHE_TOOLS.values()), (
        "every niche must have at least one callable tool; got: "
        f"{ {k: len(v) for k, v in NICHE_TOOLS.items()} }"
    )


def test_trading_niche_has_derivatives_and_liquidations():
    """User explicitly asked for futures / derivatives — must be present."""
    assert "fetch_cmc_derivatives" in tools_available_for("Trading/Investment")
    assert "fetch_cmc_liquidations" in tools_available_for("Trading/Investment")


def test_tech_niche_has_youtube_preview():
    assert "fetch_youtube_search_preview" in tools_available_for("Technology")


def test_defi_niche_has_dex_pools():
    assert "fetch_mantle_dex_pools" in tools_available_for("Blockchain/DeFi")


def test_unknown_niche_falls_back_to_other():
    """A niche value we don't know must not raise — return Other's tools."""
    assert "fetch_youtube_search_preview" in tools_available_for("MadeUpNiche")


# ── Envelope shape ──────────────────────────────────────────────────────────


async def test_run_niche_tool_returns_envelope_shape():
    result = await run_niche_tool(
        "Technology",
        "fetch_youtube_search_preview",
        args={"query": "rust", "niche": "Technology"},
    )
    assert "status" in result
    assert result["status"] in ("ok", "error")
    assert "source" in result


async def test_run_niche_tool_rejects_unknown_tool():
    result = await run_niche_tool("Trading/Investment", "fetch_nonexistent")
    assert result["status"] == "error"
    assert "not available" in (result.get("message") or "").lower()


async def test_run_niche_tool_swallows_exceptions(monkeypatch):
    async def boom(*args, **kwargs):
        raise RuntimeError("upstream down")

    monkeypatch.setitem(NICHE_TOOLS["Trading/Investment"], "fetch_crypto_spot_prices", boom)
    result = await run_niche_tool("Trading/Investment", "fetch_crypto_spot_prices")
    assert result["status"] == "error"
    assert "RuntimeError" in (result.get("message") or "")


# ── Tool isolation: niches cannot reach other niches' tools ─────────────────


async def test_tech_niche_cannot_use_derivatives():
    """fetch_cmc_derivatives is Trading/Investment only — Tech niche must not
    be able to call it."""
    result = await run_niche_tool("Technology", "fetch_cmc_derivatives")
    assert result["status"] == "error"
    assert "not available" in (result.get("message") or "").lower()


# ── fetch_youtube_search_preview never raises ───────────────────────────────


async def test_youtube_preview_falls_back_gracefully(monkeypatch):
    """Even if NICHE_QUERIES doesn't exist or raises, the preview must succeed."""
    # Patch the import path that the preview tool tries to import
    import sys
    # Pre-populate an empty stub so the import inside fetch_youtube_search_preview fails
    monkeypatch.setitem(sys.modules, "services.scout_service", None)

    result = await fetch_youtube_search_preview(query="rust async", niche="Technology")
    assert result["status"] == "ok"
    assert "suggested_searches" in result["data"]
    assert len(result["data"]["suggested_searches"]) > 0


async def test_youtube_preview_includes_query_in_data():
    result = await fetch_youtube_search_preview(query="solana anchor", niche="Technology")
    assert result["status"] == "ok"
    assert result["data"]["query"] == "solana anchor"


def test_each_niche_routes_data_questions_to_its_own_tool():
    """Chat used to call the Trading derivatives tool for every niche, so DeFi,
    Tech and Security agents always got 'tool not available'."""
    from services.tools_registry import NICHE_TOOLS, data_tool_for

    for niche in ("Trading/Investment", "Blockchain/DeFi", "Technology", "Security"):
        name, _args = data_tool_for(niche, "what happened this week?")
        assert name in NICHE_TOOLS[niche], niche
    assert data_tool_for("Security")[0] == "fetch_recent_exploits"
    assert "Health/Wellness" not in NICHE_TOOLS


async def test_recent_exploits_are_trimmed_and_newest_first(monkeypatch):
    from services import tools_registry
    from services import market_data_service as mds
    from tests.fake_firestore import FakeFirestoreClient

    monkeypatch.setattr(mds, "get_db", lambda: FakeFirestoreClient())
    raw = [
        {"date": 100, "name": "Old", "amount": 1, "chain": ["Ethereum"], "technique": "Phishing"},
        {"date": 300, "name": "Newest", "amount": 2_600_000, "chain": ["Initia"], "technique": "Infinite Mint",
         "classification": "Protocol Logic", "targetType": "Protocol", "returnedFunds": None},
        {"date": 200, "name": "Middle", "amount": 90_500, "chain": ["Solana"], "technique": "Missing Input Validation"},
    ]

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return raw

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url):
            assert url == tools_registry._HACKS_URL
            return _Resp()

    monkeypatch.setattr(tools_registry.httpx, "AsyncClient", _Client)
    out = await tools_registry.fetch_recent_exploits(limit=2)
    assert out["status"] == "ok" and out["source"] == "defillama:hacks"
    assert [r["name"] for r in out["data"]] == ["Newest", "Middle"]
    assert out["data"][0]["amount_usd"] == 2_600_000 and out["data"][0]["technique"] == "Infinite Mint"


def test_youtube_preview_uses_the_scout_queries():
    import asyncio
    from services.tools_registry import fetch_youtube_search_preview

    out = asyncio.run(fetch_youtube_search_preview("audits", niche="Security"))
    assert any("security" in q for q in out["data"]["suggested_searches"])
