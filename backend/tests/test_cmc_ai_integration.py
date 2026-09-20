"""Tests for CMC AI market thesis integration.

The CMC AI /v5/cmc-ai/latest endpoint returns a pre-generated market thesis
(TLDR + body + sources) that we inject as the highest-priority signal into the
proposal prompt and surface on the dashboard as a dedicated card. These tests
pin the parsing + injection behaviour so a schema change at CMC can't silently
break the agent's reasoning chain.
"""

import pytest

from services.llm_service import _format_cmc_signals
from services.market_data_service import _extract_cmc_ai_summary


pytestmark = pytest.mark.asyncio


def test_extract_cmc_ai_summary_empty_returns_safe_defaults():
    out = _extract_cmc_ai_summary(None)
    assert out == {
        "tldr": "",
        "thesis": "",
        "headlines": [],
        "sources": [],
        "generated_at": None,
    }


def test_extract_cmc_ai_summary_parses_fixed_question_and_thesis():
    feed = {
        "generated_at": "2026-08-17T09:11:37Z",
        "insights": [
            {
                "type": "fixed_question",
                "title": "What are the trending narratives?",
                "question_key": "trending_narratives",
                "answer": {
                    "tldr": "BTC dominance steady. ETH narrative improving.",
                    "body": "## Deep Dive\nFull multi-paragraph analysis...",
                },
                "sources": [{"url": "https://coinmarketcap.com/trending-cryptocurrencies/"}],
            },
            {
                "question_key": "sentiment",
                "answer": {
                    "tldr": "Sentiment mixed.",
                    "body": "## Market thesis\nLong form content here...",
                },
                "sources": [],
            },
        ],
    }
    out = _extract_cmc_ai_summary(feed)
    assert "BTC dominance steady" in out["tldr"]
    assert "Long form content here" in out["thesis"]
    assert any("coinmarketcap.com" in s for s in out["sources"])
    assert out["generated_at"] is not None


def test_extract_cmc_ai_summary_handles_alternate_envelope():
    """Some responses wrap items under `data` instead of `insights`."""
    feed = {"data": [{"question_key": "overview", "answer": {"tldr": "Hi."}}]}
    out = _extract_cmc_ai_summary(feed)
    assert out["tldr"] == "Hi." or "Hi" in out["tldr"]


def test_extract_cmc_ai_summary_handles_iso_generated_at():
    feed = {
        "last_generated_at": "2026-09-19T10:00:00Z",
        "insights": [],
    }
    out = _extract_cmc_ai_summary(feed)
    assert isinstance(out["generated_at"], (int, float))
    assert out["generated_at"] > 1_700_000_000  # year 2023+


def test_format_cmc_signals_includes_ai_section_when_present():
    cmc_ai_summary = {
        "tldr": "BTC +1.2%, ETH stable.",
        "thesis": "Markets digest macro data this week.",
        "headlines": ["Headline one", "Headline two"],
        "sources": ["https://example.com/a"],
        "generated_at": 1234567890.0,
    }
    out = _format_cmc_signals(cmc_ai_summary=cmc_ai_summary)
    assert "CoinMarketCap AI Market Thesis" in out
    assert "BTC +1.2%" in out
    assert "Markets digest macro data this week" in out
    assert "Headline one" in out


def test_format_cmc_signals_omits_ai_section_when_blank():
    """If tldr + thesis both empty, the AI section must be skipped — never render
    an empty header."""
    cmc_ai_summary = {"tldr": "", "thesis": "", "headlines": [], "sources": [], "generated_at": None}
    out = _format_cmc_signals(cmc_ai_summary=cmc_ai_summary)
    assert "CoinMarketCap AI Market Thesis" not in out


def test_format_cmc_signals_truncates_oversized_thesis():
    """Long thesis strings must be truncated to keep the prompt under budget.
    We split on paragraph break and keep only the first paragraph for prompt."""
    long_thesis = "First paragraph that should be kept.\n\nSecond paragraph ignored entirely because we only want the TLDR for the prompt context."
    cmc_ai_summary = {
        "tldr": "x",
        "thesis": long_thesis,
        "headlines": [],
        "sources": [],
        "generated_at": None,
    }
    out = _format_cmc_signals(cmc_ai_summary=cmc_ai_summary)
    assert "First paragraph that should be kept" in out
    assert "Second paragraph ignored" not in out


def test_format_cmc_signals_no_cmc_ai_when_no_param():
    """Backwards compatibility — not passing cmc_ai_summary must not break."""
    out = _format_cmc_signals(
        trending_gainers=[{"symbol": "BTC", "quote": [{"symbol": "USD", "price": 80000, "percent_change_24h": 5}]}],
    )
    assert "CoinMarketCap AI Market Thesis" not in out
    assert "CoinMarketCap top gainers" in out
