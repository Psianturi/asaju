"""
Agent Room router — an owner's agents talk, share lessons, and hand them to
each other. See services/agent_room.py for the safety and cost model.

Auth: opening a room needs the owner's wallet signature plus on-chain ownership
of every agent in it. Every later call carries the room key returned at open
time as `Authorization: Bearer <room_key>`.
"""

import logging

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from core.agent_auth import current_owner_of
from core.database import get_db
from core.rate_limit import enforce as enforce_rate_limit
from services import agent_room
from services.agent_room import RoomError, RoomForbidden, RoomLimitReached

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/rooms", tags=["rooms"])


class RoomChallengeRequest(BaseModel):
    owner: str = Field(..., pattern=r"^0x[a-fA-F0-9]{40}$")
    agent_ids: list[str] = Field(..., min_length=1, max_length=agent_room.MAX_PARTICIPANTS + 2)
    topic: str = Field(..., max_length=2000)
    mode: str = "exchange"
    max_turns: int = agent_room.DEFAULT_TURNS


class OpenRoomRequest(BaseModel):
    nonce: str = Field(..., max_length=100)
    signature: str = Field(..., max_length=200)


class SayRequest(BaseModel):
    text: str = Field(..., max_length=4000)


class SketchRequest(BaseModel):
    # A data URL; the service checks type, bytes and size.
    image: str = Field(..., max_length=700_000)
    note: str = Field("", max_length=2000)


class TransferRequest(BaseModel):
    event_id: str = Field(..., max_length=200)
    to_agent_id: str = Field(..., max_length=200)


async def _owner_of(agent_id: str, agent: dict) -> str:
    return await current_owner_of(
        get_db(), agent_id, agent.get("agent_wallet") or "", int(agent.get("chain_id") or 5003)
    )


def _room_key(authorization: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip() or None
    return None


def _http(exc: Exception) -> HTTPException:
    if isinstance(exc, RoomLimitReached):
        return HTTPException(status_code=429, detail=str(exc))
    if isinstance(exc, RoomForbidden):
        return HTTPException(status_code=403, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


@router.get("/config")
async def room_config() -> dict:
    """Limits and modes, so the UI never hard-codes them."""
    return {
        "modes": {k: v["label"] for k, v in agent_room.MODES.items()},
        "min_participants": agent_room.MIN_PARTICIPANTS,
        "max_participants": agent_room.MAX_PARTICIPANTS,
        "default_turns": agent_room.DEFAULT_TURNS,
        "max_turns": agent_room.MAX_TURNS,
        "max_owner_messages": agent_room.MAX_OWNER_MESSAGES,
        "rooms_per_day": agent_room.ROOMS_PER_OWNER_PER_DAY,
    }


@router.post("/challenge")
async def post_challenge(body: RoomChallengeRequest, request: Request) -> dict:
    # Every call writes a challenge document.
    enforce_rate_limit(request, "room-challenge", limit=10, window_seconds=60)
    db = get_db()
    # Checked here only to fail early; open_room is where the quota is enforced.
    left = await agent_room.rooms_left_today(db, body.owner)
    if left <= 0:
        raise HTTPException(status_code=429, detail=f"Daily limit reached ({agent_room.ROOMS_PER_OWNER_PER_DAY} rooms per day)")
    try:
        out = await agent_room.issue_room_challenge(
            db, owner=body.owner, agent_ids=body.agent_ids, topic=body.topic,
            mode=body.mode, max_turns=body.max_turns,
        )
    except (RoomError, RoomLimitReached) as exc:
        raise _http(exc)
    return out | {"rooms_left_today": left}


@router.post("")
async def post_open_room(body: OpenRoomRequest) -> dict:
    try:
        return await agent_room.open_room(get_db(), nonce=body.nonce, signature=body.signature, owner_of=_owner_of)
    except (RoomError, RoomLimitReached) as exc:
        raise _http(exc)


@router.get("/{room_id}")
async def get_room(room_id: str, authorization: str | None = Header(None)) -> dict:
    try:
        room = await agent_room.require_room(get_db(), room_id, _room_key(authorization))
    except RoomForbidden as exc:
        raise _http(exc)
    return agent_room.public_room(room)


@router.post("/{room_id}/turn")
async def post_turn(room_id: str, authorization: str | None = Header(None)) -> dict:
    db = get_db()
    try:
        await agent_room.require_room(db, room_id, _room_key(authorization))
        return await agent_room.take_turn(db, room_id)
    except (RoomError, RoomForbidden, RoomLimitReached) as exc:
        raise _http(exc)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("room %s: turn failed: %s", room_id, exc.__class__.__name__)
        raise HTTPException(status_code=503, detail="The agent could not answer right now — try again")


@router.post("/{room_id}/say")
async def post_say(room_id: str, body: SayRequest, authorization: str | None = Header(None)) -> dict:
    db = get_db()
    try:
        await agent_room.require_room(db, room_id, _room_key(authorization))
        return await agent_room.owner_says(db, room_id, body.text)
    except (RoomError, RoomForbidden, RoomLimitReached) as exc:
        raise _http(exc)


@router.post("/{room_id}/conclude")
async def post_conclude(room_id: str, authorization: str | None = Header(None)) -> dict:
    db = get_db()
    try:
        await agent_room.require_room(db, room_id, _room_key(authorization))
        return {"synthesis": await agent_room.conclude_room(db, room_id)}
    except (RoomError, RoomForbidden, RoomLimitReached) as exc:
        raise _http(exc)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("room %s: synthesis failed: %s", room_id, exc.__class__.__name__)
        raise HTTPException(status_code=503, detail="Could not write the summary right now — try again")


@router.post("/{room_id}/transfer")
async def post_transfer(room_id: str, body: TransferRequest, authorization: str | None = Header(None)) -> dict:
    db = get_db()
    try:
        await agent_room.require_room(db, room_id, _room_key(authorization))
        return await agent_room.transfer_lesson(db, room_id, body.event_id, body.to_agent_id, owner_of=_owner_of)
    except (RoomError, RoomForbidden, RoomLimitReached) as exc:
        raise _http(exc)


@router.post("/{room_id}/sketch")
async def post_sketch(room_id: str, body: SketchRequest, authorization: str | None = Header(None)) -> dict:
    db = get_db()
    try:
        await agent_room.require_room(db, room_id, _room_key(authorization))
        return await agent_room.share_sketch(db, room_id, body.image, body.note)
    except (RoomError, RoomForbidden, RoomLimitReached) as exc:
        raise _http(exc)


@router.get("/{room_id}/sketch")
async def get_sketch(room_id: str, authorization: str | None = Header(None)) -> dict:
    db = get_db()
    try:
        await agent_room.require_room(db, room_id, _room_key(authorization))
    except RoomForbidden as exc:
        raise _http(exc)
    sketch = await agent_room.get_sketch(db, room_id)
    if not sketch:
        return {"image": None}
    return {"image": f"data:{sketch['mime']};base64,{sketch['data']}", "note": sketch.get("note") or "", "at": sketch.get("at")}
