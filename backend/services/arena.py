"""
Arena — Agent Duel: two agents fight 1v1 by calling the market.

How a duel works
----------------
1. Scouting (the only AI step). When the duel starts, each agent gets ONE
   model call: it reads its own lessons, its fighter stats and the market for
   every round's asset, and commits a battle plan — up/down + confidence for
   every round — plus a one-line strategy. Two calls per duel, however many
   rounds.
2. The fight is algorithmic. Each round settles on the asset's real price
   move over the round's window. A right call hits; a wrong call at high
   confidence recoils. Damage, critical hits and the move shown (slash, kick,
   combo, blast...) come from fixed formulas over the fighters' stats, seeded
   by the duel id, so every spectator sees the same fight.
3. First to 0 HP is knocked out; otherwise the higher HP wins. ELO ratings.

Fighter stats (no AI): POWER from level, GUARD from lessons studied, FOCUS
from the agent's strongest skill. Style comes from personality.

Two match types
---------------
- live: rounds settle on future prices (5m / 15m / 1h windows).
- instant: the plan is made from market data up to a cutoff in the last 24h
  and judged on the 30-minute candles that followed it, so the whole fight
  plays at once. The model only ever sees data up to the cutoff.

Safety model (same as Agent Room)
---------------------------------
- A duel only produces text and a rating. Nothing is signed, traded or moved.
- Starting a duel needs the owner's signature and on-chain ownership of the
  challenger; the opponent is the owner's own agent, or one whose owner
  marked it open to challenges. Memory text is quoted as data to the model.
- Live calls stay sealed (only a hash is public) until their round settles.
"""
from __future__ import annotations

import hashlib
import logging
import os
import secrets
import time
from typing import Any, Awaitable, Callable

from google.cloud.firestore_v1.base_query import FieldFilter

from services.agent_room import (
    _GUARD, _parse_json, _quote, call_room_llm, load_agent_memories, rank_memories,
)

logger = logging.getLogger(__name__)

DUELS_COLLECTION = "arena_duels"
RATINGS_COLLECTION = "arena_ratings"
CHALLENGES_COLLECTION = "arena_challenges"
QUOTA_COLLECTION = "arena_quota"
AGENTS_COLLECTION = "agents"

START_HP = 100
MIN_ROUNDS, MAX_ROUNDS, DEFAULT_ROUNDS = 3, 7, 5
MODES = ("instant", "live")
DEFAULT_MODE = "instant"
LIVE_HORIZONS = {"5m": 5 * 60, "15m": 15 * 60, "1h": 3600}
DEFAULT_HORIZON = "15m"
INSTANT_CANDLE_SECONDS = 30 * 60
# CoinGecko ids; one asset per round, rotating from a per-duel offset.
ASSETS = ["bitcoin", "ethereum", "solana", "binancecoin", "mantle"]
ASSET_SYMBOL = {"bitcoin": "BTC", "ethereum": "ETH", "solana": "SOL", "binancecoin": "BNB", "mantle": "MNT"}
# Damage by confidence (1..3) for a right call; recoil for a wrong one.
HIT = {1: 14, 2: 22, 3: 30}
RECOIL = {1: 0, 2: 6, 3: 12}
MAGNITUDE_BONUS_MAX = 10
MIN_HIT = 6
CRIT_MULTIPLIER = 1.5
FLAT_EPS = 0.0002  # |move| under 0.02% is "no move": nobody lands
ELO_K = {"live": 32, "instant": 16}
START_RATING = 1000
STAT_MIN, STAT_MAX = 8, 40
STYLES = {"Aggressive": "striker", "Analytical": "tactician", "Creative": "trickster"}
# Preferred finishing moves per style; any style can throw any move.
STYLE_MOVES = {
    "striker": ("kick", "combo"),
    "tactician": ("slash", "blast"),
    "trickster": ("blast", "combo"),
}
CHALLENGE_TTL_SECONDS = 10 * 60
DUELS_PER_OWNER_PER_DAY = int(os.environ.get("ARENA_DUELS_PER_DAY", 6))
MAX_LIVE_DUELS = int(os.environ.get("ARENA_MAX_LIVE", 20))
AI_CALLS_PER_DUEL = 2
MEMORIES_PER_PLAN = 5
MAX_REASONING_CHARS = 200
MAX_STRATEGY_CHARS = 140
# A tick holds a duel for this long so two callers cannot resolve it twice.
RESOLVE_LOCK_SECONDS = 45
PRICE_CACHE_SECONDS = 20

