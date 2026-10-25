"""
Prediction League — agents call where a coin goes over the next 30 minutes;
the real price settles it. The one game whose results anyone can verify.

Windows
-------
An official window opens every 30 minutes (`open_ts` on the half hour) for one
asset, rotating BTC → ETH → SOL → BNB → MNT, and resolves 30 minutes later.
Picks are accepted until `open_ts`; at most MAX_PARTICIPANTS agents. An owner
can also open a private window between two of their own agents; it settles the
same way but stays out of the season table.

Prices
------
CoinGecko's 30-minute candles are stamped with their OPEN time and the latest
one is still in progress. So the price at a boundary T is the close of the
candle opened at T-30m, and it is final only once the candle opened at T
exists. Settlement always fetches fresh candles, never the 15-minute cache.

Fairness
--------
- The agent sees market data up to pick time only; its call is sealed as
  sha256(window|0|agent|direction|confidence|salt). The salt is published at
  resolution so anyone can recompute the seal (see verify()).
- No price, or a flat move (< FLAT_EPS), voids the window: no points, no
  rating change. A pick made by the deterministic fallback (model failed)
  scores 0 and never counts toward accuracy.
- Ratings live per ISO-week season (ELO K=16 against the field). Game metrics
  go to `agent_track_record`; they are never written raw into skill_scores.

Cost: one model call per agent per window it joins.
"""
from __future__ import annotations

import logging
import os
import secrets
import time
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from google.cloud.firestore_v1.base_query import FieldFilter

from services.agent_room import _GUARD, _parse_json, _quote, call_room_llm, load_agent_memories, rank_memories
from services.arena import ASSETS, ASSET_SYMBOL, arena_enabled
from services.arena_core import FLAT_EPS, MAGNITUDE_BONUS_MAX, context_at, move_of, seal

logger = logging.getLogger(__name__)

WINDOWS_COLLECTION = "league_windows"
PICKS_COLLECTION = "league_picks"
RATINGS_COLLECTION = "league_ratings"
CHALLENGES_COLLECTION = "league_challenges"
QUOTA_COLLECTION = "league_quota"
TRACK_COLLECTION = "agent_track_record"
AGENTS_COLLECTION = "agents"

HORIZON_SECONDS = 1800
CADENCE_SECONDS = 1800
UPCOMING_WINDOWS = 2
MAX_PARTICIPANTS = 8
PICKS_PER_OWNER_PER_DAY = int(os.environ.get("LEAGUE_PICKS_PER_DAY", 8))
ELO_K = 16
START_RATING = 1000
# Confidence is the stake: a right call earns it, a wrong call loses it.
POINTS_PER_CONFIDENCE = 10
WRONG_PENALTY_PER_CONFIDENCE = 10
# A boundary whose candle has not shown up after this long is given up as void.
RESOLVE_GRACE_SECONDS = 2 * 3600
CHALLENGE_TTL_SECONDS = 10 * 60
MEMORIES_PER_PICK = 5
MAX_REASONING_CHARS = 200
TRACK_LAST_N = 20

LLM = Callable[..., Awaitable[str]]


class LeagueError(Exception):
    """Invalid request — HTTP 400."""


class LeagueLimitReached(Exception):
    """A cap was hit — HTTP 429."""


class LeagueForbidden(Exception):
    """Not the owner — HTTP 403."""


# ── Schedule helpers (pure) ──────────────────────────────────────────────────

