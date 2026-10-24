"""
Arena — Agent Duel: two agents fight 1v1 by calling the market.

Each round both agents seal a prediction (up/down) on one asset for a fixed
horizon, from their own lessons and a live market snapshot. When the horizon
passes the real move decides it: a right call hits the opponent, a wrong
call at high confidence recoils. First to 0 HP is knocked out; otherwise the
higher HP wins when the rounds run out. Ratings are ELO.

Safety model (same as Agent Room)
---------------------------------
- A duel only produces text and a rating. Nothing is signed, traded or moved.
- Starting a duel needs the owner's signature and on-chain ownership of the
  challenger; the opponent is the owner's own agent, or one whose owner
  marked it open to challenges. Memory text is quoted as data to the model.
- Picks are sealed (hash shown, pick hidden) until the round resolves, so a
  spectator cannot copy or front-run a live pick.

Cost: two LLM calls per round, so a duel costs at most ``2 * rounds`` calls.
Caps: duels per owner per day, live duels at once, rounds per duel.
"""
from __future__ import annotations

import hashlib
import json
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
HORIZONS = {"15m": 15 * 60, "1h": 3600, "4h": 4 * 3600}
DEFAULT_HORIZON = "15m"
# CoinGecko ids; one asset per round, rotating from a per-duel offset.
ASSETS = ["bitcoin", "ethereum", "solana", "binancecoin", "mantle"]
ASSET_SYMBOL = {"bitcoin": "BTC", "ethereum": "ETH", "solana": "SOL", "binancecoin": "BNB", "mantle": "MNT"}
# Damage by confidence (1..3) for a right call; recoil for a wrong one.
HIT = {1: 14, 2: 22, 3: 30}
RECOIL = {1: 0, 2: 6, 3: 12}
MAGNITUDE_BONUS_MAX = 10
FLAT_EPS = 0.0002  # |move| under 0.02% is "no move": nobody lands
ELO_K = 32
START_RATING = 1000
CHALLENGE_TTL_SECONDS = 10 * 60
DUELS_PER_OWNER_PER_DAY = int(os.environ.get("ARENA_DUELS_PER_DAY", 6))
MAX_LIVE_DUELS = int(os.environ.get("ARENA_MAX_LIVE", 20))
MEMORIES_PER_PICK = 4
MAX_REASONING_CHARS = 240
# A tick holds a duel for this long so two callers cannot resolve it twice.
RESOLVE_LOCK_SECONDS = 45

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

def asset_for_round(seed: str, round_no: int) -> str:
    offset = int(hashlib.sha256(seed.encode()).hexdigest(), 16) % len(ASSETS)
    return ASSETS[(offset + round_no - 1) % len(ASSETS)]


def move_of(open_price: float, close_price: float) -> float:
    return 0.0 if not open_price else (close_price - open_price) / open_price


def outcome(direction: str, confidence: int, move: float) -> dict:
    """What one pick does once the move is known."""
    confidence = max(1, min(3, int(confidence)))
    if abs(move) < FLAT_EPS:
        return {"hit": 0, "recoil": 0, "result": "flat"}
    correct = (move > 0) == (direction == "up")
    if correct:
        bonus = min(MAGNITUDE_BONUS_MAX, int(abs(move) * 2000))  # +1 per 0.05%
        return {"hit": HIT[confidence] + bonus, "recoil": 0, "result": "hit"}
    return {"hit": 0, "recoil": RECOIL[confidence], "result": "miss"}


def elo_update(rating_a: float, rating_b: float, score_a: float, k: int = ELO_K) -> tuple[int, int]:
    expected_a = 1 / (1 + 10 ** ((rating_b - rating_a) / 400))
    delta = round(k * (score_a - expected_a))
    return int(rating_a + delta), int(rating_b - delta)


def seal(duel_id: str, round_no: int, agent_id: str, direction: str, confidence: int, salt: str) -> str:
    return hashlib.sha256(f"{duel_id}|{round_no}|{agent_id}|{direction}|{confidence}|{salt}".encode()).hexdigest()