LLM = Callable[..., Awaitable[str]]


def arena_enabled() -> bool:
    return os.environ.get("ARENA_ENABLED", "").strip().lower() in ("1", "true", "yes", "on")


class ArenaError(Exception):
    """Invalid request — HTTP 400."""


class ArenaLimitReached(Exception):
    """A cost cap was hit — HTTP 429."""


class ArenaForbidden(Exception):
    """Not the owner — HTTP 403."""


# ── Pure rules ───────────────────────────────────────────────────────────────

def _clamp(v: float, lo: int = STAT_MIN, hi: int = STAT_MAX) -> int:
    return int(max(lo, min(hi, round(v))))


def fighter_stats(agent: dict) -> dict:
    """Stats from what the agent has actually done: level, lessons, best skill."""
    level = int(agent.get("level") or 1)
    lessons = int(agent.get("total_events") or 0)
    skills = [int(v or 0) for v in (agent.get("skill_scores") or {}).values()]
    return {
        "power": _clamp(10 + 2 * level),
        "guard": _clamp(8 + lessons),
        "focus": _clamp(8 + 2 * max(skills, default=0)),
    }


def style_of(personality: str | None) -> str:
    return STYLES.get(personality or "", "tactician")


def asset_for_round(seed: str, round_no: int) -> str:
    offset = int(hashlib.sha256(seed.encode()).hexdigest(), 16) % len(ASSETS)
    return ASSETS[(offset + round_no - 1) % len(ASSETS)]


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


def strike(duel_id: str, round_no: int, me: dict, them: dict, direction: str, confidence: int, move: float) -> dict:
    """Outcome with stats applied, plus the move to show."""
    o = outcome(direction, confidence, move)
    seed = (duel_id, round_no, me["agent_id"])
    if o["result"] == "hit":
        dmg = o["hit"] * (1 + (me["stats"]["power"] - them["stats"]["guard"]) / 100)
        crit = roll(*seed, "crit") < me["stats"]["focus"] / 200
        dmg = max(MIN_HIT, round(dmg * (CRIT_MULTIPLIER if crit else 1)))
        heavy = crit or dmg >= 35
        pool = ("combo", "blast") if heavy else ("slash", "kick", "combo") if dmg >= 20 else ("slash", "kick")
        liked = [m for m in pool if m in STYLE_MOVES[me["style"]]]
        weighted = list(pool) + liked  # preferred moves count twice
        move_name = weighted[int(roll(*seed, "move") * len(weighted)) % len(weighted)]
        return {"hit": dmg, "recoil": 0, "result": "hit", "crit": crit, "move": move_name}
    if o["result"] == "miss":
        recoil = round(o["recoil"] * (1 - me["stats"]["guard"] / 200))
        return {"hit": 0, "recoil": recoil, "result": "miss", "crit": False, "move": "stumble" if recoil else "whiff"}
    return {"hit": 0, "recoil": 0, "result": "flat", "crit": False, "move": "clash"}


def elo_update(rating_a: float, rating_b: float, score_a: float, k: int = 32) -> tuple[int, int]:
    expected_a = 1 / (1 + 10 ** ((rating_b - rating_a) / 400))
    delta = round(k * (score_a - expected_a))
    return int(rating_a + delta), int(rating_b - delta)


def seal(duel_id: str, round_no: int, agent_id: str, direction: str, confidence: int, salt: str) -> str:
    return hashlib.sha256(f"{duel_id}|{round_no}|{agent_id}|{direction}|{confidence}|{salt}".encode()).hexdigest()


def _today_utc() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


# ── Owner challenge ──────────────────────────────────────────────────────────

def duel_message(owner: str, agent_id: str, opponent_id: str, rounds: int, mode: str, horizon: str,
                 open_to_challenges: bool, nonce: str, expires_at: float) -> str:
    return (
        "ASAJU Arena Duel\n"
        f"Owner: {owner}\n"
        f"Challenger: {agent_id}\n"
        f"Opponent: {opponent_id}\n"
        f"Rounds: {rounds}\n"
        f"Mode: {mode}\n"
        f"Round window: {horizon}\n"
        f"Open to challenges: {'yes' if open_to_challenges else 'no'}\n"
        f"Nonce: {nonce}\n"
        f"Expires at: {int(expires_at)}\n"
        "A duel is a prediction game between agents. It cannot trade, sign or move funds."
    )


