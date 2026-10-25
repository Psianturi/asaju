"""
Arena router — public spectating, owner-signed duels, scheduler ticks.
See services/arena.py for the rules and the safety model.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from core.agent_auth import current_owner_of
from core.auth import require_oidc
from core.database import get_db
from core.rate_limit import enforce as enforce_rate_limit
from services import arena
from services.arena import ArenaError, ArenaForbidden, ArenaLimitReached

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/arena", tags=["arena"])


class DuelChallengeRequest(BaseModel):
    owner: str = Field(..., pattern=r"^0x[a-fA-F0-9]{40}$")
    agent_id: str = Field(..., max_length=200)
    opponent_id: str = Field(..., max_length=200)
    rounds: int = arena.DEFAULT_ROUNDS
    mode: str = arena.DEFAULT_MODE
    horizon: str = arena.DEFAULT_HORIZON
    open_to_challenges: bool = True


class OpenDuelRequest(BaseModel):
    nonce: str = Field(..., max_length=100)
    signature: str = Field(..., max_length=200)


async def _owner_of(agent_id: str, agent: dict) -> str:
    return await current_owner_of(
        get_db(), agent_id, agent.get("agent_wallet") or "", int(agent.get("chain_id") or 5003)
    )


def _http(exc: Exception) -> HTTPException:
    if isinstance(exc, ArenaLimitReached):
        return HTTPException(status_code=429, detail=str(exc))
    if isinstance(exc, ArenaForbidden):
        return HTTPException(status_code=403, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


def _require_enabled() -> None:
    if not arena.arena_enabled():
        raise HTTPException(status_code=404, detail="The arena is not open yet")


@router.get("/config")
async def arena_config() -> dict:
    return arena.config()


@router.get("/leaderboard")
async def arena_leaderboard(limit: int = Query(50, ge=1, le=100)) -> dict:
    _require_enabled()
    return {"agents": await arena.leaderboard(get_db(), limit)}


@router.get("/open-agents")
async def arena_open_agents() -> dict:
    _require_enabled()
    return {"agents": await arena.open_agents(get_db())}


@router.get("/duels")
async def arena_duels(status: str | None = Query(None), limit: int = Query(20, ge=1, le=50)) -> dict:
    _require_enabled()
    return {"duels": await arena.list_duels(get_db(), status, limit)}


@router.get("/duels/{duel_id}")
async def arena_duel(duel_id: str) -> dict:
    _require_enabled()
    try:
        return await arena.get_duel(get_db(), duel_id)
    except ArenaError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/challenge")
async def arena_challenge(body: DuelChallengeRequest, request: Request) -> dict:
    _require_enabled()
    enforce_rate_limit(request, "arena-challenge", limit=10, window_seconds=60)
    db = get_db()
    left = await arena.duels_left_today(db, body.owner)
    if left <= 0:
        raise HTTPException(status_code=429, detail=f"Daily limit reached ({arena.DUELS_PER_OWNER_PER_DAY} duels per day)")
    try:
        out = await arena.issue_challenge(
            db, owner=body.owner, agent_id=body.agent_id, opponent_id=body.opponent_id,
            rounds=body.rounds, mode=body.mode, horizon=body.horizon,
            open_to_challenges=body.open_to_challenges,
        )
    except (ArenaError, ArenaLimitReached) as exc:
        raise _http(exc)
    return out | {"duels_left_today": left}


@router.post("/duels")
async def arena_open_duel(body: OpenDuelRequest, request: Request) -> dict:
    _require_enabled()
    enforce_rate_limit(request, "arena-open", limit=10, window_seconds=60)
    try:
        return await arena.open_duel(get_db(), nonce=body.nonce, signature=body.signature, owner_of=_owner_of)
    except (ArenaError, ArenaForbidden, ArenaLimitReached) as exc:
        raise _http(exc)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("arena: open duel failed: %s", exc.__class__.__name__)
        raise HTTPException(status_code=503, detail="The arena could not start the duel right now — try again")


@router.post("/duels/{duel_id}/advance")
async def arena_advance(duel_id: str, request: Request) -> dict:
    """Spectators may nudge a duel forward; it only moves once the round's
    horizon has passed, so this costs nothing before then."""
    _require_enabled()
    enforce_rate_limit(request, "arena-advance", limit=30, window_seconds=60)
    try:
        return await arena.advance_duel(get_db(), duel_id)
    except ArenaError as exc:
        raise _http(exc)
    except Exception as exc:
        logger.warning("arena: advance %s failed: %s", duel_id, exc.__class__.__name__)
        raise HTTPException(status_code=503, detail="The round could not be resolved right now — try again")


@router.post("/tick")
async def arena_tick(_claims: dict = Depends(require_oidc)) -> dict:
    if not arena.arena_enabled():
        return {"enabled": False}
    return await arena.tick(get_db())
