"""Arena duels: one AI plan per fighter at the start, then an algorithmic
fight settled by real price moves (live) or by the candles after a cutoff
(instant). Also the owner-signed start, sealed calls, ELO and the gates."""
import json

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from httpx import ASGITransport, AsyncClient

from core.rate_limit import reset_state
from services import arena
from tests.conftest import make_agent
from tests.fake_firestore import FakeFirestoreClient

pytestmark = pytest.mark.asyncio


class ScriptedLLM:
    """Replies with queued plans; records each prompt."""

    def __init__(self, *replies):
        self.replies, self.prompts = list(replies), []

    async def __call__(self, prompt, *, context, max_tokens=400, temperature=None, **kw):
        self.prompts.append(prompt)
        reply = self.replies.pop(0) if self.replies else {"strategy": "s", "calls": []}
        if isinstance(reply, Exception):
            raise reply
        return reply if isinstance(reply, str) else json.dumps(reply)


class FakeMarket:
    """Live prices you can move, and a 24h history of 30-minute candles."""

    def __init__(self, price=100.0, steps=None):
        self.prices = {a: price for a in arena.ASSETS}
        self.change = 1.5
        self.steps = steps or [0.01] * 48  # +1% per candle by default

    def set(self, price):
        self.prices = {a: price for a in arena.ASSETS}

    async def now(self, assets):
        return {a: {"price": self.prices[a], "change_24h": self.change} for a in arena.ASSETS}

    async def history(self, assets):
        out = {}
        for a in assets:
            p, rows = 100.0, []
            for i, step in enumerate(self.steps):
                p = p * (1 + step)
                rows.append([1_700_000_000_000 + i * 1_800_000, p, p, p, p])
            out[a] = rows
        return out


def plan(direction, confidence=2, rounds=7, strategy="Ride momentum"):
    dirs = direction if isinstance(direction, list) else [direction] * rounds
    return {"strategy": strategy, "calls": [
        {"round": i + 1, "direction": d, "confidence": confidence, "reasoning": f"going {d}", "cited": ["m0"]}
        for i, d in enumerate(dirs)
    ]}


@pytest.fixture
def owner():
    return Account.create()


@pytest.fixture
def db(owner, monkeypatch, chain_owner_matches_firestore):
    db = FakeFirestoreClient()
    monkeypatch.setattr("routers.arena.get_db", lambda: db)
    monkeypatch.setenv("ARENA_ENABLED", "true")
    for name, level, events in (("Atlas", 5, 10), ("Brisa", 2, 3)):
        wallet = Account.create().address
        doc = make_agent(name, wallet, user_wallet=owner.address, level=level, total_events=events, chain_id=97)
        doc["skill_scores"] = {"Trading/Investment": 6}
        db.seed("agents", name, doc)
        chain_owner_matches_firestore[wallet.lower()] = owner.address
    db.seed("agent_events", "ev1", {"agent_id": "Atlas", "event_title": "BTC funding", "attended_at": 2,
                                    "wisdom_summary": "Extreme funding often precedes a squeeze in bitcoin."})
    return db


async def _open(db, owner, agent="Atlas", opponent="Brisa", llm=None, market=None, signer=None,
                rounds=3, mode="live", horizon="15m", now=1000.0, open_to=True):
    ch = await arena.issue_challenge(db, owner=owner.address, agent_id=agent, opponent_id=opponent,
                                     rounds=rounds, mode=mode, horizon=horizon, open_to_challenges=open_to)
    sig = Account.sign_message(encode_defunct(text=ch["message"]), (signer or owner).key).signature.hex()
    from routers.arena import _owner_of
    return await arena.open_duel(db, nonce=ch["nonce"], signature=sig, owner_of=_owner_of,
                                 llm=llm or ScriptedLLM(), market=market or FakeMarket(), now=now), ch


# ── Rules ────────────────────────────────────────────────────────────────────

async def test_stats_come_from_level_lessons_and_skill():
    s = arena.fighter_stats({"level": 13, "total_events": 24, "skill_scores": {"Other": 4, "Trading": 11}})
    assert s == {"power": 36, "guard": 32, "focus": 30}
    assert arena.fighter_stats({}) == {"power": 12, "guard": 8, "focus": 8}
    assert arena.fighter_stats({"level": 99, "total_events": 999})["power"] == arena.STAT_MAX
    assert arena.style_of("Aggressive") == "striker" and arena.style_of(None) == "tactician"