def validate_duel_request(agent_id: str, opponent_id: str, rounds: int, mode: str, horizon: str) -> tuple[str, str, int, str, str]:
    agent_id, opponent_id = (agent_id or "").strip(), (opponent_id or "").strip()
    if not agent_id or not opponent_id:
        raise ArenaError("Pick a challenger and an opponent")
    if agent_id == opponent_id:
        raise ArenaError("An agent cannot duel itself")
    if not MIN_ROUNDS <= int(rounds) <= MAX_ROUNDS:
        raise ArenaError(f"Rounds must be between {MIN_ROUNDS} and {MAX_ROUNDS}")
    if mode not in MODES:
        raise ArenaError("Unknown match type")
    if mode == "instant":
        horizon = "30m"
    elif horizon not in LIVE_HORIZONS:
        raise ArenaError("Unknown round window")
    return agent_id, opponent_id, int(rounds), mode, horizon


async def duels_left_today(db, owner: str) -> int:
    snap = await db.collection(QUOTA_COLLECTION).document(f"{owner.lower()}:{_today_utc()}").get()
    used = int((snap.to_dict() or {}).get("used") or 0) if snap.exists else 0
    return max(0, DUELS_PER_OWNER_PER_DAY - used)


async def _consume_quota(db, owner: str) -> int:
    ref = db.collection(QUOTA_COLLECTION).document(f"{owner.lower()}:{_today_utc()}")
    snap = await ref.get()
    used = int((snap.to_dict() or {}).get("used") or 0) if snap.exists else 0
    if used >= DUELS_PER_OWNER_PER_DAY:
        raise ArenaLimitReached(f"Daily limit reached ({DUELS_PER_OWNER_PER_DAY} duels per day)")
    await ref.set({"owner": owner.lower(), "day": _today_utc(), "used": used + 1})
    return DUELS_PER_OWNER_PER_DAY - used - 1


async def issue_challenge(db, *, owner: str, agent_id: str, opponent_id: str, rounds: int,
                          mode: str = DEFAULT_MODE, horizon: str = DEFAULT_HORIZON,
                          open_to_challenges: bool = True) -> dict:
    agent_id, opponent_id, rounds, mode, horizon = validate_duel_request(agent_id, opponent_id, rounds, mode, horizon)
    nonce = secrets.token_urlsafe(24)
    expires_at = time.time() + CHALLENGE_TTL_SECONDS
    message = duel_message(owner, agent_id, opponent_id, rounds, mode, horizon, open_to_challenges, nonce, expires_at)
    await db.collection(CHALLENGES_COLLECTION).document(nonce).set({
        "nonce": nonce, "message": message, "owner": owner.lower(), "agent_id": agent_id,
        "opponent_id": opponent_id, "rounds": rounds, "mode": mode, "horizon": horizon,
        "open_to_challenges": bool(open_to_challenges), "expires_at": expires_at, "created_at": time.time(),
    })
    return {"nonce": nonce, "message": message, "expires_at": expires_at, "max_llm_calls": AI_CALLS_PER_DUEL}


async def _fighter(db, agent_id: str) -> tuple[dict, dict]:
    snap = await db.collection(AGENTS_COLLECTION).document(agent_id).get()
    if not snap.exists:
        raise ArenaError(f"Agent {agent_id} not found")
    a = snap.to_dict() or {}
    if a.get("ownership_status") != "bred" and not a.get("funded"):
        raise ArenaError(f"{a.get('agent_name', agent_id)} is not active on-chain yet")
    personality = a.get("personality") or "Analytical"
    return a, {
        "agent_id": agent_id,
        "name": a.get("agent_name") or agent_id,
        "niche": a.get("niche") or "General",
        "personality": personality,
        "style": style_of(personality),
        "stats": fighter_stats(a),
        "level": int(a.get("level") or 1),
        "lessons": int(a.get("total_events") or 0),
        "chain_id": int(a.get("chain_id") or 5003),
        "avatar_seed": a.get("avatar_seed"),
        "owner": (a.get("user_wallet") or "").lower(),
        "hp": START_HP,
    }


async def _rating_doc(db, agent_id: str) -> dict:
    snap = await db.collection(RATINGS_COLLECTION).document(agent_id).get()
    return (snap.to_dict() or {}) if snap.exists else {}


# ── Market data ──────────────────────────────────────────────────────────────

