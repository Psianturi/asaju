"""Regression tests for CMC quote-shape normalization.

CMC v1 endpoints (trending/*, listings/new, airdrops) return `quote = {USD: {...}}`
(object) while v3 endpoints (listings/latest, quotes/latest) return an array.
Frontend expects an array uniformly. The service normalizes at the cache-write
layer so every consumer sees the same shape.
"""

import pytest

from services.market_data_service import _normalize_cmc_coin, _normalize_cmc_payload, _normalize_cmc_quote


pytestmark = pytest.mark.asyncio


def test_normalize_quote_object_to_array():
    coin = {
        "id": 1, "name": "Bitcoin", "symbol": "BTC",
        "quote": {
            "USD": {"price": 80000.0, "percent_change_24h": 2.5, "market_cap": 1.5e12},
        },
    }
    result = _normalize_cmc_quote(coin)
    assert isinstance(result["quote"], list)
    assert len(result["quote"]) == 1
    assert result["quote"][0]["symbol"] == "USD"
    assert result["quote"][0]["price"] == 80000.0
    assert result["quote"][0]["percent_change_24h"] == 2.5
    assert result["quote"][0]["market_cap"] == 1.5e12


def test_normalize_quote_object_with_multiple_currencies():
    coin = {
        "id": 2, "name": "Ethereum", "symbol": "ETH",
        "quote": {
            "USD": {"price": 2500.0},
            "BTC": {"price": 0.032},
        },
    }
    result = _normalize_cmc_quote(coin)
    assert len(result["quote"]) == 2
    symbols = {q["symbol"] for q in result["quote"]}
    assert symbols == {"USD", "BTC"}


def test_normalize_already_array_passthrough():
    coin = {"id": 3, "symbol": "X", "quote": [{"symbol": "USD", "price": 100.0}]}
    result = _normalize_cmc_quote(coin)
    assert result["quote"] == [{"symbol": "USD", "price": 100.0}]


def test_normalize_none_quote_becomes_empty_list():
    coin = {"id": 4, "symbol": "Y", "quote": None}
    result = _normalize_cmc_quote(coin)
    assert result["quote"] == []


def test_normalize_coin_handles_non_dict():
    assert _normalize_cmc_quote(None) is None
    assert _normalize_cmc_quote("string") == "string"


def test_normalize_payload_list_of_coins():
    payload = [
        {"id": 1, "symbol": "BTC", "quote": {"USD": {"price": 80000.0}}},
        {"id": 2, "symbol": "ETH", "quote": {"USD": {"price": 2500.0}}},
    ]
    result = _normalize_cmc_payload(payload)
    assert isinstance(result, list)
    assert all(isinstance(c["quote"], list) for c in result)
    assert result[0]["quote"][0]["symbol"] == "USD"


def test_normalize_payload_data_wrapper():
    """CMC wraps results in {'data': [...], 'status': {...}}."""
    payload = {
        "data": [
            {"id": 1, "symbol": "BTC", "quote": {"USD": {"price": 80000.0}}},
        ],
        "status": {"timestamp": "2026-09-19T00:00:00Z", "error_code": 0},
    }
    result = _normalize_cmc_payload(payload)
    assert isinstance(result["data"], list)
    assert isinstance(result["data"][0]["quote"], list)
    # status is preserved (no recursion into non-coin dicts)
    assert "status" in result
    assert result["status"]["error_code"] == 0


def test_normalize_payload_global_metrics():
    """Global metrics don't have a `quote` array — btc_dominance is at top level.
    Must NOT be corrupted by the normalizer."""
    payload = {
        "data": {
            "total_market_cap": 2.0e12,
            "btc_dominance": 58.2,
            "eth_dominance": 12.1,
        },
        "status": {"error_code": 0},
    }
    result = _normalize_cmc_payload(payload)
    assert result["data"]["btc_dominance"] == 58.2
    assert result["data"]["eth_dominance"] == 12.1
    assert "quote" not in result["data"]


def test_normalize_coin_helper():
    coin = {"id": 5, "symbol": "Z", "quote": {"USD": {"price": 50.0}}}
    result = _normalize_cmc_coin(coin)
    assert isinstance(result["quote"], list)