def _today_utc() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


# ── Owner challenge ──────────────────────────────────────────────────────────

def duel_message(owner: str, agent_id: str, opponent_id: str, rounds: int, horizon: str,
                 open_to_challenges: bool, nonce: str, expires_at: float) -> str:
    return (
        "ASAJU Arena Duel\n"
        f"Owner: {owner}\n"
        f"Challenger: {agent_id}\n"
        f"Opponent: {opponent_id}\n"
        f"Rounds: {rounds}\n"
        f"Horizon: {horizon}\n"
        f"Open to challenges: {'yes' if open_to_challenges else 'no'}\n"
        f"Nonce: {nonce}\n"
        f"Expires at: {int(expires_at)}\n"
        "A duel is a prediction game between agents. It cannot trade, sign or move funds."
    )


def validate_duel_request(agent_id: str, opponent_id: str, rounds: int, horizon: str) -> tuple[str, str, int, str]:
    agent_id, opponent_id = (agent_id or "").strip(), (opponent_id or "").strip()
    if not agent_id or not opponent_id:
        raise ArenaError("Pick a challenger and an opponent")
    if agent_id == opponent_id:
        raise ArenaError("An agent cannot duel itself")
    if not MIN_ROUNDS <= int(rounds) <= MAX_ROUNDS:
        raise ArenaError(f"Rounds must be between {MIN_ROUNDS} and {MAX_ROUNDS}")
    if horizon not in HORIZONS:
        raise ArenaError("Unknown horizon")
    return agent_id, opponent_id, int(rounds), horizon


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
                          horizon: str, open_to_challenges: bool) -> dict:
    agent_id, opponent_id, rounds, horizon = validate_duel_request(agent_id, opponent_id, rounds, horizon)
    nonce = secrets.token_urlsafe(24)
    expires_at = time.time() + CHALLENGE_TTL_SECONDS
    message = duel_message(owner, agent_id, opponent_id, rounds, horizon, open_to_challenges, nonce, expires_at)
    await db.collection(CHALLENGES_COLLECTION).document(nonce).set({
        "nonce": nonce, "message": message, "owner": owner.lower(), "agent_id": agent_id,
        "opponent_id": opponent_id, "rounds": rounds, "horizon": horizon,
        "open_to_challenges": bool(open_to_challenges), "expires_at": expires_at, "created_at": time.time(),
    })
    return {"nonce": nonce, "message": message, "expires_at": expires_at, "max_llm_calls": 2 * rounds}