class Market:
    """Prices for the arena. Live rounds need fresher prices than the shared
    5-minute cache, so this keeps its own short cache. Tests pass a stand-in
    with the same two methods."""

    def __init__(self) -> None:
        self._now: tuple[float, dict] | None = None

    async def now(self, assets: list[str]) -> dict[str, dict]:
        from services.market_data_service import _coingecko_get

        if self._now and time.time() - self._now[0] < PRICE_CACHE_SECONDS and all(a in self._now[1] for a in assets):
            return self._now[1]
        raw = await _coingecko_get("/simple/price", {
            "ids": ",".join(ASSETS), "vs_currencies": "usd", "include_24hr_change": "true",
        })
        out = {a: {"price": float((raw.get(a) or {}).get("usd") or 0),
                   "change_24h": float((raw.get(a) or {}).get("usd_24h_change") or 0)} for a in ASSETS}
        self._now = (time.time(), out)
        return out

    async def history(self, assets: list[str]) -> dict[str, list]:
        """Last 24h of 30-minute candles per asset: [ts_ms, open, high, low, close]."""
        from services.market_data_service import get_ohlc

        return {a: await get_ohlc(a, 1) or [] for a in assets}


_market = Market()


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


# ── The AI step: one plan per fighter ────────────────────────────────────────

def build_plan_prompt(fighter: dict, opponent: dict, rounds: list[dict], window: str, memories: list[dict]) -> str:
    rows = "\n".join(
        f'<memory id="m{i}" title="{_quote(m["title"], 100)}">{_quote(m["text"], 340)}</memory>'
        for i, m in enumerate(memories)
    ) or "(no lessons yet)"
    board = "\n".join(
        f"Round {r['round']}: {r['symbol']} ${r['context']['price']:,.4f} · "
        + (f"12h {r['context']['change_12h']:+.2f}% · last 30m steps: {r['context']['trend']}"
           if "change_12h" in r["context"] else f"24h {r['context'].get('change_24h', 0):+.2f}%")
        for r in rounds
    )
    s = fighter["stats"]
    return (
        f"You are {fighter['name']}, an ASAJU AI agent (niche: {fighter['niche']}, personality: "
        f"{fighter['personality']}, level {fighter['level']}, {fighter['lessons']} lessons) about to fight an "
        f"Arena duel against {opponent['name']} (level {opponent['level']}).\n"
        f"Your stats: POWER {s['power']} (hits land harder), GUARD {s['guard']} (you take less), "
        f"FOCUS {s['focus']} (critical-hit chance).\n"
        f"{_GUARD}\n\n"
        f"Each round settles on whether that round's asset is higher or lower {window} later. "
        "A right call hits your opponent; a wrong call at confidence 2–3 hurts you. You plan every "
        "round NOW and cannot change it later.\n"
        f"Market:\n{board}\n\n"
        f"Your lessons:\n{rows}\n\n"
        "Write a one-line battle strategy, then one call per round: \"up\" or \"down\", confidence "
        "1 (lean) / 2 (clear) / 3 (strong), and one short reason from your lessons and the numbers. "
        "Cite lesson ids you used.\n"
        'Reply with JSON only: {"strategy":"...","calls":[{"round":1,"direction":"up","confidence":2,'
        '"reasoning":"...","cited":["m0"]}]}'
    )


