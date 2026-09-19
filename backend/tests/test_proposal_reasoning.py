"""Tests for the reasoning trace fields exposed on ProposalResponse and the
force-evaluate endpoint (hackathon demo button).
"""

import pytest


pytestmark = pytest.mark.asyncio


async def test_generate_agent_proposal_returns_reasoning_trace(monkeypatch):
    """The proposal service returns a `_reasoning` dict alongside the title/description/category
    so the frontend slide-over can show what data the agent had + what it returned."""

    async def fake_gemini(api_key, payload, **_):
        return {"candidates": [{"content": {"parts": [{"text": '{"title":"t","description":"d","category":"defi"}'}]}}]}

    monkeypatch.setattr("services.llm_service._call_gemini_with_retry", fake_gemini)
    monkeypatch.setattr("services.llm_service.get_llm_api_key", lambda: "test-key")

    from services.llm_service import generate_agent_proposal

    out = await generate_agent_proposal(
        agent_name="TestAgent",
        niche="Trading/Investment",
        level=3,
        generation=1,
        genetic_traits=["curious"],
        event_summaries=["Event 1: wisdom"],
        market_context={"prices": {"bitcoin": {"usd": 80000}}, "fear_greed": {"value": 60}, "news": [], "generated_at": 0},
        trending_gainers=[{"symbol": "BTC", "quote": [{"symbol": "USD", "price": 80000.0, "percent_change_24h": 5.0}]}],
        active_airdrops=[{"coin": {"symbol": "USDC"}, "status": "ONGOING", "total_prize": 50000, "prize_currency": "USDC"}],
        global_metrics={"total_market_cap": 2_000_000_000_000, "btc_dominance": 60},
    )

    assert "title" in out
    assert "description" in out
    assert "category" in out
    reasoning = out.get("_reasoning", {})
    assert "prompt" in reasoning
    assert "raw_response" in reasoning
    assert "context_summary" in reasoning

    # Context summary should list every populated CMC signal so the slide-over can show checkmarks.
    cs = reasoning["context_summary"]
    assert "top_gainers" in cs["cmc_signals_present"]
    assert "active_airdrops" in cs["cmc_signals_present"]
    assert "global_metrics" in cs["cmc_signals_present"]
    assert "market_snapshot" in cs["cmc_signals_present"]
    assert cs["events_count"] == 1
    assert cs["niche"] == "Trading/Investment"
    assert cs["level"] == 3


async def test_generate_agent_proposal_empty_signals_no_overclaim(monkeypatch):
    """When no advanced CMC signals are passed, the context summary lists none — never fake ones."""

    async def fake_gemini(api_key, payload, **_):
        return {"candidates": [{"content": {"parts": [{"text": '{"title":"t","description":"d","category":"community"}'}]}}]}

    monkeypatch.setattr("services.llm_service._call_gemini_with_retry", fake_gemini)
    monkeypatch.setattr("services.llm_service.get_llm_api_key", lambda: "test-key")

    from services.llm_service import generate_agent_proposal

    out = await generate_agent_proposal(
        agent_name="TestAgent",
        niche="General",
        level=1,
        generation=1,
        genetic_traits=[],
        event_summaries=[],
        market_context=None,
    )

    cs = out["_reasoning"]["context_summary"]
    assert cs["cmc_signals_present"] == [], "must not invent signal presence"
    assert cs["market_snapshot_age_seconds"] is None


def test_proposal_response_model_includes_reasoning_fields():
    """The Pydantic response model must declare reasoning + reasoning_prompt so the
    frontend TypeScript types stay in sync."""
    from routers.proposals import ProposalResponse

    fields = ProposalResponse.model_fields
    assert "reasoning" in fields
    assert "reasoning_prompt" in fields