async def test_outcomes_follow_direction_and_confidence():
    assert arena.outcome("up", 3, 0.01) == {"hit": 30 + 10, "recoil": 0, "result": "hit"}
    assert arena.outcome("down", 3, 0.01) == {"hit": 0, "recoil": 12, "result": "miss"}
    assert arena.outcome("down", 1, 0.01)["recoil"] == 0
    assert arena.outcome("up", 3, 0.00001)["result"] == "flat"


async def test_strike_applies_stats_and_is_deterministic():
    strong = {"agent_id": "a", "style": "striker", "stats": {"power": 40, "guard": 30, "focus": 8}}
    weak = {"agent_id": "b", "style": "tactician", "stats": {"power": 12, "guard": 8, "focus": 8}}
    hit = arena.strike("d1", 1, strong, weak, "up", 2, 0.005)
    assert hit == arena.strike("d1", 1, strong, weak, "up", 2, 0.005)  # same fight for every viewer
    assert hit["result"] == "hit" and hit["move"] in ("slash", "kick", "combo", "blast")
    base = arena.outcome("up", 2, 0.005)["hit"]
    assert hit["hit"] >= round(base * 1.32) or hit["crit"]  # +32% power edge
    soft = arena.strike("d1", 1, weak, strong, "up", 2, 0.005)
    assert soft["hit"] < hit["hit"]
    miss = arena.strike("d1", 1, weak, strong, "down", 3, 0.005)
    assert miss["result"] == "miss" and miss["move"] == "stumble" and miss["recoil"] == round(12 * (1 - 8 / 200))
    assert arena.strike("d1", 1, weak, strong, "up", 1, 0.0)["move"] == "clash"


async def test_elo_is_zero_sum_and_rewards_upsets():
    assert arena.elo_update(1000, 1000, 1.0) == (1016, 984)
    under, fav = arena.elo_update(900, 1100, 1.0)
    assert under - 900 > 16 and under - 900 == 1100 - fav
    assert arena.elo_update(1000, 1000, 1.0, k=16) == (1008, 992)


async def test_candles_are_aligned_by_time_not_position():
    hist = {"bitcoin": [[1, 0, 0, 0, 10.0], [2, 0, 0, 0, 11.0], [3, 0, 0, 0, 12.0]],
            "ethereum": [[2, 0, 0, 0, 5.0], [3, 0, 0, 0, 6.0]]}  # ethereum lags one candle
    common, by_ts = arena.aligned_windows(hist, ["bitcoin", "ethereum"])
    assert common == [2, 3] and by_ts["bitcoin"][2] == 11.0 and by_ts["ethereum"][3] == 6.0


# ── Opening ──────────────────────────────────────────────────────────────────

async def test_live_duel_costs_two_ai_calls_and_seals_round_one(db, owner):
    llm = ScriptedLLM(plan("up", 3), plan("down", 1))
    duel, _ = await _open(db, owner, llm=llm, rounds=5)
    assert len(llm.prompts) == 2 and duel["ai_calls"] == 2
    assert "Extreme funding" in llm.prompts[0] and "POWER" in llm.prompts[0] and "Round 5" in llm.prompts[0]
    assert duel["status"] == "live" and duel["mode"] == "live" and len(duel["rounds"]) == 1
    r = duel["rounds"][0]
    assert r["status"] == "sealed" and r["resolve_at"] == 1000 + 900 and r["open_price"] == 100.0
    assert all(p["sealed"] and "direction" not in p for p in r["picks"])
    assert "plans" not in duel
    assert duel["fighters"][0]["strategy"] == "Ride momentum" and duel["fighters"][0]["stats"]["power"] == 20
    assert duel["duels_left_today"] == arena.DUELS_PER_OWNER_PER_DAY - 1


async def test_live_rounds_use_the_plan_and_never_call_ai_again(db, owner):
    llm = ScriptedLLM(plan("up", 3), plan("down", 2))
    market = FakeMarket(100.0)
    duel, _ = await _open(db, owner, llm=llm, market=market)
    did = duel["duel_id"]
    market.set(101.0)
    assert (await arena.advance_duel(db, did, market, now=1500))["rounds"][0]["status"] == "sealed"
    out = await arena.advance_duel(db, did, market, now=1900)
    r1 = out["rounds"][0]
    assert r1["status"] == "resolved" and abs(r1["move"] - 0.01) < 1e-9
    p0, p1 = r1["picks"]
    assert p0["direction"] == "up" and p0["result"] == "hit" and p0["move"] and "salt" not in p0
    assert p1["result"] == "miss" and p1["move"] == "stumble"
    assert r1["hp_after"][1] == 100 - p0["hit"] - p1["recoil"]
    assert len(out["rounds"]) == 2 and out["rounds"][1]["open_price"] == 101.0
    assert len(llm.prompts) == 2  # no AI after the start