async def _plan(db, duel_id: str, fighter: dict, opponent: dict, rounds: list[dict], window: str, llm: LLM) -> dict:
    query = " ".join(f"{r['asset']} {r['symbol']}" for r in rounds) + " price trend"
    memories = rank_memories(await load_agent_memories(db, fighter["agent_id"]), query, MEMORIES_PER_PLAN)
    prompt = build_plan_prompt(fighter, opponent, rounds, window, memories)
    strategy, by_round, fallback_all = "", {}, False
    try:
        raw = await llm(prompt, context=f"arena:{duel_id}:plan:{fighter['agent_id']}",
                        max_tokens=180 + 80 * len(rounds), temperature=0.7)
        parsed = _parse_json(raw, want="calls")
        strategy = " ".join(str(parsed.get("strategy") or "").split())[:MAX_STRATEGY_CHARS]
        ids = {f"m{i}" for i in range(len(memories))}
        for c in parsed.get("calls") or []:
            try:
                n = int(c.get("round"))
            except (TypeError, ValueError, AttributeError):
                continue
            direction = str(c.get("direction") or "").lower()
            if direction not in ("up", "down"):
                continue
            by_round[n] = {
                "direction": direction,
                "confidence": max(1, min(3, int(c.get("confidence") or 1))),
                "reasoning": " ".join(str(c.get("reasoning") or "").split())[:MAX_REASONING_CHARS],
                "cited": [memories[int(x[1:])]["title"] for x in c.get("cited") or [] if isinstance(x, str) and x in ids],
                "fallback": False,
            }
    except Exception as exc:
        fallback_all = True
        logger.warning("arena plan failed for %s: %s", fighter["agent_id"], exc.__class__.__name__)

    calls = []
    for r in rounds:
        call = by_round.get(r["round"])
        if not call:
            # Momentum fallback, marked so the UI never passes it off as reasoning.
            ctx = r["context"]
            up = float(ctx.get("change_12h", ctx.get("change_24h", 0)) or 0) >= 0
            call = {"direction": "up" if up else "down", "confidence": 1,
                    "reasoning": "Followed recent momentum (no plan for this round).", "cited": [], "fallback": True}
        salt = secrets.token_hex(8)
        calls.append({**call, "round": r["round"], "agent_id": fighter["agent_id"], "salt": salt,
                      "commit": seal(duel_id, r["round"], fighter["agent_id"], call["direction"], call["confidence"], salt)})
    if fallback_all or not strategy:
        strategy = strategy or "Reads momentum and stays disciplined."
    return {"strategy": strategy, "calls": calls}


# ── Opening a duel ───────────────────────────────────────────────────────────

async def open_duel(db, *, nonce: str, signature: str, owner_of, llm: LLM | None = None,
                    market=None, now: float | None = None) -> dict:
    """Verify the owner's signature, check ownership now, scout both fighters
    (the only AI step) and either seal round 1 (live) or play it all (instant)."""
    from eth_account import Account
    from eth_account.messages import encode_defunct

    now = now or time.time()
    market = market or _market
    llm = llm or call_room_llm
    ref = db.collection(CHALLENGES_COLLECTION).document(nonce)
    snap = await ref.get()
    if not snap.exists:
        raise ArenaError("Unknown or expired duel request — start again")
    ch = snap.to_dict() or {}
    if ch.get("used_at"):
        raise ArenaError("This duel request was already used")
    if float(ch.get("expires_at") or 0) < now:
        raise ArenaError("Duel request expired — start again")
    try:
        signer = Account.recover_message(encode_defunct(text=ch["message"]), signature=signature)
    except Exception as exc:
        raise ArenaError("Signature could not be verified") from exc
    if signer.lower() != ch["owner"]:
        raise ArenaError("Signature does not match the owner who asked for this duel")
    await ref.update({"used_at": now})

    a_doc, a = await _fighter(db, ch["agent_id"])
    owner_now = (await owner_of(ch["agent_id"], a_doc)) or ""
    if owner_now.lower() != signer.lower():
        raise ArenaForbidden(f"{a['name']} is not owned by this wallet")
    a["owner"] = signer.lower()

    b_doc, b = await _fighter(db, ch["opponent_id"])
    b_owner = (await owner_of(ch["opponent_id"], b_doc)) or b["owner"]
    b["owner"] = b_owner.lower()
    if b["owner"] != signer.lower():
        if not (await _rating_doc(db, ch["opponent_id"])).get("open_to_challenges"):
            raise ArenaForbidden(f"{b['name']} is not open to challenges")

    mode = ch.get("mode") or "live"
    if mode == "live" and await _count_live(db) >= MAX_LIVE_DUELS:
        raise ArenaLimitReached("The arena is full right now — try again in a few minutes")

    duel_id = secrets.token_urlsafe(12)
    rounds_total = int(ch["rounds"])
    assets = [asset_for_round(duel_id, n) for n in range(1, rounds_total + 1)]
    plan_rounds, windows = await _plan_board(market, mode, assets, rounds_total, now)

    left = await _consume_quota(db, signer)
    for f in (a, b):
        f["rating"] = int((await _rating_doc(db, f["agent_id"])).get("rating") or START_RATING)
    await _upsert_rating(db, a, open_to_challenges=bool(ch.get("open_to_challenges")))
    await _upsert_rating(db, b)

    window_label = "30 minutes" if mode == "instant" else ch["horizon"]
    duel = {
        "duel_id": duel_id,
        "status": "live",
        "mode": mode,
        "owner": signer.lower(),
        "rounds_total": rounds_total,
        "horizon": ch["horizon"],
        "horizon_seconds": INSTANT_CANDLE_SECONDS if mode == "instant" else LIVE_HORIZONS[ch["horizon"]],
        "fighters": [a, b],
        "rounds": [],
        "plans": {},
        "ai_calls": AI_CALLS_PER_DUEL,
        "winner": None,
        "result": None,
        "created_at": now,
        "updated_at": now,
        "lock_until": 0,
    }
    for me, them in ((a, b), (b, a)):
        plan = await _plan(db, duel_id, me, them, plan_rounds, window_label, llm)
        me["strategy"] = plan["strategy"]
        duel["plans"][me["agent_id"]] = plan["calls"]

    if mode == "instant":
        for n, (t_open, t_close, p_open, p_close) in enumerate(windows, start=1):
            _open_round(duel, n, assets[n - 1], p_open, t_open)
            resolve_round(duel, duel["rounds"][-1], p_close, t_close)
            if _finish_if_over(duel, now):
                break
        if duel["status"] != "finished":
            _finish_if_over(duel, now, force=True)
        await _settle_ratings(db, duel)
    else:
        prices = await market.now(assets)
        _open_round(duel, 1, assets[0], prices[assets[0]]["price"], now)

    await db.collection(DUELS_COLLECTION).document(duel_id).set(duel)
    return public_duel(duel) | {"duels_left_today": left}


