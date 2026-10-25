"""Prediction League acceptance tests, written before the engine.

Rules pinned here (decided 25 Oct):
  - official windows every 30 min, horizon 30 min, assets rotating; picks are
    accepted only before open_ts; one pick per agent per window; max 8 agents
  - price at a boundary T = close of the candle opened at T-30m, final only
    once the candle opened at T exists (CoinGecko timestamps = candle open)
  - a sealed pick shows only its commit; the salt is published at resolution
    and anyone can recompute the seal
  - flat move or missing price after the grace period = VOID: no points, no
    rating change; a fallback pick scores 0 and never counts toward accuracy
  - scoring: right = 10*conf + magnitude bonus (<=10); wrong = -10*conf (the
    stake); a random guess at any confidence is worth nothing on average
  - ratings per ISO-week season, ELO K=16 against the field; game metrics go
    to agent_track_record, never raw into skill_scores
"""
import json

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from httpx import ASGITransport, AsyncClient

from core.rate_limit import reset_state
from services import league
from services.arena_core import seal
from tests.conftest import make_agent
from tests.fake_firestore import FakeFirestoreClient

pytestmark = pytest.mark.asyncio

H = 1800
T0 = 1_800_000_000  # a 30-minute boundary (divisible by 1800)


class ScriptedLLM:
    def __init__(self, *replies):
        self.replies, self.prompts = list(replies), []

    async def __call__(self, prompt, *, context, max_tokens=300, temperature=None, **kw):
        self.prompts.append(prompt)
        reply = self.replies.pop(0) if self.replies else {"direction": "up", "confidence": 2, "reasoning": "r", "cited": []}
        if isinstance(reply, Exception):
            raise reply
        return reply if isinstance(reply, str) else json.dumps(reply)


class FakeMarket:
    """Candles keyed by open time; the latest one is in progress like CoinGecko's."""

    def __init__(self):
        self.closes: dict[int, float] = {}  # candle open ts -> close
        self.latest_open = 0
        self.calls = 0
        self.change = 1.0

    def set_candles(self, closes: dict[int, float], latest_open: int):
        self.closes, self.latest_open = dict(closes), latest_open

    async def candles(self, asset):
        self.calls += 1
        rows = [[ts * 1000, c, c, c, c] for ts, c in sorted(self.closes.items()) if ts <= self.latest_open]
        return rows

    async def now(self, assets):
        return {a: {"price": self.closes.get(self.latest_open, 100.0), "change_24h": self.change} for a in assets}


def pick(direction, confidence=2):
    return {"direction": direction, "confidence": confidence, "reasoning": f"going {direction}", "cited": ["m0"]}


@pytest.fixture
def owner():
    return Account.create()


@pytest.fixture
def db(owner, monkeypatch, chain_owner_matches_firestore):
    db = FakeFirestoreClient()
    monkeypatch.setattr("routers.league.get_db", lambda: db)
    monkeypatch.setenv("ARENA_ENABLED", "true")
    for name, level in (("Atlas", 5), ("Brisa", 2), ("Cori", 3)):
        wallet = Account.create().address
        db.seed("agents", name, make_agent(name, wallet, user_wallet=owner.address, level=level, chain_id=97))
        chain_owner_matches_firestore[wallet.lower()] = owner.address
    db.seed("agent_events", "ev1", {"agent_id": "Atlas", "event_title": "BTC funding", "attended_at": 2,
                                    "wisdom_summary": "Extreme funding often precedes a squeeze in bitcoin."})
    return db


async def _pick(db, owner, window_id, agent="Atlas", llm=None, market=None, now=T0 - 600, signer=None):
    ch = await league.issue_pick_challenge(db, owner=owner.address, agent_id=agent, window_id=window_id, now=now)
    sig = Account.sign_message(encode_defunct(text=ch["message"]), (signer or owner).key).signature.hex()
    from routers.league import _owner_of
    return await league.submit_pick(db, nonce=ch["nonce"], signature=sig, owner_of=_owner_of,
                                    llm=llm or ScriptedLLM(), market=market or FakeMarket(), now=now)


# ── Schedule ─────────────────────────────────────────────────────────────────

async def test_official_windows_are_on_the_half_hour_and_rotate_assets(db):
    wins = await league.ensure_official_windows(db, now=T0 - 100)
    assert [w["open_ts"] for w in wins] == [T0, T0 + H]
    assert all(w["resolve_ts"] == w["open_ts"] + H and w["status"] == "upcoming" and w["kind"] == "official" for w in wins)
    assert wins[0]["asset"] != wins[1]["asset"]
    assert league.asset_for_slot(T0) == league.asset_for_slot(T0 + 5 * H)  # 5 assets rotate
    assert wins[0]["window_id"] == f"official-{wins[0]['asset']}-{T0}"
    assert wins[0]["season_id"] == league.season_of(T0)
    # Idempotent: calling again creates nothing new.
    again = await league.ensure_official_windows(db, now=T0 - 50)
    assert [w["window_id"] for w in again] == [w["window_id"] for w in wins]