async def test_instant_duel_plays_out_at_once(db, owner):
    llm = ScriptedLLM(plan("up", 3), plan("down", 3))
    duel, _ = await _open(db, owner, llm=llm, mode="instant", rounds=5)
    assert duel["status"] == "finished" and duel["mode"] == "instant" and duel["horizon"] == "30m"
    assert duel["winner"] == "Atlas" and duel["result"] == "ko"
    assert all(r["status"] == "resolved" for r in duel["rounds"])
    assert duel["rounds"][0]["resolve_at"] - duel["rounds"][0]["opened_at"] == 1800
    # Planned on data up to the cutoff only: the prompt never sees later candles.
    assert "12h" in llm.prompts[0]
    board = {b["agent_id"]: b for b in await arena.leaderboard(db)}
    assert board["Atlas"]["rating"] == 1008 and board["Atlas"]["kos"] == 1  # instant uses K=16


async def test_instant_needs_enough_history(db, owner):
    with pytest.raises(arena.ArenaError, match="Not enough"):
        await _open(db, owner, mode="instant", market=FakeMarket(steps=[0.01] * 5))


async def test_signature_must_come_from_the_owner_and_works_once(db, owner):
    with pytest.raises(arena.ArenaError, match="does not match"):
        await _open(db, owner, signer=Account.create())
    _, ch = await _open(db, owner)
    sig = Account.sign_message(encode_defunct(text=ch["message"]), owner.key).signature.hex()
    from routers.arena import _owner_of
    with pytest.raises(arena.ArenaError, match="already used"):
        await arena.open_duel(db, nonce=ch["nonce"], signature=sig, owner_of=_owner_of, llm=ScriptedLLM(), market=FakeMarket())


async def test_challenger_sold_on_chain_cannot_fight(db, owner, chain_owner_matches_firestore):
    wallet = db.collection("agents")._docs["Atlas"]["agent_wallet"]
    chain_owner_matches_firestore[wallet.lower()] = Account.create().address
    with pytest.raises(arena.ArenaForbidden, match="not owned"):
        await _open(db, owner)


async def test_other_owners_agent_needs_open_flag(db, owner, chain_owner_matches_firestore):
    other = Account.create()
    wallet = Account.create().address
    db.seed("agents", "Cori", make_agent("Cori", wallet, user_wallet=other.address, chain_id=97))
    chain_owner_matches_firestore[wallet.lower()] = other.address
    with pytest.raises(arena.ArenaForbidden, match="not open"):
        await _open(db, owner, opponent="Cori")
    db.seed("arena_ratings", "Cori", {"agent_id": "Cori", "rating": 1000, "open_to_challenges": True})
    duel, _ = await _open(db, owner, opponent="Cori")
    assert duel["fighters"][1]["owner"] == other.address.lower()


async def test_request_validation_and_pending_spawn(db, owner):
    with pytest.raises(arena.ArenaError, match="itself"):
        arena.validate_duel_request("Atlas", "Atlas", 3, "live", "15m")
    with pytest.raises(arena.ArenaError, match="window"):
        arena.validate_duel_request("Atlas", "Brisa", 3, "live", "4h")
    assert arena.validate_duel_request("Atlas", "Brisa", 3, "instant", "anything")[4] == "30m"
    db.collection("agents")._docs["Brisa"]["funded"] = False
    with pytest.raises(arena.ArenaError, match="not active"):
        await _open(db, owner)


async def test_daily_quota_holds(db, owner, monkeypatch):
    monkeypatch.setattr(arena, "DUELS_PER_OWNER_PER_DAY", 1)
    await _open(db, owner)
    with pytest.raises(arena.ArenaLimitReached):
        await _open(db, owner)


# ── Resolution ───────────────────────────────────────────────────────────────

async def test_knockout_finishes_the_live_duel_and_settles_elo(db, owner):
    llm = ScriptedLLM(plan("up", 3), plan("down", 3))
    market = FakeMarket(100.0)
    duel, _ = await _open(db, owner, llm=llm, market=market, rounds=7)
    did, now, price = duel["duel_id"], 1000, 100.0
    out = duel
    while out["status"] == "live":
        price *= 1.02
        market.set(price)
        now += 1000
        out = await arena.advance_duel(db, did, market, now=now)
    assert out["result"] == "ko" and out["winner"] == "Atlas"
    assert out["fighters"][0]["rating_after"] == 1016 and out["fighters"][1]["rating_after"] == 984
    board = await arena.leaderboard(db)
    assert [b["agent_id"] for b in board] == ["Atlas", "Brisa"] and board[0]["streak"] == 1
    assert (await arena.advance_duel(db, did, market, now=99999))["status"] == "finished"


