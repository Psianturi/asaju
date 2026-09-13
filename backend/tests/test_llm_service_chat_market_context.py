"""Regression tests for chat market-context rendering in chat_with_agent."""

from services.llm_service import _format_chat_market_context


def test_empty_market_context_produces_empty_text():
    assert _format_chat_market_context(None) == ""
    assert _format_chat_market_context({}) == ""
    assert _format_chat_market_context({"prices": {}, "fear_greed": None, "news": []}) == ""


def test_includes_prices_and_change_pct():
    market_context = {
        "prices": {
            "bitcoin": {"usd": 78_000, "usd_24h_change": -0.4},
            "ethereum": {"usd": 2_487.43, "usd_24h_change": -2.0},
        },
        "fear_greed": {"value": 67, "value_classification": "Greed"},
        "generated_at": 1_757_000_000,
    }

    text = _format_chat_market_context(market_context)

    assert "BITCOIN" in text
    assert "$78,000.00" in text
    assert "-0.40" in text
    assert "ETHEREUM" in text
    assert "$2,487.43" in text
    assert "-2.00" in text
    assert "67/100" in text
    assert "Greed" in text


def test_includes_top_3_news_headlines():
    market_context = {
        "prices": {"bitcoin": {"usd": 78_000}},
        "fear_greed": None,
        "news": [
            {"title": "Bitcoin breaks resistance"},
            {"title": "Ethereum L2 volume soars"},
            {"title": "Mantle DEX adds new pair"},
            {"title": "Headline that should not appear (over cap)"},
        ],
        "generated_at": 1_757_000_000,
    }

    text = _format_chat_market_context(market_context)

    assert "Bitcoin breaks resistance" in text
    assert "Ethereum L2 volume soars" in text
    assert "Mantle DEX adds new pair" in text
    assert "should not appear" not in text


def test_no_prices_no_sentiment_no_news_produces_empty_text():
    market_context = {"prices": {}, "fear_greed": None, "news": [], "generated_at": 1_757_000_000}
    assert _format_chat_market_context(market_context) == ""


def test_missing_generated_at_renders_unknown_time():
    market_context = {"prices": {"mantle": {"usd": 0.6}}, "fear_greed": None, "news": []}
    text = _format_chat_market_context(market_context)
    assert "MANTLE" in text
    assert "$0.60" in text
    assert "unknown time" in text


def test_directive_prompt_instructs_model_to_quote_actual_numbers():
    """The chat version is more directive than the proposal version — owners
    specifically ask 'how is BTC doing?' and expect concrete numbers back."""
    market_context = {
        "prices": {"bitcoin": {"usd": 78_000, "usd_24h_change": -0.4}},
        "fear_greed": None,
        "news": [],
        "generated_at": 1_757_000_000,
    }
    text = _format_chat_market_context(market_context)
    assert "Do not invent figures" in text
    assert "only use what's listed here" in text


def test_handles_non_dict_price_entries_gracefully():
    """Market context is fetched from external APIs — never trust shape."""
    market_context = {
        "prices": {
            "bitcoin": {"usd": 78_000},
            "broken": "this should be a dict",
            "null_value": None,
        },
        "fear_greed": None,
        "news": [],
    }
    text = _format_chat_market_context(market_context)
    assert "BITCOIN" in text
    # broken/null entries must not crash and must not appear as prices
    assert "BROKEN" not in text
    assert "NULL_VALUE" not in text
