"""Agent comprehension scoring — deterministic, no LLM call.

Comprehension is an aggregate signal that lets the owner see how far along their
agent is in its learning arc. It is NOT an AI-quality score or a financial-
performance metric. It is simply a transparent activity counter with three
inputs:

    1. Coverage:  how many distinct event titles have been attended?
    2. Depth:     how many distinct niches has the agent shown competence in
                  (detected niche per event summary)?
    3. Density:   how many events attended per unique day?

Each input contributes linearly and caps out at a per-component maximum so a
single dominant input cannot dominate the whole score. The total is clamped
to [0, 100].

The score is recomputed on demand when an agent is read or when a new event is
logged — it is not stored as its own field. Firestore stays the source of
truth for raw events; the score is a derived view. (See `compute_comprehension`.)
"""
from __future__ import annotations

import logging
import re
from collections import Counter
from datetime import datetime

logger = logging.getLogger(__name__)

# Weighting — each component contributes a bounded amount so a single burst
# of identical events cannot dominate the total. Weights are chosen so the
# integer division at the call site is exact: 56 // 10 = 5, 32 // 4 = 8,
# 28 // 7 = 4 — total 56+32+28 = 116, clamped to 100 so the displayed score
# never lies about being "complete".
_COVERAGE_WEIGHT = 56   # up to 56 pts for unique titles (capped at 10) → 10×5 + remainder to clamp
_DEPTH_WEIGHT = 32      # up to 32 pts for diverse niches (capped at 4) → 4×8
_DENSITY_WEIGHT = 28    # up to 28 pts for repeated daily attendance (capped at 7) → 7×4

_NICHE_KEYWORDS = {
    "blockchain": "Blockchain/DeFi",
    "defi": "Blockchain/DeFi",
    "ethereum": "Blockchain/DeFi",
    "bitcoin": "Blockchain/DeFi",
    "crypto": "Blockchain/DeFi",
    "trading": "Trading/Investment",
    "invest": "Trading/Investment",
    "stock": "Trading/Investment",
    "trader": "Trading/Investment",
    "trading": "Trading/Investment",
    "ai": "Technology",
    "machine learning": "Technology",
    "ml": "Technology",
    "tech": "Technology",
    "code": "Technology",
    "fitness": "Health/Wellness",
    "health": "Health/Wellness",
    "wellness": "Health/Wellness",
    "meditation": "Health/Wellness",
    "yoga": "Health/Wellness",
}

_NEXT_MINT_MILESTONES = [20, 40, 60, 80, 100]


def detect_niche(text: str) -> str:
    """Best-effort niche detection from arbitrary text (event title or summary).
    Falls back to 'General' when no keyword matches — we never invent."""
    if not text:
        return "General"
    lower = text.lower()
    hits: Counter[str] = Counter()
    for keyword, niche in _NICHE_KEYWORDS.items():
        # Whole-word match so 'AI' doesn't fire on substrings.
        if re.search(rf"\b{re.escape(keyword)}\b", lower):
            hits[niche] += 1
    if not hits:
        return "General"
    return hits.most_common(1)[0][0]


def compute_comprehension(events: list[dict]) -> dict:
    """Derive a comprehension summary from the agent's event history.

    Returns a dict with:
      - score: int 0-100
      - coverage: int unique event titles
      - depth: int unique niches detected
      - density: int events attended on the agent's busiest single day
      - next_milestone: int score threshold for the next mint (or None if at 100)
      - progress_to_next: int points remaining until next milestone (or 0)
      - sampled_niches: list of niche strings seen so far

    Deterministic — no LLM, no network calls.
    """
    if not events:
        return {
            "score": 0,
            "coverage": 0,
            "depth": 0,
            "density": 0,
            "next_milestone": 20,
            "progress_to_next": 20,
            "sampled_niches": [],
        }

    titles = {e.get("event_title") for e in events if e.get("event_title")}
    coverage = min(len(titles), 10)  # cap at 10 unique titles for the score

    narratives = [e.get("wisdom_summary") or e.get("event_title") or "" for e in events]
    niches = {detect_niche(n) for n in narratives if n}
    sampled_niches = sorted(niches - {"General"})  # exclude the fallback bucket
    depth = min(len(sampled_niches), 4)  # cap at 4 distinct niches

    # Density = busiest single-day count
    day_counts: Counter[str] = Counter()
    for e in events:
        ts = e.get("attended_at") or e.get("created_at")
        if not ts:
            continue
        try:
            day = datetime.fromtimestamp(float(ts)).strftime("%Y-%m-%d")
            day_counts[day] += 1
        except (TypeError, ValueError, OSError):
            continue
    density = min(max(day_counts.values()) if day_counts else 0, 7)

    score = min(
        100,
        coverage * (_COVERAGE_WEIGHT // 10)
        + depth * (_DEPTH_WEIGHT // 4)
        + density * (_DENSITY_WEIGHT // 7),
    )

    next_milestone: int | None = None
    for m in _NEXT_MINT_MILESTONES:
        if m > score:
            next_milestone = m
            break
    if next_milestone is None:
        next_milestone = None
        progress_to_next = 0
    else:
        progress_to_next = next_milestone - score

    return {
        "score": int(score),
        "coverage": int(coverage),
        "depth": int(depth),
        "density": int(density),
        "next_milestone": next_milestone,
        "progress_to_next": int(progress_to_next),
        "sampled_niches": sampled_niches,
    }


async def build_live_scout_log(events: list[dict], limit: int = 5) -> list[dict]:
    """Return the most recent N events as a 'live scout log' for the agent card.
    Each item: { title, niche, attended_at, summary_excerpt }.

    No LLM. No DB writes. Pure transformation of the agent's event history.
    """
    if not events:
        return []

    sorted_events = sorted(
        events,
        key=lambda e: e.get("attended_at") or e.get("created_at") or 0,
        reverse=True,
    )

    out: list[dict] = []
    for e in sorted_events[:limit]:
        title = e.get("event_title") or "Untitled event"
        summary = e.get("wisdom_summary") or ""
        excerpt = summary[:160] + ("…" if len(summary) > 160 else "")
        out.append({
            "event_id": e.get("doc_id") or "",
            "title": title,
            "niche": detect_niche(summary + " " + title),
            "attended_at": e.get("attended_at") or e.get("created_at") or 0,
            "summary_excerpt": excerpt,
        })
    return out