async def test_draw_when_both_land_the_same(db, owner):
    llm = ScriptedLLM(plan("up", 1), plan("up", 1))
    db.collection("agents")._docs["Brisa"].update({"level": 5, "total_events": 10})
    duel, _ = await _open(db, owner, llm=llm, mode="instant", rounds=3,
                          market=FakeMarket(steps=[0.00001] * 48))  # flat market: nobody lands
    assert duel["result"] == "draw" and duel["winner"] is None


async def test_model_failure_falls_back_to_momentum_and_says_so(db, owner):
    llm = ScriptedLLM(RuntimeError("down"), "not json at all")
    market = FakeMarket(100.0)
    market.change = -3.0
    duel, _ = await _open(db, owner, llm=llm, market=market)
    market.set(99.0)
    out = await arena.advance_duel(db, duel["duel_id"], market, now=2000)
    assert all(p["fallback"] and p["direction"] == "down" and p["confidence"] == 1 for p in out["rounds"][0]["picks"])


async def test_resolution_lock_stops_a_double_settle(db, owner):
    duel, _ = await _open(db, owner)
    await db.collection("arena_duels").document(duel["duel_id"]).update({"lock_until": 5000})
    out = await arena.advance_duel(db, duel["duel_id"], FakeMarket(101.0), now=2000)
    assert out["rounds"][0]["status"] == "sealed"


async def test_tick_advances_only_due_duels(db, owner):
    market = FakeMarket(100.0)
    d1, _ = await _open(db, owner, market=market, now=1000)
    d2, _ = await _open(db, owner, agent="Brisa", opponent="Atlas", market=market, now=1800)
    market.set(101.0)
    assert await arena.tick(db, market, now=2000) == {"live_due": 1, "advanced": 1, "failed": 0}
    assert (await arena.get_duel(db, d1["duel_id"]))["rounds"][0]["status"] == "resolved"
    assert (await arena.get_duel(db, d2["duel_id"]))["rounds"][0]["status"] == "sealed"


# ── HTTP gates ───────────────────────────────────────────────────────────────

@pytest.fixture
async def client(db):
    reset_state()
    from main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    reset_state()


async def test_arena_is_hidden_until_enabled(client, monkeypatch):
    monkeypatch.setenv("ARENA_ENABLED", "")
    cfg = (await client.get("/api/v1/arena/config")).json()
    assert cfg["enabled"] is False and cfg["ai_calls_per_duel"] == 2
    assert (await client.get("/api/v1/arena/duels")).status_code == 404
    monkeypatch.setenv("ARENA_ENABLED", "true")
    assert (await client.get("/api/v1/arena/duels")).json() == {"duels": []}


async def test_spectators_never_see_plans_or_sealed_calls(client, db, owner):
    duel, _ = await _open(db, owner, llm=ScriptedLLM(plan("up"), plan("down")))
    res = (await client.get(f"/api/v1/arena/duels/{duel['duel_id']}")).json()
    assert "plans" not in res and all(p["sealed"] for p in res["rounds"][0]["picks"])
    listed = (await client.get("/api/v1/arena/duels?status=live")).json()["duels"]
    assert listed[0]["duel_id"] == duel["duel_id"] and "picks" not in listed[0]["rounds"][0] and "plans" not in listed[0]
    assert (await client.post("/api/v1/arena/tick")).status_code == 401


async def test_challenge_endpoint_validates_and_rate_limits(client, owner):
    body = {"owner": owner.address, "agent_id": "Atlas", "opponent_id": "Atlas"}
    assert (await client.post("/api/v1/arena/challenge", json=body)).status_code == 400
    body.update(opponent_id="Brisa", mode="instant")
    res = await client.post("/api/v1/arena/challenge", json=body)
    assert res.status_code == 200 and "Mode: instant" in res.json()["message"] and res.json()["max_llm_calls"] == 2
    for _ in range(8):
        assert (await client.post("/api/v1/arena/challenge", json=body)).status_code == 200
    assert (await client.post("/api/v1/arena/challenge", json=body)).status_code == 429