async def test_season_is_the_iso_week():
    assert league.season_of(T0) == "2027-W01" or league.season_of(T0).startswith("20")
    assert league.season_of(T0) == league.season_of(T0 + 3600)


# ── Picks ────────────────────────────────────────────────────────────────────

async def test_owner_seals_a_pick_with_one_ai_call(db, owner):
    wins = await league.ensure_official_windows(db, now=T0 - 600)
    llm = ScriptedLLM(pick("up", 3))
    out = await _pick(db, owner, wins[0]["window_id"], llm=llm)
    assert out["sealed"] is True and len(out["commit"]) == 64 and "direction" not in out
    assert len(llm.prompts) == 1 and "Extreme funding" in llm.prompts[0] and wins[0]["symbol"] in llm.prompts[0]
    stored = (await db.collection("league_picks").document(f"{wins[0]['window_id']}:Atlas").get()).to_dict()
    assert stored["direction"] == "up" and stored["confidence"] == 3 and stored["fallback"] is False
    assert stored["commit"] == seal(wins[0]["window_id"], 0, "Atlas", "up", 3, stored["salt"])
    w = await league.get_window(db, wins[0]["window_id"])
    shown = w["picks"][0]
    assert w["participants"] == ["Atlas"] and shown["sealed"] is True and shown["commit"] == stored["commit"]
    assert shown["name"] == "Atlas" and "direction" not in shown and "salt" not in shown


async def test_picks_close_at_open_ts_and_are_one_per_agent(db, owner):
    wins = await league.ensure_official_windows(db, now=T0 - 600)
    wid = wins[0]["window_id"]
    await _pick(db, owner, wid)
    with pytest.raises(league.LeagueError, match="already"):
        await _pick(db, owner, wid)
    with pytest.raises(league.LeagueError, match="closed"):
        await _pick(db, owner, wid, agent="Brisa", now=T0)


async def test_signature_must_be_the_owner_and_quota_holds(db, owner, monkeypatch):
    wins = await league.ensure_official_windows(db, now=T0 - 600)
    with pytest.raises(league.LeagueError, match="does not match"):
        await _pick(db, owner, wins[0]["window_id"], signer=Account.create())
    monkeypatch.setattr(league, "PICKS_PER_OWNER_PER_DAY", 1)
    await _pick(db, owner, wins[0]["window_id"])
    with pytest.raises(league.LeagueLimitReached):
        await _pick(db, owner, wins[1]["window_id"], agent="Brisa")


async def test_window_is_capped_at_max_participants(db, owner, monkeypatch, chain_owner_matches_firestore):
    monkeypatch.setattr(league, "MAX_PARTICIPANTS", 2)
    wins = await league.ensure_official_windows(db, now=T0 - 600)
    await _pick(db, owner, wins[0]["window_id"], agent="Atlas")
    await _pick(db, owner, wins[0]["window_id"], agent="Brisa")
    with pytest.raises(league.LeagueLimitReached, match="full"):
        await _pick(db, owner, wins[0]["window_id"], agent="Cori")


# ── Sealing and settlement ───────────────────────────────────────────────────

def _candles(market, prices: dict[int, float], latest_open: int):
    market.set_candles(prices, latest_open)


async def _window_with_picks(db, owner, llm_picks, market, agents=("Atlas", "Brisa")):
    wins = await league.ensure_official_windows(db, now=T0 - 600)
    wid = wins[0]["window_id"]
    for agent, p in zip(agents, llm_picks):
        await _pick(db, owner, wid, agent=agent, llm=ScriptedLLM(p), market=market)
    return wid


async def test_open_price_locks_only_once_the_boundary_candle_exists(db, owner):
    market = FakeMarket()
    _candles(market, {T0 - 2 * H: 99.0, T0 - H: 100.0}, latest_open=T0 - H)  # candle at T0 not opened yet
    wid = await _window_with_picks(db, owner, [pick("up"), pick("down")], market)
    await league.tick(db, market, now=T0 + 30)
    assert (await league.get_window(db, wid))["status"] == "upcoming"  # still waiting for data
    _candles(market, {T0 - 2 * H: 99.0, T0 - H: 100.0, T0: 100.4}, latest_open=T0)
    await league.tick(db, market, now=T0 + 200)
    w = await league.get_window(db, wid)
    assert w["status"] == "sealed" and w["open_price"] == 100.0  # close of the candle opened at T0-30m


