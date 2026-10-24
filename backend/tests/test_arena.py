"""Arena duels: owner-signed start, sealed picks, market-settled rounds,
KO/decision, ELO, and the public/scheduler gates."""
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
    def __init__(self, *replies):
        self.replies, self.prompts = list(replies), []

    async def __call__(self, prompt, *, context, max_tokens=260, temperature=None, **kw):
        self.prompts.append(prompt)
        reply = self.replies.pop(0) if self.replies else {"direction": "up", "confidence": 1, "reasoning": "r", "cited": []}
        if isinstance(reply, Exception):
            raise reply
        return reply if isinstance(reply, str) else json.dumps(reply)


class Market:
    def __init__(self, price=100.0):
        self.price, self.change = price, 1.5

    async def __call__(self, asset):
        return {"price": self.price, "change_24h": self.change, "fear_greed": 55, "fear_greed_label": "Greed"}


@pytest.fixture
def owner():
    return Account.create()


@pytest.fixture
def db(owner, monkeypatch, chain_owner_matches_firestore):
    db = FakeFirestoreClient()
    monkeypatch.setattr("routers.arena.get_db", lambda: db)
    monkeypatch.setenv("ARENA_ENABLED", "true")
    for name, level in (("Atlas", 5), ("Brisa", 2)):
        wallet = Account.create().address
        db.seed("agents", name, make_agent(name, wallet, user_wallet=owner.address, level=level, chain_id=97))
        chain_owner_matches_firestore[wallet.lower()] = owner.address
    db.seed("agent_events", "ev1", {"agent_id": "Atlas", "event_title": "BTC funding", "attended_at": 2,
                                    "wisdom_summary": "Extreme funding often precedes a squeeze in bitcoin."})
    return db


def _pick(direction, confidence=2, cited=None):
    return {"direction": direction, "confidence": confidence, "reasoning": f"going {direction}", "cited": cited or []}


async def _open(db, owner, agent="Atlas", opponent="Brisa", llm=None, market=None, signer=None, rounds=3, now=1000.0, open_to=True):
    ch = await arena.issue_challenge(db, owner=owner.address, agent_id=agent, opponent_id=opponent,
                                     rounds=rounds, horizon="15m", open_to_challenges=open_to)
    sig = Account.sign_message(encode_defunct(text=ch["message"]), (signer or owner).key).signature.hex()
    from routers.arena import _owner_of
    return await arena.open_duel(db, nonce=ch["nonce"], signature=sig, owner_of=_owner_of,
                                 llm=llm or ScriptedLLM(), market=market or Market(), now=now), ch


# ── Rules ────────────────────────────────────────────────────────────────────

async def test_outcomes_follow_direction_and_confidence():
    assert arena.outcome("up", 3, 0.01) == {"hit": 30 + 10, "recoil": 0, "result": "hit"}
    assert arena.outcome("up", 1, 0.001) == {"hit": 14 + 2, "recoil": 0, "result": "hit"}
    assert arena.outcome("down", 3, 0.01) == {"hit": 0, "recoil": 12, "result": "miss"}
    assert arena.outcome("down", 1, 0.01)["recoil"] == 0
    assert arena.outcome("up", 3, 0.00001)["result"] == "flat"


async def test_elo_is_zero_sum_and_rewards_upsets():
    a, b = arena.elo_update(1000, 1000, 1.0)
    assert (a, b) == (1016, 984)
    under, fav = arena.elo_update(900, 1100, 1.0)
    assert under - 900 > 16 and under - 900 == 1100 - fav


async def test_assets_rotate_per_duel():
    seq = [arena.asset_for_round("d1", r) for r in range(1, 6)]
    assert sorted(seq) == sorted(arena.ASSETS)


# ── Opening ──────────────────────────────────────────────────────────────────