async def _plan_board(market, mode: str, assets: list[str], rounds_total: int, now: float) -> tuple[list[dict], list]:
    """The market each fighter sees when planning, and (instant) the windows
    the rounds will be judged on."""
    distinct = sorted(set(assets))
    if mode == "instant":
        history = await market.history(distinct)
        common, by_ts = aligned_windows(history, assets)
        if len(common) < rounds_total + 8:
            raise ArenaError("Not enough recent market data for an instant duel — try a live duel")
        cut = len(common) - 1 - rounds_total
        board = []
        for n, asset in enumerate(assets, start=1):
            candles = [[t, 0, 0, 0, by_ts[asset][t]] for t in common[: cut + 1]]
            board.append({"round": n, "asset": asset, "symbol": ASSET_SYMBOL[asset], "context": context_at(candles, cut)})
        windows = [
            (common[cut + n - 1] / 1000, common[cut + n] / 1000,
             by_ts[asset][common[cut + n - 1]], by_ts[asset][common[cut + n]])
            for n, asset in enumerate(assets, start=1)
        ]
        return board, windows
    prices = await market.now(distinct)
    if not all(prices.get(a, {}).get("price") for a in distinct):
        raise ArenaError("Market price is unavailable right now — try again shortly")
    board = [{"round": n, "asset": a, "symbol": ASSET_SYMBOL[a],
              "context": {"price": prices[a]["price"], "change_24h": prices[a]["change_24h"]}}
             for n, a in enumerate(assets, start=1)]
    return board, []


async def _count_live(db) -> int:
    n = 0
    async for _ in db.collection(DUELS_COLLECTION).where(filter=FieldFilter("status", "==", "live")).stream():
        n += 1
    return n


async def _upsert_rating(db, f: dict, open_to_challenges: bool | None = None) -> None:
    current = await _rating_doc(db, f["agent_id"])
    await db.collection(RATINGS_COLLECTION).document(f["agent_id"]).set({
        "agent_id": f["agent_id"], "name": f["name"], "niche": f["niche"], "avatar_seed": f.get("avatar_seed"),
        "owner": f["owner"], "chain_id": f["chain_id"], "level": f["level"], "stats": f.get("stats"),
        "rating": int(current.get("rating") or START_RATING),
        "wins": int(current.get("wins") or 0), "losses": int(current.get("losses") or 0),
        "draws": int(current.get("draws") or 0), "kos": int(current.get("kos") or 0),
        "streak": int(current.get("streak") or 0),
        "open_to_challenges": bool(current.get("open_to_challenges")) if open_to_challenges is None else open_to_challenges,
        "updated_at": time.time(),
    })


# ── Rounds ───────────────────────────────────────────────────────────────────

def _open_round(duel: dict, round_no: int, asset: str, open_price: float, opened_at: float) -> None:
    picks = [next(c for c in duel["plans"][f["agent_id"]] if c["round"] == round_no) for f in duel["fighters"]]
    duel["rounds"].append({
        "round": round_no, "asset": asset, "symbol": ASSET_SYMBOL.get(asset, asset),
        "open_price": open_price, "opened_at": opened_at,
        "resolve_at": opened_at + duel["horizon_seconds"], "status": "sealed",
        "picks": [dict(p) for p in picks],
    })
    duel["updated_at"] = max(float(duel.get("updated_at") or 0), opened_at)


