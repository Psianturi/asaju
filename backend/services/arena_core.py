"""
Shared, pure rules for ASAJU games: sealing a call, deterministic rolls,
settling a call against a price move, ELO, and candle helpers. No I/O.
Used by the Arena duel and by the Prediction League; keep it free of
game-specific state so both settle the same way.
"""
from __future__ import annotations

import hashlib
from typing import Any

# Damage by confidence (1..3) for a right call; recoil for a wrong one.
HIT = {1: 14, 2: 22, 3: 30}
RECOIL = {1: 0, 2: 6, 3: 12}
MAGNITUDE_BONUS_MAX = 10
FLAT_EPS = 0.0002  # |move| under 0.02% is "no move": nobody lands


def move_of(open_price: float, close_price: float) -> float:
    return 0.0 if not open_price else (close_price - open_price) / open_price


def roll(*parts: Any) -> float:
    """Deterministic 0..1 from the duel's own ids: same fight for every viewer."""
    h = hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()
    return int(h[:12], 16) / float(16 ** 12)


def outcome(direction: str, confidence: int, move: float) -> dict:
    """What one call does once the move is known, before stats."""
    confidence = max(1, min(3, int(confidence)))
    if abs(move) < FLAT_EPS:
        return {"hit": 0, "recoil": 0, "result": "flat"}
    correct = (move > 0) == (direction == "up")
    if correct:
        bonus = min(MAGNITUDE_BONUS_MAX, int(abs(move) * 2000))  # +1 per 0.05%
        return {"hit": HIT[confidence] + bonus, "recoil": 0, "result": "hit"}
    return {"hit": 0, "recoil": RECOIL[confidence], "result": "miss"}


def elo_update(rating_a: float, rating_b: float, score_a: float, k: int = 32) -> tuple[int, int]:
    expected_a = 1 / (1 + 10 ** ((rating_b - rating_a) / 400))
    delta = round(k * (score_a - expected_a))
    return int(rating_a + delta), int(rating_b - delta)


def seal(duel_id: str, round_no: int, agent_id: str, direction: str, confidence: int, salt: str) -> str:
    return hashlib.sha256(f"{duel_id}|{round_no}|{agent_id}|{direction}|{confidence}|{salt}".encode()).hexdigest()


def _trend(closes: list[float]) -> str:
    if len(closes) < 2:
        return "n/a"
    steps = [(b - a) / a * 100 if a else 0 for a, b in zip(closes, closes[1:])]
    return ", ".join(f"{s:+.2f}%" for s in steps)


def context_at(candles: list, index: int) -> dict:
    """What an agent may know at candle `index`: price, 12h change, recent steps."""
    closes = [float(c[4]) for c in candles[: index + 1]]
    price = closes[-1] if closes else 0.0
    base = closes[-25] if len(closes) >= 25 else closes[0] if closes else 0.0
    return {
        "price": price,
        "change_12h": (price - base) / base * 100 if base else 0.0,
        "trend": _trend(closes[-7:]),
    }


def aligned_windows(history: dict[str, list], assets_by_round: list[str]) -> tuple[list[int], dict[str, dict[int, float]]]:
    """Timestamps every needed asset has, and close price by timestamp, so a
    lagging candle on one coin never shifts the rounds of another."""
    needed = sorted(set(assets_by_round))
    by_ts = {a: {int(c[0]): float(c[4]) for c in history.get(a) or []} for a in needed}
    common = sorted(set.intersection(*(set(v) for v in by_ts.values()))) if by_ts else []
    return common, by_ts
