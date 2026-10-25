"""
Prediction League router — public windows, standings and proofs; owner-signed
picks; scheduler tick. See services/league.py for the rules.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from core.agent_auth import current_owner_of
from core.auth import require_oidc
from core.database import get_db
from core.rate_limit import enforce as enforce_rate_limit
from services import league
from services.league import LeagueError, LeagueForbidden, LeagueLimitReached

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/league", tags=["league"])


class PickChallengeRequest(BaseModel):
    owner: str = Field(..., pattern=r"^0x[a-fA-F0-9]{40}$")
    agent_id: str = Field(..., max_length=200)
    window_id: str | None = Field(None, max_length=200)
    opponent_id: str | None = Field(None, max_length=200)


class SubmitPickRequest(BaseModel):
    nonce: str = Field(..., max_length=100)
    signature: str = Field(..., max_length=200)


async def _owner_of(agent_id: str, agent: dict) -> str:
    return await current_owner_of(get_db(), agent_id, agent.get("agent_wallet") or "", int(agent.get("chain_id") or 5003))


def _http(exc: Exception) -> HTTPException:
    if isinstance(exc, LeagueLimitReached):
        return HTTPException(status_code=429, detail=str(exc))
    if isinstance(exc, LeagueForbidden):
        return HTTPException(status_code=403, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


def _require_enabled() -> None:
    if not league.arena_enabled():
        raise HTTPException(status_code=404, detail="The league is not open yet")


@router.get("/config")
async def league_config() -> dict:
    return league.config()


@router.get("/windows")
async def league_windows(status: str | None = Query(None), limit: int = Query(20, ge=1, le=50)) -> dict:
    _require_enabled()
    db = get_db()
    if status in (None, "upcoming"):
        await league.ensure_official_windows(db)
    return {"windows": await league.list_windows(db, status, limit)}


@router.get("/windows/{window_id}")
async def league_window(window_id: str) -> dict:
    _require_enabled()
    try:
        return await league.get_window(get_db(), window_id)
    except LeagueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/standings")
async def league_standings(season: str | None = Query(None), limit: int = Query(50, ge=1, le=100)) -> dict:
    _require_enabled()
    season_id = season or league.config()["season_id"]
    return {"season_id": season_id, "agents": await league.standings(get_db(), season_id, limit)}


@router.get("/agents/{agent_id}")
async def league_agent(agent_id: str) -> dict:
    _require_enabled()
    return await league.agent_record(get_db(), agent_id)


@router.get("/verify/{window_id}")
async def league_verify(window_id: str) -> dict:
    _require_enabled()
    try:
        return await league.verify(get_db(), window_id)
    except LeagueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/challenge")
async def league_challenge(body: PickChallengeRequest, request: Request) -> dict:
    _require_enabled()
    enforce_rate_limit(request, "league-challenge", limit=10, window_seconds=60)
    db = get_db()
    left = await league.picks_left_today(db, body.owner)
    if left <= 0:
        raise HTTPException(status_code=429, detail=f"Daily limit reached ({league.PICKS_PER_OWNER_PER_DAY} picks per day)")
    try:
        out = await league.issue_pick_challenge(db, owner=body.owner, agent_id=body.agent_id,
                                                window_id=body.window_id, opponent_id=body.opponent_id)
    except (LeagueError, LeagueLimitReached) as exc:
        raise _http(exc)
    return out | {"picks_left_today": left}


@router.post("/picks")
async def league_submit_pick(body: SubmitPickRequest, request: Request) -> dict:
    _require_enabled()
    enforce_rate_limit(request, "league-pick", limit=10, window_seconds=60)
    try:
        return await league.submit_pick(get_db(), nonce=body.nonce, signature=body.signature, owner_of=_owner_of)
    except (LeagueError, LeagueForbidden, LeagueLimitReached) as exc:
        raise _http(exc)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("league: submit pick failed: %s", exc.__class__.__name__)
        raise HTTPException(status_code=503, detail="The league could not seal the pick right now — try again")


@router.post("/tick")
async def league_tick(_claims: dict = Depends(require_oidc)) -> dict:
    if not league.arena_enabled():
        return {"enabled": False}
    return await league.tick(get_db())