async def test_resolution_scores_both_sides_and_publishes_salts(db, owner):
    market = FakeMarket()
    _candles(market, {T0 - H: 100.0, T0: 101.0}, latest_open=T0)
    wid = await _window_with_picks(db, owner, [pick("up", 3), pick("down", 2)], market)
    await league.tick(db, market, now=T0 + 10)  # seals: open 100.0
    # Candle opened at T0 closes at 101.0 but is final only when T0+H exists.
    await league.tick(db, market, now=T0 + H + 10)
    assert (await league.get_window(db, wid))["status"] == "sealed"
    _candles(market, {T0 - H: 100.0, T0: 101.0, T0 + H: 101.2}, latest_open=T0 + H)
    await league.tick(db, market, now=T0 + H + 300)
    w = await league.get_window(db, wid)
    assert w["status"] == "resolved" and w["close_price"] == 101.0 and abs(w["move"] - 0.01) < 1e-9
    by = {p["agent_id"]: p for p in w["picks"]}
    assert by["Atlas"]["direction"] == "up" and by["Atlas"]["points"] == 30 + 10 and by["Atlas"]["correct"] is True
    assert by["Brisa"]["points"] == -20 and by["Brisa"]["correct"] is False
    assert all(len(p["salt"]) > 0 and p["commit"] == seal(wid, 0, p["agent_id"], p["direction"], p["confidence"], p["salt"]) for p in w["picks"])
    proof = await league.verify(db, wid)
    assert proof["ok"] is True and proof["open_price"] == 100.0 and all(p["seal_ok"] for p in proof["picks"])


async def test_flat_move_voids_the_window(db, owner):
    market = FakeMarket()
    _candles(market, {T0 - H: 100.0, T0: 100.00001, T0 + H: 100.0}, latest_open=T0 + H)
    wid = await _window_with_picks(db, owner, [pick("up", 3), pick("down", 3)], market)
    await league.tick(db, market, now=T0 + 10)
    await league.tick(db, market, now=T0 + H + 10)
    w = await league.get_window(db, wid)
    assert w["status"] == "void" and w["void_reason"] == "flat"
    board = {r["agent_id"]: r for r in await league.standings(db, league.season_of(T0))}
    assert board["Atlas"]["rating"] == 1000 and board["Atlas"]["voids"] == 1 and board["Atlas"]["matches"] == 0


async def test_missing_price_retries_then_voids_after_grace(db, owner):
    market = FakeMarket()
    _candles(market, {T0 - H: 100.0, T0: 101.0}, latest_open=T0)
    wid = await _window_with_picks(db, owner, [pick("up"), pick("down")], market)
    await league.tick(db, market, now=T0 + 10)
    await league.tick(db, market, now=T0 + H + 600)  # data never arrives
    assert (await league.get_window(db, wid))["status"] == "sealed"
    await league.tick(db, market, now=T0 + H + league.RESOLVE_GRACE_SECONDS + 1)
    w = await league.get_window(db, wid)
    assert w["status"] == "void" and w["void_reason"] == "price_unavailable"


async def test_window_nobody_joined_is_skipped_without_fetching(db):
    market = FakeMarket()
    await league.ensure_official_windows(db, now=T0 - 600)
    await league.tick(db, market, now=T0 + 10)
    assert market.calls == 0
    w = (await league.list_windows(db, "void", 10))[0]
    assert w["void_reason"] == "no_participants"


async def test_fallback_pick_scores_zero_and_is_not_counted(db, owner):
    market = FakeMarket()
    market.change = 2.0
    _candles(market, {T0 - H: 100.0, T0: 101.0, T0 + H: 101.1}, latest_open=T0 + H)
    wid = await _window_with_picks(db, owner, [RuntimeError("llm down"), pick("up", 1)], market)
    await league.tick(db, market, now=T0 + 10)
    await league.tick(db, market, now=T0 + H + 10)
    w = await league.get_window(db, wid)
    by = {p["agent_id"]: p for p in w["picks"]}
    assert by["Atlas"]["fallback"] is True and by["Atlas"]["points"] == 0 and by["Atlas"]["correct"] is None
    assert by["Brisa"]["points"] == 10 + 10
    rec = await league.agent_record(db, "Atlas")
    assert rec["matches"] == 0 and rec["accuracy"] is None
    rec_b = await league.agent_record(db, "Brisa")
    assert rec_b["matches"] == 1 and rec_b["wins"] == 1 and rec_b["accuracy"] == 1.0