async def _fighter(db, agent_id: str) -> tuple[dict, dict]:
    snap = await db.collection(AGENTS_COLLECTION).document(agent_id).get()
    if not snap.exists:
        raise ArenaError(f"Agent {agent_id} not found")
    a = snap.to_dict() or {}
    if a.get("ownership_status") != "bred" and not a.get("funded"):
        raise ArenaError(f"{a.get('agent_name', agent_id)} is not active on-chain yet")
    return a, {
        "agent_id": agent_id,
        "name": a.get("agent_name") or agent_id,
        "niche": a.get("niche") or "General",
        "personality": a.get("personality") or "Analytical",
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


async def open_duel(db, *, nonce: str, signature: str, owner_of, llm: LLM | None = None,
                    market=None, now: float | None = None) -> dict:
    """Verify the owner's signature, check ownership now, create the duel and
    seal round 1."""
    from eth_account import Account
    from eth_account.messages import encode_defunct

    now = now or time.time()
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
        b_rating = await _rating_doc(db, ch["opponent_id"])
        if not b_rating.get("open_to_challenges"):
            raise ArenaForbidden(f"{b['name']} is not open to challenges")

    live = await _count_live(db)
    if live >= MAX_LIVE_DUELS:
        raise ArenaLimitReached("The arena is full right now — try again in a few minutes")
    left = await _consume_quota(db, signer)

    for f in (a, b):
        f["rating"] = int((await _rating_doc(db, f["agent_id"])).get("rating") or START_RATING)
    await _upsert_rating(db, a, open_to_challenges=bool(ch.get("open_to_challenges")))
    await _upsert_rating(db, b)

    duel_id = secrets.token_urlsafe(12)
    duel = {
        "duel_id": duel_id,
        "status": "live",
        "owner": signer.lower(),
        "rounds_total": int(ch["rounds"]),
        "horizon": ch["horizon"],
        "horizon_seconds": HORIZONS[ch["horizon"]],
        "fighters": [a, b],
        "rounds": [],
        "winner": None,
        "result": None,
        "created_at": now,
        "updated_at": now,
        "lock_until": 0,
    }
    await _start_round(db, duel, llm or call_room_llm, market, now)
    await db.collection(DUELS_COLLECTION).document(duel_id).set(duel)
    return public_duel(duel) | {"duels_left_today": left}


async def _count_live(db) -> int:
    n = 0
    async for _ in db.collection(DUELS_COLLECTION).where(filter=FieldFilter("status", "==", "live")).stream():
        n += 1
    return n


async def _upsert_rating(db, f: dict, open_to_challenges: bool | None = None) -> None:
    ref = db.collection(RATINGS_COLLECTION).document(f["agent_id"])
    current = await _rating_doc(db, f["agent_id"])
    doc = {
        "agent_id": f["agent_id"], "name": f["name"], "niche": f["niche"], "avatar_seed": f.get("avatar_seed"),
        "owner": f["owner"], "chain_id": f["chain_id"], "level": f["level"],
        "rating": int(current.get("rating") or START_RATING),
        "wins": int(current.get("wins") or 0), "losses": int(current.get("losses") or 0),
        "draws": int(current.get("draws") or 0), "kos": int(current.get("kos") or 0),
        "streak": int(current.get("streak") or 0),
        "open_to_challenges": bool(current.get("open_to_challenges")) if open_to_challenges is None else open_to_challenges,
        "updated_at": time.time(),
    }
    await ref.set(doc)


# ── Picks ────────────────────────────────────────────────────────────────────

async def _market_for(asset: str, market=None) -> dict:
    from services.market_data_service import get_fear_greed_index, get_prices

    if market is not None:
        return await market(asset)
    prices = await get_prices([asset])
    row = (prices or {}).get(asset) or {}
    fg = await get_fear_greed_index()
    return {
        "price": float(row.get("usd") or 0),
        "change_24h": float(row.get("usd_24h_change") or 0),
        "fear_greed": (fg or {}).get("value"),
        "fear_greed_label": (fg or {}).get("value_classification"),
    }


def build_pick_prompt(fighter: dict, opponent: dict, asset: str, horizon: str, market: dict,
                      memories: list[dict], round_no: int, rounds_total: int) -> str:
    rows = "\n".join(
        f'<memory id="m{i}" title="{_quote(m["title"], 100)}">{_quote(m["text"], 360)}</memory>'
        for i, m in enumerate(memories)
    ) or "(no lessons yet)"
    fg = f"{market.get('fear_greed')} ({market.get('fear_greed_label')})" if market.get("fear_greed") is not None else "unknown"
    return (
        f"You are {fighter['name']}, an ASAJU AI agent (niche: {fighter['niche']}, personality: "
        f"{fighter['personality']}, level {fighter['level']}) in an Arena duel against {opponent['name']}. "
        f"Round {round_no} of {rounds_total}. Your HP {fighter['hp']}, theirs {opponent['hp']}.\n"
        f"{_GUARD}\n\n"
        f"Market now: {ASSET_SYMBOL.get(asset, asset)} ${market.get('price', 0):,.4f}, "
        f"24h change {market.get('change_24h', 0):+.2f}%, Fear & Greed {fg}.\n"
        f"Your lessons:\n{rows}\n\n"
        f"Call where {ASSET_SYMBOL.get(asset, asset)} will be in {horizon}: \"up\" or \"down\". "
        "Confidence 1 (lean), 2 (clear) or 3 (strong) — a right call hits harder with confidence, "
        "a wrong call at 2–3 hurts you. Reason in one or two short sentences from your lessons and "
        "the market numbers; cite lesson ids you used.\n"
        'Reply with JSON only: {"direction":"up","confidence":2,"reasoning":"...","cited":["m0"]}'
    )


async def _pick(db, duel: dict, fighter: dict, opponent: dict, round_no: int, asset: str,
                market: dict, llm: LLM) -> dict:
    memories = rank_memories(await load_agent_memories(db, fighter["agent_id"]),
                             f"{asset} {ASSET_SYMBOL.get(asset, '')} price trend", MEMORIES_PER_PICK)
    prompt = build_pick_prompt(fighter, opponent, asset, duel["horizon"], market, memories,
                               round_no, duel["rounds_total"])
    direction, confidence, reasoning, cited, fallback = "", 1, "", [], False
    try:
        raw = await llm(prompt, context=f"arena:{duel['duel_id']}:r{round_no}:{fighter['agent_id']}",
                        max_tokens=260, temperature=0.7)
        parsed = _parse_json(raw, want="direction")
        direction = str(parsed.get("direction") or "").lower()
        confidence = max(1, min(3, int(parsed.get("confidence") or 1)))
        reasoning = " ".join(str(parsed.get("reasoning") or "").split())[:MAX_REASONING_CHARS]
        ids = {f"m{i}" for i in range(len(memories))}
        cited = [c for c in parsed.get("cited") or [] if isinstance(c, str) and c in ids]
    except Exception as exc:
        logger.warning("arena pick failed for %s: %s", fighter["agent_id"], exc.__class__.__name__)
    if direction not in ("up", "down"):
        # Momentum fallback, marked so the UI never passes it off as reasoning.
        direction = "up" if float(market.get("change_24h") or 0) >= 0 else "down"
        confidence, reasoning, cited, fallback = 1, "Went with 24h momentum (model unavailable).", [], True
    salt = secrets.token_hex(8)
    return {
        "agent_id": fighter["agent_id"], "direction": direction, "confidence": confidence,
        "reasoning": reasoning, "cited": [memories[int(c[1:])]["title"] for c in cited],
        "fallback": fallback, "salt": salt,
        "commit": seal(duel["duel_id"], round_no, fighter["agent_id"], direction, confidence, salt),
    }


async def _start_round(db, duel: dict, llm: LLM, market, now: float) -> None:
    round_no = len(duel["rounds"]) + 1
    asset = asset_for_round(duel["duel_id"], round_no)
    snapshot = await _market_for(asset, market)
    if not snapshot.get("price"):
        raise ArenaError("Market price is unavailable right now — try again shortly")
    a, b = duel["fighters"]
    picks = [await _pick(db, duel, a, b, round_no, asset, snapshot, llm),
             await _pick(db, duel, b, a, round_no, asset, snapshot, llm)]
    duel["rounds"].append({
        "round": round_no, "asset": asset, "symbol": ASSET_SYMBOL.get(asset, asset),
        "open_price": snapshot["price"], "opened_at": now,
        "resolve_at": now + duel["horizon_seconds"], "status": "sealed",
        "market": snapshot, "picks": picks,
    })
    duel["updated_at"] = now


# ── Resolution ───────────────────────────────────────────────────────────────

def resolve_round(duel: dict, rnd: dict, close_price: float, now: float) -> None:
    """Apply the move to both fighters. Pure: no I/O."""
    move = move_of(rnd["open_price"], close_price)
    a, b = duel["fighters"]
    for pick, me, them in ((rnd["picks"][0], a, b), (rnd["picks"][1], b, a)):
        o = outcome(pick["direction"], pick["confidence"], move)
        pick.update(o)
        them["hp"] = max(0, them["hp"] - o["hit"])
        me["hp"] = max(0, me["hp"] - o["recoil"])
    rnd.update({"close_price": close_price, "move": move, "status": "resolved", "resolved_at": now,
                "hp_after": [a["hp"], b["hp"]]})


def _finish_if_over(duel: dict, now: float) -> bool:
    a, b = duel["fighters"]
    ko = a["hp"] <= 0 or b["hp"] <= 0
    over = ko or len(duel["rounds"]) >= duel["rounds_total"]
    if not over:
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
    new_a, new_b = elo_update(int(ra.get("rating") or START_RATING), int(rb.get("rating") or START_RATING), score_a)
    for f, doc, new, score in ((a, ra, new_a, score_a), (b, rb, new_b, 1 - score_a)):
        f["rating_before"], f["rating_after"] = int(doc.get("rating") or START_RATING), new
        won, lost = score == 1.0, score == 0.0
        streak = int(doc.get("streak") or 0)
        doc.update({
            "agent_id": f["agent_id"], "name": f["name"], "niche": f["niche"], "avatar_seed": f.get("avatar_seed"),
            "owner": f["owner"], "chain_id": f["chain_id"], "level": f["level"], "rating": new,
            "wins": int(doc.get("wins") or 0) + won, "losses": int(doc.get("losses") or 0) + lost,
            "draws": int(doc.get("draws") or 0) + (score == 0.5),
            "kos": int(doc.get("kos") or 0) + (won and duel["result"] == "ko"),
            "streak": (max(streak, 0) + 1) if won else ((min(streak, 0) - 1) if lost else 0),
            "open_to_challenges": bool(doc.get("open_to_challenges")),
            "last_duel_id": duel["duel_id"], "updated_at": time.time(),
        })
        await db.collection(RATINGS_COLLECTION).document(f["agent_id"]).set(doc)


async def advance_duel(db, duel_id: str, llm: LLM | None = None, market=None, now: float | None = None) -> dict:
    """Resolve the current round if its horizon has passed, then seal the next
    one (or finish). Safe to call any time: nothing happens before the horizon."""
    now = now or time.time()
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
        snapshot = await _market_for(rnd["asset"], market)
        if not snapshot.get("price"):
            raise ArenaError("Market price is unavailable")
        resolve_round(duel, rnd, snapshot["price"], now)
        if _finish_if_over(duel, now):
            await _settle_ratings(db, duel)
        else:
            await _start_round(db, duel, llm or call_room_llm, market, now)
    except Exception:
        await ref.update({"lock_until": 0})
        raise
    duel["lock_until"] = 0
    await ref.set(duel)
    return public_duel(duel)


async def tick(db, llm: LLM | None = None, market=None, now: float | None = None) -> dict:
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
            await advance_duel(db, duel_id, llm, market, now)
            advanced += 1
        except Exception as exc:
            failed += 1
            logger.warning("arena tick: duel %s failed: %s", duel_id, exc.__class__.__name__)
    return {"live_due": len(due), "advanced": advanced, "failed": failed}


# ── Reads ────────────────────────────────────────────────────────────────────

def public_duel(duel: dict) -> dict:
    """The duel as spectators see it: sealed picks show only their commit."""
    out = {k: v for k, v in duel.items() if k != "lock_until"}
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
        # Lists stay light: picks and markets live on the duel page.
        d["rounds"] = [{k: v for k, v in r.items() if k not in ("picks", "market")} for r in d["rounds"]]
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
        "start_hp": START_HP,
        "min_rounds": MIN_ROUNDS, "max_rounds": MAX_ROUNDS, "default_rounds": DEFAULT_ROUNDS,
        "horizons": list(HORIZONS), "default_horizon": DEFAULT_HORIZON,
        "assets": [ASSET_SYMBOL[a] for a in ASSETS],
        "hit": HIT, "recoil": RECOIL, "duels_per_day": DUELS_PER_OWNER_PER_DAY,
    }