async def test_owner_opens_a_duel_with_sealed_round_one(db, owner):
    llm = ScriptedLLM(_pick("up", 3, ["m0"]), _pick("down", 1))
    duel, _ = await _open(db, owner, llm=llm)
    assert duel["status"] == "live" and len(duel["rounds"]) == 1
    r = duel["rounds"][0]
    assert r["status"] == "sealed" and r["resolve_at"] == 1000 + 900 and r["open_price"] == 100.0
    assert all(p["sealed"] and "direction" not in p and len(p["commit"]) == 64 for p in r["picks"])
    assert [f["hp"] for f in duel["fighters"]] == [100, 100]
    assert duel["duels_left_today"] == arena.DUELS_PER_OWNER_PER_DAY - 1
    assert len(llm.prompts) == 2 and "Extreme funding" in llm.prompts[0] and "<memory" in llm.prompts[0]
    rating = (await db.collection("arena_ratings").document("Atlas").get()).to_dict()
    assert rating["open_to_challenges"] is True and rating["rating"] == 1000


async def test_signature_must_come_from_the_owner_and_works_once(db, owner):
    with pytest.raises(arena.ArenaError, match="does not match"):
        await _open(db, owner, signer=Account.create())
    _, ch = await _open(db, owner)
    sig = Account.sign_message(encode_defunct(text=ch["message"]), owner.key).signature.hex()
    from routers.arena import _owner_of
    with pytest.raises(arena.ArenaError, match="already used"):
        await arena.open_duel(db, nonce=ch["nonce"], signature=sig, owner_of=_owner_of, llm=ScriptedLLM(), market=Market())


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


async def test_pending_spawn_and_self_duel_are_refused(db, owner):
    with pytest.raises(arena.ArenaError, match="itself"):
        arena.validate_duel_request("Atlas", "Atlas", 3, "15m")
    db.collection("agents")._docs["Brisa"]["funded"] = False
    with pytest.raises(arena.ArenaError, match="not active"):
        await _open(db, owner)


async def test_daily_quota_holds(db, owner, monkeypatch):
    monkeypatch.setattr(arena, "DUELS_PER_OWNER_PER_DAY", 1)
    await _open(db, owner)
    with pytest.raises(arena.ArenaLimitReached):
        await _open(db, owner)


# ── Rounds ───────────────────────────────────────────────────────────────────

async def test_round_resolves_only_after_the_horizon(db, owner):
    llm = ScriptedLLM(_pick("up", 3), _pick("down", 2), _pick("up"), _pick("up"))
    market = Market(100.0)
    duel, _ = await _open(db, owner, llm=llm, market=market)
    did = duel["duel_id"]
    market.price = 101.0  # +1%
    same = await arena.advance_duel(db, did, llm, market, now=1500)
    assert same["rounds"][0]["status"] == "sealed" and len(llm.prompts) == 2

    out = await arena.advance_duel(db, did, llm, market, now=1900)
    r1 = out["rounds"][0]
    assert r1["status"] == "resolved" and r1["close_price"] == 101.0 and abs(r1["move"] - 0.01) < 1e-9
    assert r1["picks"][0]["direction"] == "up" and r1["picks"][0]["hit"] == 40 and "salt" not in r1["picks"][0]
    assert r1["picks"][1]["result"] == "miss" and r1["picks"][1]["recoil"] == 6
    assert r1["hp_after"] == [100, 54]  # Brisa: -40 hit, -6 recoil
    assert out["status"] == "live" and len(out["rounds"]) == 2 and out["rounds"][1]["status"] == "sealed"
    assert out["rounds"][1]["open_price"] == 101.0 and len(llm.prompts) == 4


async def test_knockout_finishes_the_duel_and_settles_elo(db, owner):
    llm = ScriptedLLM(*([_pick("up", 3), _pick("down", 3)] * 3))
    market = Market(100.0)
    duel, _ = await _open(db, owner, llm=llm, market=market)
    did = duel["duel_id"]
    market.price = 102.0
    out = await arena.advance_duel(db, did, llm, market, now=2000)  # Brisa 100-40-12 = 48
    market.price = 104.0
    out = await arena.advance_duel(db, did, llm, market, now=3000)  # Brisa 48-40-12 -> 0
    assert out["status"] == "finished" and out["result"] == "ko" and out["winner"] == "Atlas"
    assert out["fighters"][0]["rating_after"] == 1016 and out["fighters"][1]["rating_after"] == 984
    board = await arena.leaderboard(db)
    assert [b["agent_id"] for b in board] == ["Atlas", "Brisa"]
    assert board[0]["wins"] == 1 and board[0]["kos"] == 1 and board[0]["streak"] == 1
    assert board[1]["losses"] == 1 and board[1]["streak"] == -1
    # Nothing more happens to a finished duel.
    assert (await arena.advance_duel(db, did, llm, market, now=9000))["status"] == "finished"


