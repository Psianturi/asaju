"""Regression tests for chat intent classifier (pre-filter + Gemini tiebreaker)."""

import pytest

from services.llm_service import (
    CHAT_INTENT_TAXONOMY,
    classify_chat_intent,
)


pytestmark = pytest.mark.asyncio


# ── Pre-filter: keyword short-circuit ─────────────────────────────────────────


async def test_propose_keywords_short_circuit_without_gemini():
    for msg in [
        "Buatkan proposal DeFi staking",
        "create proposal for yield farming",
        "swap sekarang",
        "stake sekarang juga",
    ]:
        intent = await classify_chat_intent(msg, niche="Blockchain/DeFi")
        assert intent == "propose_action", f"expected propose_action for: {msg!r}"


async def test_schedule_keywords_short_circuit_without_gemini():
    for msg in [
        "Buatkan study plan 2 minggu untuk Rust",
        "jadwal belajar minggu ini",
        "weekly plan untuk fitness",
        "reminder untuk hari Senin",
    ]:
        intent = await classify_chat_intent(msg, niche="Technology")
        assert intent == "schedule", f"expected schedule for: {msg!r}"


async def test_data_fetch_keywords_short_circuit_without_gemini():
    for msg in [
        "Ambil data futures BTC 7 hari",
        "fetch funding rate ETH",
        "Apa open interest BTC hari ini",
        "Latest liquidations",
        "historical price bitcoin",
    ]:
        intent = await classify_chat_intent(msg, niche="Trading/Investment")
        assert intent == "data_fetch", f"expected data_fetch for: {msg!r}"


# ── Pre-filter: always returns a valid taxonomy label ─────────────────────────


async def test_empty_message_falls_back_to_general_chat():
    assert await classify_chat_intent("", niche="Technology") == "general_chat"
    assert await classify_chat_intent("   ", niche="Technology") == "general_chat"


async def test_taxonomy_constant_is_complete():
    expected = {"data_fetch", "analysis", "schedule", "recommendation", "propose_action", "general_chat"}
    assert set(CHAT_INTENT_TAXONOMY) == expected


async def test_classify_returns_only_valid_taxonomy_label(monkeypatch):
    """When Gemini returns garbage, the classifier must return a taxonomy label,
    never an empty string or arbitrary text. Monkeypatch the Gemini call to return
    nonsense."""

    async def fake_call_gemini(api_key, payload, timeout, context):  # noqa: ARG001
        return {"candidates": [{"content": {"parts": [{"text": "this is not in the taxonomy"}]}}]}

    monkeypatch.setattr("services.llm_service._call_gemini_with_retry", fake_call_gemini)
    monkeypatch.setattr("services.llm_service.get_llm_api_key", lambda: "test-key")

    intent = await classify_chat_intent("How is the market?", niche="Trading/Investment")
    assert intent in CHAT_INTENT_TAXONOMY


async def test_classify_handles_gemini_failure(monkeypatch):
    async def boom(*args, **kwargs):
        raise RuntimeError("gemini down")

    monkeypatch.setattr("services.llm_service._call_gemini_with_retry", boom)
    monkeypatch.setattr("services.llm_service.get_llm_api_key", lambda: "test-key")

    intent = await classify_chat_intent("What should I do today?", niche="Technology")
    assert intent == "general_chat"


async def test_classify_handles_no_api_key(monkeypatch):
    def no_key():
        raise RuntimeError("API key not configured")

    monkeypatch.setattr("services.llm_service.get_llm_api_key", no_key)
    intent = await classify_chat_intent("anything", niche="Technology")
    assert intent == "general_chat"