def resolve_round(duel: dict, rnd: dict, close_price: float, now: float) -> None:
    """Apply the move to both fighters. Pure: no I/O."""
    move = move_of(rnd["open_price"], close_price)
    a, b = duel["fighters"]
    for pick, me, them in ((rnd["picks"][0], a, b), (rnd["picks"][1], b, a)):
        s = strike(duel["duel_id"], rnd["round"], me, them, pick["direction"], pick["confidence"], move)
        pick.update(s)
        them["hp"] = max(0, them["hp"] - s["hit"])
        me["hp"] = max(0, me["hp"] - s["recoil"])
    rnd.update({"close_price": close_price, "move": move, "status": "resolved", "resolved_at": now,
                "hp_after": [a["hp"], b["hp"]]})


def _finish_if_over(duel: dict, now: float, force: bool = False) -> bool:
    a, b = duel["fighters"]
    ko = a["hp"] <= 0 or b["hp"] <= 0
    if not (ko or force or len(duel["rounds"]) >= duel["rounds_total"]):
        return False
    if a["hp"] == b["hp"]:
        duel["winner"], duel["result"] = None, "draw"
    else:
        w = 0 if a["hp"] > b["hp"] else 1
        duel["winner"] = duel["fighters"][w]["agent_id"]
        duel["result"] = "ko" if ko else "decision"
    duel["status"], duel["finished_at"], duel["updated_at"] = "finished", now, now
    return True


async def _settle_ratings(db, duel: dict) -> None:
    a, b = duel["fighters"]
    score_a = 0.5 if duel["result"] == "draw" else (1.0 if duel["winner"] == a["agent_id"] else 0.0)
    ra, rb = await _rating_doc(db, a["agent_id"]), await _rating_doc(db, b["agent_id"])
    k = ELO_K.get(duel.get("mode") or "live", 32)
    new_a, new_b = elo_update(int(ra.get("rating") or START_RATING), int(rb.get("rating") or START_RATING), score_a, k)
    for f, doc, new, score in ((a, ra, new_a, score_a), (b, rb, new_b, 1 - score_a)):
        f["rating_before"], f["rating_after"] = int(doc.get("rating") or START_RATING), new
        won, lost = score == 1.0, score == 0.0
        streak = int(doc.get("streak") or 0)
        doc.update({
            "agent_id": f["agent_id"], "name": f["name"], "niche": f["niche"], "avatar_seed": f.get("avatar_seed"),
            "owner": f["owner"], "chain_id": f["chain_id"], "level": f["level"], "stats": f.get("stats"), "rating": new,
            "wins": int(doc.get("wins") or 0) + won, "losses": int(doc.get("losses") or 0) + lost,
            "draws": int(doc.get("draws") or 0) + (score == 0.5),
            "kos": int(doc.get("kos") or 0) + (won and duel["result"] == "ko"),
            "streak": (max(streak, 0) + 1) if won else ((min(streak, 0) - 1) if lost else 0),
            "open_to_challenges": bool(doc.get("open_to_challenges")),
            "last_duel_id": duel["duel_id"], "updated_at": time.time(),
        })
        await db.collection(RATINGS_COLLECTION).document(f["agent_id"]).set(doc)


async def advance_duel(db, duel_id: str, market=None, now: float | None = None) -> dict:
    """Settle the live round if its window has passed, then open the next one
    (or finish). No AI here. Safe to call any time: nothing happens early."""
    now = now or time.time()
    market = market or _market
    ref = db.collection(DUELS_COLLECTION).document(duel_id)
    snap = await ref.get()
    if not snap.exists:
        raise ArenaError("Duel not found")
    duel = snap.to_dict() or {}
    if duel.get("status") != "live" or not duel.get("rounds"):
        return public_duel(duel)
    rnd = duel["rounds"][-1]
    if rnd.get("status") != "sealed" or now < float(rnd.get("resolve_at") or 0):
        return public_duel(duel)
    if float(duel.get("lock_until") or 0) > now:
        return public_duel(duel)
    await ref.update({"lock_until": now + RESOLVE_LOCK_SECONDS})

    try:
        prices = await market.now(ASSETS)
        close = prices.get(rnd["asset"], {}).get("price")
        if not close:
            raise ArenaError("Market price is unavailable")
        resolve_round(duel, rnd, close, now)
        if _finish_if_over(duel, now):
            await _settle_ratings(db, duel)
        else:
            nxt = len(duel["rounds"]) + 1
            asset = asset_for_round(duel_id, nxt)
            _open_round(duel, nxt, asset, prices[asset]["price"], now)
    except Exception:
        await ref.update({"lock_until": 0})
        raise
    duel["lock_until"] = 0
    await ref.set(duel)
    return public_duel(duel)


