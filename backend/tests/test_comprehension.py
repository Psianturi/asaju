"""Tests for the deterministic agent comprehension scoring service.

Comprehension is a derived view over the agent's event history — see
services/comprehension_service.py. It is NOT an AI-quality score, only a
transparent activity counter. These tests pin the scoring behavior so the UI
can rely on it for progress-bar display.
"""

import time

from services.comprehension_service import (
    build_live_scout_log,
    compute_comprehension,
    detect_niche,
)


def _ev(title: str, summary: str = "", attended_at: float | None = None) -> dict:
    return {
        "event_title": title,
        "wisdom_summary": summary,
        "attended_at": attended_at if attended_at is not None else time.time(),
    }


def test_compute_comprehension_empty_history_returns_zeros():
    out = compute_comprehension([])
    assert out["score"] == 0
    assert out["coverage"] == 0
    assert out["depth"] == 0
    assert out["density"] == 0
    assert out["next_milestone"] == 20
    assert out["progress_to_next"] == 20
    assert out["sampled_niches"] == []


def test_compute_comprehension_single_event_low_score():
    out = compute_comprehension([_ev("Bitcoins and ETH", "BTC price up")])
    assert out["score"] > 0
    assert out["coverage"] == 1
    assert out["progress_to_next"] > 0
    assert out["progress_to_next"] == out["next_milestone"] - out["score"]


def test_compute_comprehension_caps_at_100():
    # Score must clamp to 100 even with synthetic overload.
    niches = [
        "bitcoin ethereum defi crypto",
        "day trading invest stock market",
        "machine learning ml ai",
        "yoga wellness fitness meditation",
        "general career business productivity",
    ]
    now = time.time()
    events = []
    for i in range(50):
        # Spread events across enough days to keep coverage high AND
        # cluster some on the same day so density hits its cap.
        # Day 0: events 0-6 (density=7, max)
        # Day 1..N: event i  (unique day each, ensures coverage grows)
        attended_at = now if i < 7 else now + (i - 6) * 86400
        events.append(_ev(
            f"Event {i}",
            f"summary about {niches[i % len(niches)]} number {i}",
            attended_at=attended_at,
        ))
    out = compute_comprehension(events)
    assert out["score"] == 100, f"expected 100, got {out['score']}"
    assert out["next_milestone"] is None, "no next milestone once at 100"
    assert out["progress_to_next"] == 0


def test_compute_comprehension_diverse_niches_raises_depth():
    one = compute_comprehension([_ev("Health tips", "yoga for wellness and meditation")])
    two = compute_comprehension([
        _ev("Health tips", "yoga wellness meditation"),
        _ev("Crypto deep dive", "bitcoin ethereum defi"),
    ])
    two_more = compute_comprehension([
        _ev("Health", "yoga wellness"),
        _ev("Crypto", "bitcoin ethereum"),
        _ev("AI research", "machine learning ml"),
        _ev("Markets", "stock trading invest"),
    ])
    assert two["depth"] >= one["depth"]
    assert two_more["depth"] >= two["depth"]


def test_compute_comprehension_density_reflects_same_day_attendance():
    today = time.time()
    spread = compute_comprehension([
        _ev("One", attended_at=today),
        _ev("Two", attended_at=today + 86400),  # different day
        _ev("Three", attended_at=today + 86400 * 2),
    ])
    burst = compute_comprehension([
        _ev("One", attended_at=today),
        _ev("Two", attended_at=today + 3600),  # same day
        _ev("Three", attended_at=today + 7200),  # same day
    ])
    assert burst["density"] > spread["density"]


def test_compute_comprehension_progress_to_next_uses_milestone_thresholds():
    # Score just below the 40 milestone must report 20 as the gap.
    events = [_ev("Crypto basics", "ethereum bitcoin defi")]
    out = compute_comprehension(events)
    assert out["next_milestone"] in (20, 40, 60, 80, 100)
    assert out["progress_to_next"] == out["next_milestone"] - out["score"]


def test_detect_niche_no_keywords_returns_general():
    assert detect_niche("") == "General"
    assert detect_niche("Random unrelated text") == "General"


def test_detect_niche_keyword_hit():
    assert detect_niche("Day trading strategies") == "Trading/Investment"
    assert detect_niche("Ethereum smart contracts deep dive") == "Blockchain/DeFi"
    assert detect_niche("machine learning applied to finance") == "Technology"


def test_detect_niche_whole_word_match_required():
    # 'AI' should match Technology. 'airplane' must NOT — that would be a substring bug.
    assert detect_niche("AI safety research") == "Technology"
    assert detect_niche("airplane engines") == "General"


def test_build_live_scout_log_returns_most_recent_first():
    now = time.time()
    events = [
        _ev("Oldest", attended_at=now - 86400 * 5),
        _ev("Middle", attended_at=now - 86400),
        _ev("Newest", attended_at=now),
    ]
    log = build_live_scout_log_sync(events, limit=2)
    assert len(log) == 2
    assert log[0]["title"] == "Newest"
    assert log[1]["title"] == "Middle"


def test_build_live_scout_log_truncates_excerpt():
    long_summary = "x" * 500
    events = [_ev("Test", summary=long_summary)]
    log = build_live_scout_log_sync(events, limit=5)
    assert len(log) == 1
    assert log[0]["summary_excerpt"].endswith("…")
    assert len(log[0]["summary_excerpt"]) <= 200  # 160 + ellipsis


def test_build_live_scout_log_empty_history_returns_empty():
    assert build_live_scout_log_sync([], limit=5) == []


# Tiny async helper to satisfy the sync test signature used by build_live_scout_log.
def build_live_scout_log_sync(events, limit):
    import asyncio
    return asyncio.run(build_live_scout_log(events, limit=limit))