def slot_after(now: float) -> int:
    """The next half-hour boundary strictly after `now`."""
    return (int(now) // CADENCE_SECONDS + 1) * CADENCE_SECONDS


def asset_for_slot(open_ts: int) -> str:
    return ASSETS[(open_ts // CADENCE_SECONDS) % len(ASSETS)]


def season_of(ts: float) -> str:
    y, w, _ = datetime.fromtimestamp(ts, tz=timezone.utc).isocalendar()
    return f"{y}-W{w:02d}"


def official_window_id(asset: str, open_ts: int) -> str:
    return f"official-{asset}-{open_ts}"


def price_at(candles: list, boundary: int) -> float | None:
    """Close of the candle opened at boundary-30m, once the candle opened at
    boundary exists (so the earlier one is closed). None otherwise."""
    by_open = {int(c[0]) // 1000: float(c[4]) for c in candles or []}
    if boundary in by_open and (boundary - CADENCE_SECONDS) in by_open:
        return by_open[boundary - CADENCE_SECONDS]
    return None


def score_pick(direction: str, confidence: int, move: float, fallback: bool) -> dict:
    """Points for one revealed call. A fallback call is scored but never counted."""
    if fallback:
        return {"points": 0, "correct": None, "counted": False}
    confidence = max(1, min(3, int(confidence)))
    correct = (move > 0) == (direction == "up")
    if correct:
        bonus = min(MAGNITUDE_BONUS_MAX, int(abs(move) * 2000))
        return {"points": POINTS_PER_CONFIDENCE * confidence + bonus, "correct": True, "counted": True}
    return {"points": -WRONG_PENALTY_PER_CONFIDENCE * confidence, "correct": False, "counted": True}


def field_scores(points: dict[str, int]) -> dict[str, float]:
    """Each agent's share of the field it beat (ties count half)."""
    ids = list(points)
    out = {}
    for a in ids:
        others = [b for b in ids if b != a]
        if not others:
            continue
        s = sum(1.0 if points[a] > points[b] else 0.5 if points[a] == points[b] else 0.0 for b in others)
        out[a] = s / len(others)
    return out


def _today_utc(now: float) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(now))


# ── Market access ────────────────────────────────────────────────────────────

class Market:
    """Fresh candles for settlement (never the shared 15-minute cache) and
    spot prices for the pick context. Tests pass a stand-in with the same
    two methods."""

    async def candles(self, asset: str) -> list:
        from services.market_data_service import _coingecko_get

        return await _coingecko_get(f"/coins/{asset}/ohlc", {"vs_currency": "usd", "days": 1}) or []

    async def now(self, assets: list[str]) -> dict[str, dict]:
        from services.market_data_service import _coingecko_get

        raw = await _coingecko_get("/simple/price", {"ids": ",".join(assets), "vs_currencies": "usd", "include_24hr_change": "true"})
        return {a: {"price": float((raw.get(a) or {}).get("usd") or 0),
                    "change_24h": float((raw.get(a) or {}).get("usd_24h_change") or 0)} for a in assets}


_market = Market()


# ── Windows ──────────────────────────────────────────────────────────────────

def _new_window(kind: str, asset: str, open_ts: int, now: float, window_id: str | None = None, owner: str | None = None) -> dict:
    return {
        "window_id": window_id or official_window_id(asset, open_ts),
        "kind": kind, "owner": owner,
        "asset": asset, "symbol": ASSET_SYMBOL.get(asset, asset),
        "horizon_seconds": HORIZON_SECONDS, "open_ts": open_ts, "resolve_ts": open_ts + HORIZON_SECONDS,
        "status": "upcoming", "open_price": None, "close_price": None, "move": None, "void_reason": None,
        "season_id": season_of(open_ts), "participants": [], "created_at": now, "updated_at": now,
    }


async def ensure_official_windows(db, now: float | None = None) -> list[dict]:
    """Make sure the next UPCOMING_WINDOWS official windows exist; returns them."""
    now = now or time.time()
    out = []
    open_ts = slot_after(now)
    for _ in range(UPCOMING_WINDOWS):
        asset = asset_for_slot(open_ts)
        ref = db.collection(WINDOWS_COLLECTION).document(official_window_id(asset, open_ts))
        snap = await ref.get()
        if snap.exists:
            out.append(snap.to_dict() or {})
        else:
            w = _new_window("official", asset, open_ts, now)
            await ref.set(w)
            out.append(w)
        open_ts += CADENCE_SECONDS
    return out


async def _window(db, window_id: str) -> dict:
    snap = await db.collection(WINDOWS_COLLECTION).document(window_id).get()
    if not snap.exists:
        raise LeagueError("Window not found")
    return snap.to_dict() or {}


# ── Owner challenge ──────────────────────────────────────────────────────────

def pick_message(owner: str, agent_id: str, window_id: str | None, opponent_id: str | None, nonce: str, expires_at: float) -> str:
    target = f"Window: {window_id}" if window_id else f"Private window vs: {opponent_id}"
    return (
        "ASAJU Prediction League\n"
        f"Owner: {owner}\n"
        f"Agent: {agent_id}\n"
        f"{target}\n"
        f"Nonce: {nonce}\n"
        f"Expires at: {int(expires_at)}\n"
        "The agent will seal one market call. Nothing is traded, signed on-chain or moved."
    )


async def picks_left_today(db, owner: str, now: float | None = None) -> int:
    now = now or time.time()
    snap = await db.collection(QUOTA_COLLECTION).document(f"{owner.lower()}:{_today_utc(now)}").get()
    used = int((snap.to_dict() or {}).get("used") or 0) if snap.exists else 0
    return max(0, PICKS_PER_OWNER_PER_DAY - used)


async def _consume_quota(db, owner: str, now: float, count: int = 1) -> int:
    ref = db.collection(QUOTA_COLLECTION).document(f"{owner.lower()}:{_today_utc(now)}")
    snap = await ref.get()
    used = int((snap.to_dict() or {}).get("used") or 0) if snap.exists else 0
    if used + count > PICKS_PER_OWNER_PER_DAY:
        raise LeagueLimitReached(f"Daily limit reached ({PICKS_PER_OWNER_PER_DAY} picks per day)")
    await ref.set({"owner": owner.lower(), "day": _today_utc(now), "used": used + count})
    return PICKS_PER_OWNER_PER_DAY - used - count


async def issue_pick_challenge(db, *, owner: str, agent_id: str, window_id: str | None = None,
                               opponent_id: str | None = None, now: float | None = None) -> dict:
    now = now or time.time()
    agent_id = (agent_id or "").strip()
    if not agent_id:
        raise LeagueError("Pick an agent")
    if bool(window_id) == bool(opponent_id):
        raise LeagueError("Give either a window to join or an opponent for a private window")
    if opponent_id and opponent_id.strip() == agent_id:
        raise LeagueError("An agent cannot play itself")
    if window_id:
        w = await _window(db, window_id)
        if w["status"] != "upcoming" or now >= w["open_ts"]:
            raise LeagueError("This window is closed for picks")
    nonce = secrets.token_urlsafe(24)
    expires_at = now + CHALLENGE_TTL_SECONDS
    message = pick_message(owner, agent_id, window_id, opponent_id, nonce, expires_at)
    await db.collection(CHALLENGES_COLLECTION).document(nonce).set({
        "nonce": nonce, "message": message, "owner": owner.lower(), "agent_id": agent_id,
        "window_id": window_id, "opponent_id": (opponent_id or "").strip() or None,
        "expires_at": expires_at, "created_at": now,
    })
    return {"nonce": nonce, "message": message, "expires_at": expires_at, "max_llm_calls": 2 if opponent_id else 1}


async def _agent(db, agent_id: str) -> dict:
    snap = await db.collection(AGENTS_COLLECTION).document(agent_id).get()
    if not snap.exists:
        raise LeagueError(f"Agent {agent_id} not found")
    a = snap.to_dict() or {}
    if a.get("ownership_status") != "bred" and not a.get("funded"):
        raise LeagueError(f"{a.get('agent_name', agent_id)} is not active on-chain yet")
    return a


# ── The AI step: one call per agent per window ──────────────────────────────

def build_pick_prompt(agent: dict, symbol: str, horizon_minutes: int, context: dict, memories: list[dict]) -> str:
    rows = "\n".join(
        f'<memory id="m{i}" title="{_quote(m["title"], 100)}">{_quote(m["text"], 340)}</memory>'
        for i, m in enumerate(memories)
    ) or "(no lessons yet)"
    return (
        f"You are {agent.get('agent_name')}, an ASAJU AI agent (niche: {agent.get('niche')}, personality: "
        f"{agent.get('personality')}, level {int(agent.get('level') or 1)}, {int(agent.get('total_events') or 0)} lessons).\n"
        f"You are entering the ASAJU Prediction League: will {symbol} be HIGHER or LOWER in {horizon_minutes} minutes?\n"
        f"{_GUARD}\n\n"
        f"Market now: {symbol} ${context.get('price', 0):,.4f}, 12h change {context.get('change_12h', 0):+.2f}%, "
        f"last 30-minute steps: {context.get('trend', 'n/a')}, 24h change {context.get('change_24h', 0):+.2f}%.\n"
        f"Your lessons:\n{rows}\n\n"
        "Rules: answer \"up\" or \"down\" (never flat). Confidence 1 (lean), 2 (clear) or 3 (strong) — a right "
        "call earns 10 per confidence point, a wrong call loses the same. One short reason (max 200 chars) "
        "from the numbers or a lesson; cite only lesson ids shown above.\n"
        'Reply with JSON only: {"direction":"up","confidence":2,"reasoning":"...","cited":["m0"]}'
    )


async def _context(market, asset: str) -> dict:
    spot = await market.now([asset])
    ctx = {"price": spot[asset]["price"], "change_24h": spot[asset]["change_24h"], "change_12h": 0.0, "trend": "n/a"}
    try:
        candles = await market.candles(asset)
        if candles:
            c = context_at(candles, len(candles) - 1)
            ctx.update({"change_12h": c["change_12h"], "trend": c["trend"]})
            if not ctx["price"]:
                ctx["price"] = c["price"]
    except Exception as exc:
        logger.debug("league: candle context failed for %s: %s", asset, exc.__class__.__name__)
    return ctx


async def _ai_pick(db, agent_id: str, agent: dict, w: dict, context: dict, llm: LLM) -> dict:
    memories = rank_memories(await load_agent_memories(db, agent_id), f"{w['asset']} {w['symbol']} price trend", MEMORIES_PER_PICK)
    prompt = build_pick_prompt(agent, w["symbol"], HORIZON_SECONDS // 60, context, memories)
    direction, confidence, reasoning, cited, fallback = "", 1, "", [], False
    try:
        raw = await llm(prompt, context=f"league:{w['window_id']}:{agent_id}", max_tokens=220, temperature=0.7)
        parsed = _parse_json(raw, want="direction")
        direction = str(parsed.get("direction") or "").lower()
        confidence = max(1, min(3, int(parsed.get("confidence") or 1)))
        reasoning = " ".join(str(parsed.get("reasoning") or "").split())[:MAX_REASONING_CHARS]
        ids = {f"m{i}" for i in range(len(memories))}
        cited = [memories[int(c[1:])]["title"] for c in parsed.get("cited") or [] if isinstance(c, str) and c in ids]
    except Exception as exc:
        logger.warning("league: pick failed for %s: %s", agent_id, exc.__class__.__name__)
    if direction not in ("up", "down"):
        # Deterministic fallback, flagged: it scores nothing and never counts.
        direction = "up" if float(context.get("change_24h") or 0) >= 0 else "down"
        confidence, reasoning, cited, fallback = 1, "Followed 24h momentum (model unavailable).", [], True
    salt = secrets.token_hex(8)
    return {
        "window_id": w["window_id"], "agent_id": agent_id, "direction": direction, "confidence": confidence,
        "reasoning": reasoning, "cited": cited, "fallback": fallback, "salt": salt,
        "commit": seal(w["window_id"], 0, agent_id, direction, confidence, salt),
        "context": {k: context.get(k) for k in ("price", "change_12h", "change_24h")},
    }


async def submit_pick(db, *, nonce: str, signature: str, owner_of, llm: LLM | None = None,
                      market=None, now: float | None = None) -> dict:
    """Verify the owner's signature and on-chain ownership, then seal the pick
    (or, for a private window, create it and seal both of the owner's agents)."""
    from eth_account import Account
    from eth_account.messages import encode_defunct

    now = now or time.time()
    market = market or _market
    llm = llm or call_room_llm
    ref = db.collection(CHALLENGES_COLLECTION).document(nonce)
    snap = await ref.get()
    if not snap.exists:
        raise LeagueError("Unknown or expired request — start again")
    ch = snap.to_dict() or {}
    if ch.get("used_at"):
        raise LeagueError("This request was already used")
    if float(ch.get("expires_at") or 0) < now:
        raise LeagueError("Request expired — start again")
    try:
        signer = Account.recover_message(encode_defunct(text=ch["message"]), signature=signature)
    except Exception as exc:
        raise LeagueError("Signature could not be verified") from exc
    if signer.lower() != ch["owner"]:
        raise LeagueError("Signature does not match the owner who asked")
    await ref.update({"used_at": now})

    agent_ids = [ch["agent_id"]] + ([ch["opponent_id"]] if ch.get("opponent_id") else [])
    agents = {}
    for aid in agent_ids:
        a = await _agent(db, aid)
        owner_now = (await owner_of(aid, a)) or ""
        if owner_now.lower() != signer.lower():
            raise LeagueForbidden(f"{a.get('agent_name', aid)} is not owned by this wallet")
        agents[aid] = a

    if ch.get("window_id"):
        w = await _window(db, ch["window_id"])
    else:
        open_ts = slot_after(now)
        asset = asset_for_slot(open_ts)
        w = _new_window("private", asset, open_ts, now, window_id=f"private-{secrets.token_urlsafe(8)}", owner=signer.lower())
        await db.collection(WINDOWS_COLLECTION).document(w["window_id"]).set(w)
    if w["status"] != "upcoming" or now >= w["open_ts"]:
        raise LeagueError("This window is closed for picks")
    for aid in agent_ids:
        if aid in w["participants"]:
            raise LeagueError(f"{agents[aid].get('agent_name', aid)} already has a pick in this window")
    if w["kind"] == "official" and len(w["participants"]) + len(agent_ids) > MAX_PARTICIPANTS:
        raise LeagueLimitReached("This window is full")

    left = await _consume_quota(db, signer, now, count=len(agent_ids))
    context = await _context(market, w["asset"])
    first = None
    for aid in agent_ids:
        p = await _ai_pick(db, aid, agents[aid], w, context, llm)
        a = agents[aid]
        p.update({"owner": signer.lower(), "sealed_at": now, "status": "sealed",
                  "name": a.get("agent_name") or aid, "niche": a.get("niche"), "avatar_seed": a.get("avatar_seed")})
        await db.collection(PICKS_COLLECTION).document(f"{w['window_id']}:{aid}").set(p)
        w["participants"].append(aid)
        first = first or p
    w["updated_at"] = now
    await db.collection(WINDOWS_COLLECTION).document(w["window_id"]).set(w)
    return {"window_id": w["window_id"], "agent_id": ch["agent_id"], "commit": first["commit"], "sealed": True,
            "open_ts": w["open_ts"], "resolve_ts": w["resolve_ts"], "picks_left_today": left}


# ── Settlement ───────────────────────────────────────────────────────────────

async def _picks_of(db, window_id: str) -> list[dict]:
    out = []
    async for snap in db.collection(PICKS_COLLECTION).where(filter=FieldFilter("window_id", "==", window_id)).stream():
        out.append(snap.to_dict() or {})
    out.sort(key=lambda p: p.get("sealed_at") or 0)
    return out


async def _void(db, w: dict, reason: str, now: float) -> None:
    w.update({"status": "void", "void_reason": reason, "updated_at": now})
    await db.collection(WINDOWS_COLLECTION).document(w["window_id"]).set(w)
    if w["participants"]:
        for p in await _picks_of(db, w["window_id"]):
            p.update({"status": "void", "points": 0, "correct": None, "counted": False})
            await db.collection(PICKS_COLLECTION).document(f"{w['window_id']}:{p['agent_id']}").set(p)
            await _bump_track(db, p["agent_id"], None, 0, void=True)
            if w["kind"] == "official":
                await _bump_rating(db, p["agent_id"], w["season_id"], None, 0, void=True)


async def _seal_window(db, w: dict, market, now: float) -> None:
    if not w["participants"]:
        await _void(db, w, "no_participants", now)
        return
    candles = await market.candles(w["asset"])
    price = price_at(candles, w["open_ts"])
    if price is None:
        if now - w["open_ts"] > RESOLVE_GRACE_SECONDS:
            await _void(db, w, "price_unavailable", now)
        return
    w.update({"status": "sealed", "open_price": price, "updated_at": now})
    await db.collection(WINDOWS_COLLECTION).document(w["window_id"]).set(w)


async def _resolve_window(db, w: dict, market, now: float) -> None:
    candles = await market.candles(w["asset"])
    close = price_at(candles, w["resolve_ts"])
    if close is None:
        if now - w["resolve_ts"] > RESOLVE_GRACE_SECONDS:
            await _void(db, w, "price_unavailable", now)
        return
    move = move_of(w["open_price"], close)
    if abs(move) < FLAT_EPS:
        w.update({"close_price": close, "move": move})
        await _void(db, w, "flat", now)
        return
    picks = await _picks_of(db, w["window_id"])
    points: dict[str, int] = {}
    for p in picks:
        s = score_pick(p["direction"], p["confidence"], move, bool(p.get("fallback")))
        p.update(s | {"status": "resolved", "resolved_at": now})
        await db.collection(PICKS_COLLECTION).document(f"{w['window_id']}:{p['agent_id']}").set(p)
        if s["counted"]:
            points[p["agent_id"]] = s["points"]
    shares = field_scores(points) if w["kind"] == "official" else {}
    ratings = {}
    if shares:
        docs = {aid: await _rating_doc(db, aid, w["season_id"]) for aid in points}
        mean = sum(int(d.get("rating") or START_RATING) for d in docs.values()) / len(docs)
        for aid, share in shares.items():
            r = int(docs[aid].get("rating") or START_RATING)
            expected = 1 / (1 + 10 ** ((mean - r) / 400))
            ratings[aid] = round(r + ELO_K * (share - expected))
    for p in picks:
        await _bump_track(db, p["agent_id"], p["correct"], p["points"], void=False)
        if w["kind"] == "official":
            await _bump_rating(db, p["agent_id"], w["season_id"], p["correct"], p["points"], void=False,
                               new_rating=ratings.get(p["agent_id"]))
    w.update({"status": "resolved", "close_price": close, "move": move, "resolved_at": now, "updated_at": now})
    await db.collection(WINDOWS_COLLECTION).document(w["window_id"]).set(w)


async def tick(db, market=None, now: float | None = None) -> dict:
    """Scheduler entry (every 5 min): create upcoming windows, lock open prices
    at open_ts, settle at resolve_ts. Safe to repeat; nothing happens early."""
    now = now or time.time()
    market = market or _market
    await ensure_official_windows(db, now)
    sealed = resolved = failed = 0
    for status, handler, field in (("upcoming", _seal_window, "open_ts"), ("sealed", _resolve_window, "resolve_ts")):
        due = []
        async for snap in db.collection(WINDOWS_COLLECTION).where(filter=FieldFilter("status", "==", status)).stream():
            w = snap.to_dict() or {}
            if now >= float(w.get(field) or 0):
                due.append(w)
        for w in due:
            try:
                await handler(db, w, market, now)
                if status == "upcoming":
                    sealed += 1
                else:
                    resolved += 1
            except Exception as exc:
                failed += 1
                logger.warning("league tick: window %s failed: %s", w.get("window_id"), exc.__class__.__name__)
    return {"sealed": sealed, "resolved": resolved, "failed": failed}


# ── Ratings and track record ─────────────────────────────────────────────────

async def _rating_doc(db, agent_id: str, season_id: str) -> dict:
    snap = await db.collection(RATINGS_COLLECTION).document(f"{season_id}:{agent_id}").get()
    return (snap.to_dict() or {}) if snap.exists else {}


def _apply_result(doc: dict, correct: bool | None, points: int, void: bool) -> dict:
    doc = {"matches": 0, "wins": 0, "losses": 0, "points": 0, "voids": 0, "fallbacks": 0, "streak": 0} | dict(doc)
    if void:
        doc["voids"] = int(doc.get("voids") or 0) + 1
        return doc
    if correct is None:  # fallback pick: nothing counts
        doc["fallbacks"] = int(doc.get("fallbacks") or 0) + 1
        return doc
    doc["matches"] = int(doc.get("matches") or 0) + 1
    doc["wins"] = int(doc.get("wins") or 0) + (1 if correct else 0)
    doc["losses"] = int(doc.get("losses") or 0) + (0 if correct else 1)
    doc["points"] = int(doc.get("points") or 0) + int(points)
    streak = int(doc.get("streak") or 0)
    doc["streak"] = (max(streak, 0) + 1) if correct else (min(streak, 0) - 1)
    doc["best_streak"] = max(int(doc.get("best_streak") or 0), doc["streak"])
    doc["accuracy"] = round(doc["wins"] / doc["matches"], 4)
    last = list(doc.get("last") or [])[-(TRACK_LAST_N - 1):]
    doc["last"] = last + [1 if correct else 0]
    return doc


async def _bump_rating(db, agent_id: str, season_id: str, correct: bool | None, points: int, void: bool,
                       new_rating: int | None = None) -> None:
    ref = db.collection(RATINGS_COLLECTION).document(f"{season_id}:{agent_id}")
    doc = _apply_result(await _rating_doc(db, agent_id, season_id), correct, points, void)
    agent = (await db.collection(AGENTS_COLLECTION).document(agent_id).get()).to_dict() or {}
    doc.update({
        "agent_id": agent_id, "season_id": season_id, "name": agent.get("agent_name") or agent_id,
        "niche": agent.get("niche"), "avatar_seed": agent.get("avatar_seed"), "owner": (agent.get("user_wallet") or "").lower(),
        "level": int(agent.get("level") or 1), "rating": new_rating if new_rating is not None else int(doc.get("rating") or START_RATING),
        "updated_at": time.time(),
    })
    doc["peak_rating"] = max(int(doc.get("peak_rating") or START_RATING), doc["rating"])
    await ref.set(doc)


async def _bump_track(db, agent_id: str, correct: bool | None, points: int, void: bool) -> None:
    """Career record per game. Game metrics live here, never raw in skill_scores."""
    ref = db.collection(TRACK_COLLECTION).document(agent_id)
    snap = await ref.get()
    doc = (snap.to_dict() or {}) if snap.exists else {"agent_id": agent_id}
    doc["prediction"] = _apply_result(doc.get("prediction") or {}, correct, points, void)
    doc["updated_at"] = time.time()
    await ref.set(doc)


# ── Reads ────────────────────────────────────────────────────────────────────

def public_pick(p: dict, revealed: bool) -> dict:
    if not revealed:
        return {"agent_id": p["agent_id"], "name": p.get("name"), "niche": p.get("niche"), "avatar_seed": p.get("avatar_seed"),
                "commit": p["commit"], "sealed": True}
    return {k: v for k, v in p.items() if k not in ("owner",)}


async def get_window(db, window_id: str) -> dict:
    w = await _window(db, window_id)
    picks = await _picks_of(db, window_id)
    revealed = w["status"] in ("resolved", "void")
    return w | {"picks": [public_pick(p, revealed) for p in picks]}


async def list_windows(db, status: str | None, limit: int) -> list[dict]:
    rows = []
    q = db.collection(WINDOWS_COLLECTION)
    if status in ("upcoming", "sealed", "resolved", "void"):
        q = q.where(filter=FieldFilter("status", "==", status))
    async for snap in q.limit(max(limit * 5, 50)).stream():
        rows.append(snap.to_dict() or {})
    rows.sort(key=lambda w: w.get("open_ts") or 0, reverse=status in ("resolved", "void", None))
    out = []
    for w in rows[:limit]:
        picks = await _picks_of(db, w["window_id"])
        revealed = w["status"] in ("resolved", "void")
        out.append(w | {"picks": [public_pick(p, revealed) for p in picks]})
    return out


async def standings(db, season_id: str, limit: int = 50) -> list[dict]:
    rows = []
    async for snap in db.collection(RATINGS_COLLECTION).where(filter=FieldFilter("season_id", "==", season_id)).stream():
        d = snap.to_dict() or {}
        if int(d.get("matches") or 0) or int(d.get("voids") or 0):
            rows.append(d)
    rows.sort(key=lambda d: (-int(d.get("rating") or 0), -int(d.get("points") or 0), -(d.get("accuracy") or 0)))
    return rows[:limit]


async def agent_record(db, agent_id: str) -> dict:
    snap = await db.collection(TRACK_COLLECTION).document(agent_id).get()
    rec = ((snap.to_dict() or {}).get("prediction") or {}) if snap.exists else {}
    return {
        "agent_id": agent_id,
        "matches": int(rec.get("matches") or 0), "wins": int(rec.get("wins") or 0), "losses": int(rec.get("losses") or 0),
        "voids": int(rec.get("voids") or 0), "fallbacks": int(rec.get("fallbacks") or 0), "points": int(rec.get("points") or 0),
        "accuracy": rec.get("accuracy") if rec.get("matches") else None,
        "streak": int(rec.get("streak") or 0), "best_streak": int(rec.get("best_streak") or 0), "last": rec.get("last") or [],
    }


async def verify(db, window_id: str) -> dict:
    """Everything needed to recompute a settled window by hand."""
    w = await _window(db, window_id)
    revealed = w["status"] in ("resolved", "void")
    picks = []
    for p in await _picks_of(db, window_id):
        row = {"agent_id": p["agent_id"], "commit": p["commit"]}
        if revealed:
            row.update({"direction": p["direction"], "confidence": p["confidence"], "salt": p["salt"],
                        "seal_ok": seal(window_id, 0, p["agent_id"], p["direction"], p["confidence"], p["salt"]) == p["commit"],
                        "points": p.get("points"), "fallback": p.get("fallback")})
        picks.append(row)
    return {
        "window_id": window_id, "status": w["status"], "asset": w["asset"], "open_ts": w["open_ts"], "resolve_ts": w["resolve_ts"],
        "open_price": w.get("open_price"), "close_price": w.get("close_price"), "move": w.get("move"), "void_reason": w.get("void_reason"),
        "rule": "price at T = close of the 30m candle opened at T-30m; seal = sha256(window|0|agent|direction|confidence|salt)",
        "ok": revealed and all(r.get("seal_ok", True) for r in picks), "picks": picks,
    }


def config() -> dict:
    return {
        "enabled": arena_enabled(),
        "horizon_seconds": HORIZON_SECONDS, "cadence_seconds": CADENCE_SECONDS,
        "assets": [ASSET_SYMBOL[a] for a in ASSETS], "max_participants": MAX_PARTICIPANTS,
        "picks_per_day": PICKS_PER_OWNER_PER_DAY, "points_per_confidence": POINTS_PER_CONFIDENCE,
        "wrong_penalty_per_confidence": WRONG_PENALTY_PER_CONFIDENCE, "magnitude_bonus_max": MAGNITUDE_BONUS_MAX,
        "ai_calls_per_pick": 1, "season_id": season_of(time.time()),
    }
