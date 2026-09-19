"""Regression test: CoinMarketCap advanced signals are injected into the proposal
prompt so Gemini's reasoning is grounded in trending/losers/listings/global metrics,
not just price snapshots.
"""

import pytest

from services.llm_service import _format_cmc_signals  # type: ignore


pytestmark = pytest.mark.asyncio


def _extract_prompt(call):
    """Pull the prompt text from the Gemini API call payload."""
    return call.args[1]["contents"][0]["parts"][0]["text"]


async def test_prompt_includes_trending_gainers_when_provided(monkeypatch):
    captured: dict = {}

    async def fake_gemini(api_key, payload, **_):
        captured["prompt"] = payload["contents"][0]["parts"][0]["text"]
        return {"candidates": [{"content": {"parts": [{"text": '{"title":"x","description":"y","category":"defi"}'}]}}]}

    monkeypatch.setattr("services.llm_service._call_gemini_with_retry", fake_gemini)
    monkeypatch.setattr("services.llm_service.get_llm_api_key", lambda: "test-key")

    from services.llm_service import generate_agent_proposal

    await generate_agent_proposal(
        agent_name="TestAgent",
        niche="Trading/Investment",
        level=2,
        generation=1,
        genetic_traits=["curious"],
        event_summaries=["Test: wisdom"],
        market_context=None,
        trending_gainers=[
            {"symbol": "BTC", "quote": [{"symbol": "USD", "price": 81000.0, "percent_change_24h": 4.2}]},
            {"symbol": "CHUMP", "quote": [{"symbol": "USD", "price": 0.04, "percent_change_24h": 46.0}]},
        ],
    )

    assert "CoinMarketCap top gainers" in captured["prompt"], "gainers section missing"
    assert "BTC" in captured["prompt"]
    assert "+46.0%" in captured["prompt"], "raw 24h % change must reach Gemini"


async def test_prompt_includes_losers_section(monkeypatch):
    captured: dict = {}

    async def fake_gemini(api_key, payload, **_):
        captured["prompt"] = payload["contents"][0]["parts"][0]["text"]
        return {"candidates": [{"content": {"parts": [{"text": '{"title":"x","description":"y","category":"defi"}'}]}}]}

    monkeypatch.setattr("services.llm_service._call_gemini_with_retry", fake_gemini)
    monkeypatch.setattr("services.llm_service.get_llm_api_key", lambda: "test-key")

    from services.llm_service import generate_agent_proposal

    await generate_agent_proposal(
        agent_name="TestAgent",
        niche="Trading/Investment",
        level=2,
        generation=1,
        genetic_traits=[],
        event_summaries=[],
        market_context=None,
        trending_losers=[
            {"symbol": "ASE", "quote": [{"symbol": "USD", "price": 0.0016, "percent_change_24h": -33.4}]},
        ],
    )

    assert "CoinMarketCap top losers" in captured["prompt"]
    assert "-33.4%" in captured["prompt"]


async def test_prompt_includes_new_listings(monkeypatch):
    captured: dict = {}

    async def fake_gemini(api_key, payload, **_):
        captured["prompt"] = payload["contents"][0]["parts"][0]["text"]
        return {"candidates": [{"content": {"parts": [{"text": '{"title":"x","description":"y","category":"defi"}'}]}}]}

    monkeypatch.setattr("services.llm_service._call_gemini_with_retry", fake_gemini)
    monkeypatch.setattr("services.llm_service.get_llm_api_key", lambda: "test-key")

    from services.llm_service import generate_agent_proposal

    await generate_agent_proposal(
        agent_name="TestAgent",
        niche="Trading/Investment",
        level=2,
        generation=1,
        genetic_traits=[],
        event_summaries=[],
        market_context=None,
        new_listings=[
            {"symbol": "GOLDEN", "name": "Golden Token", "date_added": "2026-09-18T10:00:00Z"},
        ],
    )

    assert "CoinMarketCap recently listed" in captured["prompt"]
    assert "GOLDEN" in captured["prompt"]
    assert "2026-09-18" in captured["prompt"]