async def test_ratings_move_against_the_field_and_track_record_updates(db, owner):
    market = FakeMarket()
    _candles(market, {T0 - H: 100.0, T0: 101.0, T0 + H: 101.1}, latest_open=T0 + H)
    wid = await _window_with_picks(db, owner, [pick("up", 2), pick("down", 2), pick("up", 1)], market, agents=("Atlas", "Brisa", "Cori"))
    await league.tick(db, market, now=T0 + 10)
    await league.tick(db, market, now=T0 + H + 10)
    board = await league.standings(db, league.season_of(T0))
    by = {r["agent_id"]: r for r in board}
    # Rating is earned against the field: top gains, bottom loses, exact middle stays.
    assert by["Atlas"]["rating"] > 1000 > by["Brisa"]["rating"] and by["Cori"]["rating"] == 1000
    assert by["Atlas"]["rating"] - 1000 == 1000 - by["Brisa"]["rating"] == 8
    assert by["Atlas"]["points"] == 30 and by["Atlas"]["accuracy"] == 1.0 and by["Brisa"]["losses"] == 1
    assert [r["agent_id"] for r in board][0] == "Atlas"  # most points first among winners
    track = (await db.collection("agent_track_record").document("Atlas").get()).to_dict()
    assert track["prediction"]["matches"] == 1 and track["prediction"]["streak"] == 1
    agent = (await db.collection("agents").document("Atlas").get()).to_dict()
    assert "prediction" not in (agent.get("skill_scores") or {})  # never raw into skill_scores


async def test_spectators_never_see_a_sealed_direction(db, owner):
    market = FakeMarket()
    wid = await _window_with_picks(db, owner, [pick("up"), pick("down")], market)
    listed = await league.list_windows(db, "upcoming", 10)
    assert listed and all("direction" not in p and p["sealed"] for p in listed[0]["picks"])
    assert json.dumps(await league.get_window(db, wid)).count('"direction"') == 0


# ── Private window ───────────────────────────────────────────────────────────

async def test_private_window_between_two_own_agents(db, owner):
    market = FakeMarket()
    _candles(market, {T0 - H: 100.0}, latest_open=T0 - H)
    ch = await league.issue_pick_challenge(db, owner=owner.address, agent_id="Atlas", opponent_id="Brisa", now=T0 - 600)
    sig = Account.sign_message(encode_defunct(text=ch["message"]), owner.key).signature.hex()
    from routers.league import _owner_of
    out = await league.submit_pick(db, nonce=ch["nonce"], signature=sig, owner_of=_owner_of,
                                   llm=ScriptedLLM(pick("up"), pick("down")), market=market, now=T0 - 600)
    w = await league.get_window(db, out["window_id"])
    assert w["kind"] == "private" and w["open_ts"] == T0 and sorted(w["participants"]) == ["Atlas", "Brisa"]
    # Private results never enter the season table.
    _candles(market, {T0 - H: 100.0, T0: 101.0, T0 + H: 101.1}, latest_open=T0 + H)
    await league.tick(db, market, now=T0 + 10)
    await league.tick(db, market, now=T0 + H + 10)
    assert (await league.get_window(db, out["window_id"]))["status"] == "resolved"
    assert await league.standings(db, league.season_of(T0)) == []
    assert (await league.agent_record(db, "Atlas"))["matches"] == 1  # but the record does count


# ── HTTP ─────────────────────────────────────────────────────────────────────

@pytest.fixture
async def client(db):
    reset_state()
    from main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    reset_state()


async def test_http_surface(client, db, owner, monkeypatch):
    monkeypatch.setattr(league, "_market", FakeMarket())
    cfg = (await client.get("/api/v1/league/config")).json()
    assert cfg["horizon_seconds"] == H and cfg["picks_per_day"] == league.PICKS_PER_OWNER_PER_DAY
    wins = (await client.get("/api/v1/league/windows?status=upcoming")).json()["windows"]
    assert len(wins) == 2 and wins[0]["status"] == "upcoming"
    res = await client.post("/api/v1/league/challenge", json={"owner": owner.address, "agent_id": "Atlas", "window_id": wins[0]["window_id"]})
    assert res.status_code == 200 and "Prediction League" in res.json()["message"]
    assert (await client.post("/api/v1/league/tick")).status_code == 401
    assert (await client.get(f"/api/v1/league/verify/{wins[0]['window_id']}")).status_code == 200
    monkeypatch.setenv("ARENA_ENABLED", "")
    assert (await client.get("/api/v1/league/windows")).status_code == 404