async def tick(db, market=None, now: float | None = None) -> dict:
    """Scheduler entry: advance every live duel whose round is due."""
    now = now or time.time()
    advanced, failed, due = 0, 0, []
    async for snap in db.collection(DUELS_COLLECTION).where(filter=FieldFilter("status", "==", "live")).stream():
        d = snap.to_dict() or {}
        rnd = (d.get("rounds") or [{}])[-1]
        if rnd.get("status") == "sealed" and now >= float(rnd.get("resolve_at") or 0):
            due.append(d["duel_id"])
    for duel_id in due:
        try:
            await advance_duel(db, duel_id, market, now)
            advanced += 1
        except Exception as exc:
            failed += 1
            logger.warning("arena tick: duel %s failed: %s", duel_id, exc.__class__.__name__)
    return {"live_due": len(due), "advanced": advanced, "failed": failed}


# ── Reads ────────────────────────────────────────────────────────────────────

def public_duel(duel: dict) -> dict:
    """The duel as spectators see it: plans stay private, sealed calls show
    only their commit."""
    out = {k: v for k, v in duel.items() if k not in ("lock_until", "plans")}
    rounds = []
    for r in duel.get("rounds") or []:
        r = dict(r)
        if r.get("status") == "sealed":
            r["picks"] = [{"agent_id": p["agent_id"], "commit": p["commit"], "sealed": True} for p in r["picks"]]
        else:
            r["picks"] = [{k: v for k, v in p.items() if k != "salt"} for p in r["picks"]]
        rounds.append(r)
    out["rounds"] = rounds
    return out


async def get_duel(db, duel_id: str) -> dict:
    snap = await db.collection(DUELS_COLLECTION).document(duel_id).get()
    if not snap.exists:
        raise ArenaError("Duel not found")
    return public_duel(snap.to_dict() or {})


async def list_duels(db, status: str | None, limit: int) -> list[dict]:
    q = db.collection(DUELS_COLLECTION)
    if status in ("live", "finished"):
        q = q.where(filter=FieldFilter("status", "==", status))
    q = q.order_by("updated_at", direction="DESCENDING").limit(limit)
    out = []
    async for snap in q.stream():
        d = public_duel(snap.to_dict() or {})
        # Lists stay light: picks live on the duel page.
        d["rounds"] = [{k: v for k, v in r.items() if k != "picks"} for r in d["rounds"]]
        out.append(d)
    return out


async def leaderboard(db, limit: int = 50) -> list[dict]:
    out = []
    async for snap in db.collection(RATINGS_COLLECTION).order_by("rating", direction="DESCENDING").limit(limit).stream():
        d = snap.to_dict() or {}
        d["duels"] = int(d.get("wins") or 0) + int(d.get("losses") or 0) + int(d.get("draws") or 0)
        out.append(d)
    return out


async def open_agents(db, limit: int = 100) -> list[dict]:
    """Agents whose owners marked them open to challenges."""
    out = []
    async for snap in db.collection(RATINGS_COLLECTION).where(filter=FieldFilter("open_to_challenges", "==", True)).stream():
        out.append(snap.to_dict() or {})
    out.sort(key=lambda d: -int(d.get("rating") or 0))
    return out[:limit]


def config() -> dict:
    return {
        "enabled": arena_enabled(),
        "modes": {"duel": "Agent Duel"},
        "match_types": list(MODES), "default_match_type": DEFAULT_MODE,
        "start_hp": START_HP,
        "min_rounds": MIN_ROUNDS, "max_rounds": MAX_ROUNDS, "default_rounds": DEFAULT_ROUNDS,
        "horizons": list(LIVE_HORIZONS), "default_horizon": DEFAULT_HORIZON,
        "assets": [ASSET_SYMBOL[a] for a in ASSETS],
        "hit": HIT, "recoil": RECOIL, "duels_per_day": DUELS_PER_OWNER_PER_DAY,
        "ai_calls_per_duel": AI_CALLS_PER_DUEL,
    }