async def test_prompt_includes_global_metrics(monkeypatch):
    captured: dict = {}

    async def fake_gemini(api_key, payload, **_):
        captured["prompt"] = payload["contents"][0]["parts"][0]["text"]
        return {"candidates": [{"content": {"parts": [{"text": '{"title":"x","description":"y","category":"defi"}'}]}}]}

    monkeypatch.setattr("services.llm_service._call_gemini_with_retry", fake_gemini)
    monkeypatch.setattr("services.llm_service.get_llm_api_key", lambda: "test-key")

    from services.llm_service import generate_agent_proposal

    await generate_agent_proposal(
        agent_name="TestAgent",
        niche="Trading/Investment",
        level=2,
        generation=1,
        genetic_traits=[],
        event_summaries=[],
        market_context=None,
        global_metrics={
            "total_market_cap": 2_000_000_000_000,
            "btc_dominance": 58.7,
            "eth_dominance": 12.1,
            "total_market_cap_yesterday_percentage_change": 1.2,
        },
    )

    assert "CoinMarketCap global metrics" in captured["prompt"]
    assert "58.7%" in captured["prompt"]
    assert "2.00T" in captured["prompt"]


async def test_prompt_omits_cmc_signals_section_when_no_data(monkeypatch):
    """No advanced signals → no empty section. Proposal must still work."""
    captured: dict = {}

    async def fake_gemini(api_key, payload, **_):
        captured["prompt"] = payload["contents"][0]["parts"][0]["text"]
        return {"candidates": [{"content": {"parts": [{"text": '{"title":"x","description":"y","category":"defi"}'}]}}]}

    monkeypatch.setattr("services.llm_service._call_gemini_with_retry", fake_gemini)
    monkeypatch.setattr("services.llm_service.get_llm_api_key", lambda: "test-key")

    from services.llm_service import generate_agent_proposal

    await generate_agent_proposal(
        agent_name="TestAgent",
        niche="Trading/Investment",
        level=2,
        generation=1,
        genetic_traits=[],
        event_summaries=["Test event"],
        market_context=None,
    )

    assert "CoinMarketCap top gainers" not in captured["prompt"], "empty gainers section leaked"
    assert "CoinMarketCap global metrics" not in captured["prompt"]


def test_format_cmc_signals_handles_array_quote():
    """v3 endpoints return quote as array; helper must extract %change."""
    payload = [{"symbol": "BTC", "quote": [{"symbol": "USD", "price": 81000.0, "percent_change_24h": 4.2}]}]
    out = _format_cmc_signals(trending_gainers=payload)
    assert "CoinMarketCap top gainers" in out
    assert "BTC" in out
    assert "+4.2%" in out


def test_format_cmc_signals_handles_object_quote():
    """v1 endpoints return quote as {USD: {...}}; helper must normalize."""
    payload = [{"symbol": "BTC", "quote": {"USD": {"price": 81000.0, "percent_change_24h": 4.2}}}]
    out = _format_cmc_signals(trending_gainers=payload)
    assert "BTC" in out
    assert "+4.2%" in out


def test_format_cmc_signals_omits_coin_with_no_quote_data():
    """Coins without usable percent_change should be skipped, not shown as 0%."""
    payload = [
        {"symbol": "OK", "quote": [{"symbol": "USD", "price": 1.0, "percent_change_24h": 5.0}]},
        {"symbol": "BAD"},  # no quote field
        {"symbol": "EMPTY", "quote": [{"symbol": "USD", "price": 1.0}]},  # no percent_change_24h
    ]
    out = _format_cmc_signals(trending_gainers=payload)
    assert "OK" in out
    assert "BAD" not in out
    assert "EMPTY" not in out


def test_format_cmc_signals_empty_input_returns_empty_string():
    """If nothing supplied, helper returns '' so the prompt doesn't gain stray newlines."""
    assert _format_cmc_signals() == ""
    assert _format_cmc_signals(trending_gainers=[], new_listings=[], global_metrics={}) == ""