async def test_decision_and_draw_when_rounds_run_out(db, owner):
    llm = ScriptedLLM(*([_pick("up", 1), _pick("up", 1)] * 3))
    market = Market(100.0)
    duel, _ = await _open(db, owner, llm=llm, market=market, rounds=3)
    did = duel["duel_id"]
    for i, price in enumerate((101.0, 102.0, 103.0), start=1):
        market.price = price
        out = await arena.advance_duel(db, did, llm, market, now=1000 + 1000 * i)
    assert out["status"] == "finished" and out["result"] == "draw" and out["winner"] is None
    board = {b["agent_id"]: b for b in await arena.leaderboard(db)}
    assert board["Atlas"]["draws"] == 1 and board["Atlas"]["rating"] == 1000


async def test_model_failure_falls_back_to_momentum_and_says_so(db, owner):
    llm = ScriptedLLM(RuntimeError("down"), "not json at all")
    market = Market(100.0)
    market.change = -3.0
    duel, _ = await _open(db, owner, llm=llm, market=market)
    market.price = 99.0
    out = await arena.advance_duel(db, duel["duel_id"], llm, market, now=2000)
    picks = out["rounds"][0]["picks"]
    assert all(p["fallback"] and p["direction"] == "down" and p["confidence"] == 1 for p in picks)


async def test_resolution_lock_stops_a_double_settle(db, owner):
    duel, _ = await _open(db, owner)
    ref = db.collection("arena_duels").document(duel["duel_id"])
    await ref.update({"lock_until": 5000})
    out = await arena.advance_duel(db, duel["duel_id"], ScriptedLLM(), Market(101.0), now=2000)
    assert out["rounds"][0]["status"] == "sealed"


async def test_tick_advances_only_due_duels(db, owner):
    market = Market(100.0)
    d1, _ = await _open(db, owner, market=market, now=1000)
    d2, _ = await _open(db, owner, agent="Brisa", opponent="Atlas", market=market, now=1800)
    market.price = 101.0
    out = await arena.tick(db, ScriptedLLM(), market, now=2000)
    assert out == {"live_due": 1, "advanced": 1, "failed": 0}
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
    assert (await client.get("/api/v1/arena/config")).json()["enabled"] is False
    assert (await client.get("/api/v1/arena/duels")).status_code == 404
    monkeypatch.setenv("ARENA_ENABLED", "true")
    assert (await client.get("/api/v1/arena/duels")).json() == {"duels": []}


async def test_spectators_see_sealed_picks_and_tick_needs_the_scheduler(client, db, owner):
    duel, _ = await _open(db, owner)
    res = await client.get(f"/api/v1/arena/duels/{duel['duel_id']}")
    assert res.status_code == 200
    assert all(p["sealed"] for p in res.json()["rounds"][0]["picks"])
    listed = (await client.get("/api/v1/arena/duels?status=live")).json()["duels"]
    assert listed[0]["duel_id"] == duel["duel_id"] and "picks" not in listed[0]["rounds"][0]
    assert (await client.post("/api/v1/arena/tick")).status_code == 401


async def test_challenge_endpoint_validates_and_rate_limits(client, owner):
    body = {"owner": owner.address, "agent_id": "Atlas", "opponent_id": "Atlas"}
    assert (await client.post("/api/v1/arena/challenge", json=body)).status_code == 400
    body["opponent_id"] = "Brisa"
    for _ in range(9):
        assert (await client.post("/api/v1/arena/challenge", json=body)).status_code == 200
    assert (await client.post("/api/v1/arena/challenge", json=body)).status_code == 429
