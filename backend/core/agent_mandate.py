"""
Agent mandates — standing, scoped authorisation for background runs.

Why this exists
---------------
Every action the platform takes as an agent now needs the current owner's
signature. That is correct for anything a person triggers. It makes Auto Scout
impossible: Cloud Scheduler holds no wallet and cannot sign, so each scheduled
run is refused. Auto Scout has been dead since the auth gate went in.

A mandate is the owner saying, once, in a signed message: "within these limits,
you may act as this agent without asking me again until this expires."

What this is, precisely
-----------------------
A mandate is **enforced by this backend, not by the contract.** It is a promise
the platform keeps, not a rule the chain enforces. If the backend is
compromised, a mandate does not stop anything. The on-chain policy version
(scope, budget, token allowlist) is the one that actually binds, and that is
later work.

What that means for scope
------------------------
Because a mandate is only as strong as our own enforcement, v0 deliberately
grants the narrowest useful permission: **attend_event only.** No trading, no
transfers, no proposal execution. A mandate that could move funds would turn a
backend compromise into a wallet drain.

The four properties that do real work here
------------------------------------------
1. **Owner is re-read from the chain on every single run.** A mandate is issued
   to an owner, not to a wallet that used to own the agent. The moment the agent
   sells, the mandate stops matching and is revoked on the spot.
2. **Expiry.** A mandate cannot outlive its usefulness.
3. **Daily budget.** Damage from a bug is bounded per day, not unbounded.
4. **Revocation.** The owner can pull it back at any moment.

Ownership epoch
---------------
A mandate is bound to the agent's `ownership_epoch`, which increments on every
ownership transfer. Without that, an agent sold to a stranger and later sold
back to the original owner would resurrect the original owner's old mandate.
With it, a mandate signed at epoch N can never act at epoch N+1.
"""
from __future__ import annotations

import logging
import secrets
import time
from datetime import datetime, timezone
from typing import Any

from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import HTTPException
from google.cloud.firestore_v1.base_query import FieldFilter

from core.agent_auth import current_owner_of

logger = logging.getLogger(__name__)

MANDATES_COLLECTION = "agent_mandates"
MANDATE_CHALLENGES_COLLECTION = "agent_mandate_challenges"
REVOCATION_CHALLENGES_COLLECTION = "agent_mandate_revocation_challenges"

MANDATE_CHALLENGE_TTL_SECONDS = 10 * 60
DEFAULT_MANDATE_TTL_SECONDS = 7 * 24 * 3600

# The only action a mandate may authorise today. Adding a second one is a
# deliberate decision, not a config change — a mandate that could move funds
# would make a backend compromise a wallet drain.
MANDATEABLE_SCOPES = ("attend_event",)


def mandate_message(
    agent_id: str,
    agent_wallet: str,
    owner_wallet: str,
    chain_id: int,
    scopes: list[str],
    max_runs_per_day: int,
    expires_at: float,
    nonce: str,
) -> str:
    """Exact text the owner signs. Every field that limits the mandate is inside
    it, so a signature cannot be re-pointed at a wider scope, a longer expiry,
    or a different agent."""
    return (
        "ASAJU AI Agent Mandate\n"
        f"Agent ID: {agent_id}\n"
        f"Agent wallet: {agent_wallet}\n"
        f"Owner wallet: {owner_wallet}\n"
        f"Chain ID: {chain_id}\n"
        f"Scopes: {','.join(sorted(scopes))}\n"
        f"Max runs per day: {max_runs_per_day}\n"
        f"Expires at: {int(expires_at)}\n"
        f"Nonce: {nonce}\n"
        "This authorises the platform to act as this agent within these limits "
        "until expiry. It can be revoked at any time, and it stops immediately "
        "if the agent changes hands. It does not authorise trading or transfers."
    )


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


async def issue_mandate_challenge(
    db,
    *,
    agent_id: str,
    agent_wallet: str,
    chain_id: int,
    scopes: list[str],
    max_runs_per_day: int,
    ttl_seconds: int = DEFAULT_MANDATE_TTL_SECONDS,
) -> dict[str, Any]:
    """Ask the owner to sign a mandate. Returns the message plus its nonce.

    The owner in the signed text is read from the chain at issue time, so the
    mandate can never be issued to a wallet that does not currently own the
    agent.
    """
    unknown = [s for s in scopes if s not in MANDATEABLE_SCOPES]
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported mandate scope(s): {', '.join(unknown)}. "
                f"Available: {', '.join(MANDATEABLE_SCOPES)}."
            ),
        )
    if not scopes:
        raise HTTPException(status_code=400, detail="A mandate needs at least one scope")
    if max_runs_per_day < 1 or max_runs_per_day > 100:
        raise HTTPException(
            status_code=400, detail="max_runs_per_day must be between 1 and 100"
        )

    owner_wallet = await current_owner_of(db, agent_id, agent_wallet, chain_id)

    nonce = secrets.token_urlsafe(24)
    expires_at = time.time() + min(ttl_seconds, DEFAULT_MANDATE_TTL_SECONDS)
    message = mandate_message(
        agent_id, agent_wallet, owner_wallet, chain_id, scopes, max_runs_per_day,
        expires_at, nonce,
    )
    await db.collection(MANDATE_CHALLENGES_COLLECTION).document(nonce).set(
        {
            "nonce": nonce,
            "message": message,
            "agent_id": agent_id,
            "agent_wallet": agent_wallet.lower(),
            "owner_wallet": owner_wallet,
            "chain_id": chain_id,
            "scopes": sorted(scopes),
            "max_runs_per_day": max_runs_per_day,
            "expires_at": expires_at,
            "created_at": time.time(),
        }
    )
    return {
        "nonce": nonce,
        "message": message,
        "expires_at": expires_at,
        "owner_wallet": owner_wallet,
        "scopes": sorted(scopes),
    }


async def grant_mandate(
    db,
    *,
    nonce: str,
    signature: str,
) -> dict[str, Any]:
    """Verify the owner's signature and persist the mandate.

    On success returns the stored mandate. The mandate is bound to the agent's
    current ownership epoch, so it dies the moment the agent is sold.
    """
    ref = db.collection(MANDATE_CHALLENGES_COLLECTION).document(nonce)
    doc = await ref.get()
    if not doc.exists:
        raise HTTPException(status_code=401, detail="Unknown or expired mandate request")
    challenge = doc.to_dict() or {}
    # `expires_at` is the mandate's own expiry (days away); the request to sign
    # it lapses after MANDATE_CHALLENGE_TTL_SECONDS like every other challenge.
    if float(challenge.get("created_at") or 0) + MANDATE_CHALLENGE_TTL_SECONDS < time.time():
        raise HTTPException(status_code=401, detail="Mandate request expired — start again")

    try:
        recovered = Account.recover_message(
            encode_defunct(text=challenge["message"]), signature=signature
        )
    except Exception as exc:
        logger.warning(
            "mandate: signature recovery failed for nonce %s: %s",
            nonce[:8], exc.__class__.__name__,
        )
        raise HTTPException(status_code=401, detail="Signature could not be recovered")

    if recovered.lower() != (challenge.get("owner_wallet") or "").lower():
        raise HTTPException(
            status_code=403,
            detail="Only the current owner can grant a mandate for this agent",
        )
    await ref.delete()

    agent_id = challenge["agent_id"]
    agent_wallet = challenge["agent_wallet"]
    chain_id = int(challenge.get("chain_id") or 5003)

    # The challenge captured the owner at issue time. Re-read at grant time so a
    # sale that lands between the two cannot produce a mandate for a former
    # owner.
    current_owner = await current_owner_of(db, agent_id, agent_wallet, chain_id)
    if current_owner.lower() != recovered.lower():
        raise HTTPException(
            status_code=403,
            detail="This agent changed hands while the mandate was being confirmed.",
        )

    epoch = await _current_epoch(db, agent_id)

    mandate_ref = db.collection(MANDATES_COLLECTION).document(f"{agent_id}:{chain_id}")
    mandate = {
        "agent_id": agent_id,
        "agent_wallet": agent_wallet,
        "owner_wallet": current_owner,
        "chain_id": chain_id,
        "scopes": challenge.get("scopes") or list(MANDATEABLE_SCOPES),
        "max_runs_per_day": int(challenge.get("max_runs_per_day") or 1),
        "expires_at": float(challenge.get("expires_at") or 0),
        "ownership_epoch": epoch,
        "revoked_at": None,
        "runs_day": _today_utc(),
        "runs_used_today": 0,
        "created_at": time.time(),
    }
    await mandate_ref.set(mandate)
    logger.info(
        "mandate granted: agent=%s scopes=%s owner=%s until=%s",
        agent_id, mandate["scopes"], current_owner, mandate["expires_at"],
    )
    if "attend_event" in mandate["scopes"]:
        await _set_auto_scout(db, agent_id, True)
    return mandate


async def _set_auto_scout(db, agent_id: str, enabled: bool) -> None:
    """auto_scout_enabled mirrors the signed mandate: only grant/revoke flip it,
    so nobody can switch another owner's background runs on or off unsigned."""
    update: dict[str, Any] = {"auto_scout_enabled": enabled}
    if enabled:
        update.update({"auto_scout_disabled_reason": None, "auto_scout_disabled_at": None})
    try:
        await db.collection("agents").document(agent_id).update(update)
    except Exception as exc:
        # The mandate itself is the gate for every run, so a failed flag write
        # can only make the scheduler skip or pick up an agent; log and move on.
        logger.warning("mandate: could not set auto_scout_enabled=%s on %s: %s", enabled, agent_id, exc)


async def _current_epoch(db, agent_id: str) -> int:
    """Ownership epoch for an agent, defaulting to 0 for agents that have never
    been sold. Incremented by the marketplace indexer on every transfer."""
    doc = await db.collection("agents").document(agent_id).get()
    if not doc.exists:
        return 0
    return int((doc.to_dict() or {}).get("ownership_epoch") or 0)


async def active_mandate(
    db,
    *,
    agent_id: str,
    chain_id: int,
    action: str,
) -> dict[str, Any] | None:
    """Return a usable mandate for this action, or None.

    A mandate is usable only if every one of these holds:
      - it exists and has not been revoked
      - it has not expired
      - it covers this action
      - its daily budget is not spent
      - it was issued to the wallet that owns the agent *right now*
      - it was issued at the agent's current ownership epoch
    """
    ref = db.collection(MANDATES_COLLECTION).document(f"{agent_id}:{chain_id}")
    doc = await ref.get()
    if not doc.exists:
        return None
    mandate = doc.to_dict() or {}

    if mandate.get("revoked_at"):
        return None
    if float(mandate.get("expires_at") or 0) < time.time():
        return None
    if action not in (mandate.get("scopes") or []):
        return None

    # Daily budget, reset on the first run of a new UTC day.
    today = _today_utc()
    used = int(mandate.get("runs_used_today") or 0)
    if mandate.get("runs_day") != today:
        used = 0
    if used >= int(mandate.get("max_runs_per_day") or 0):
        return None

    # The mandate names an owner. If that is no longer the owner, the mandate is
    # dead — and we revoke it so the state stays honest.
    agent_wallet = mandate.get("agent_wallet")
    try:
        current_owner = await current_owner_of(db, agent_id, agent_wallet, chain_id)
    except HTTPException:
        # Could not verify ownership. Do not act on an unverifiable mandate.
        return None

    if current_owner.lower() != (mandate.get("owner_wallet") or "").lower():
        await ref.update(
            {
                "revoked_at": time.time(),
                "revoked_reason": "agent changed hands",
            }
        )
        logger.info(
            "mandate for agent %s revoked: owner moved to %s", agent_id, current_owner
        )
        await _set_auto_scout(db, agent_id, False)
        return None

    # Sold away and sold back: same owner again, but a different epoch, so the
    # old mandate must not come back to life.
    epoch = await _current_epoch(db, agent_id)
    if int(mandate.get("ownership_epoch") or 0) != epoch:
        await ref.update(
            {
                "revoked_at": time.time(),
                "revoked_reason": "ownership epoch changed",
            }
        )
        logger.info(
            "mandate for agent %s revoked: epoch %s -> %s",
            agent_id, mandate.get("ownership_epoch"), epoch,
        )
        await _set_auto_scout(db, agent_id, False)
        return None

    return mandate


async def consume_mandate_run(
    db,
    *,
    agent_id: str,
    chain_id: int,
    action: str,
) -> dict[str, Any]:
    """Take one run from a mandate's daily budget, or refuse.

    Refusing is loud on purpose: a scheduler that silently stops is how Auto
    Scout looked "enabled but broken" for weeks. The reason is returned so the
    caller can log something a human can act on.
    """
    mandate = await active_mandate(db, agent_id=agent_id, chain_id=chain_id, action=action)
    if mandate is None:
        raise PermissionError(
            f"No active mandate authorises '{action}' for agent {agent_id}. "
            "The owner must grant one, it expired, the daily budget is spent, "
            "or the agent changed hands."
        )

    today = _today_utc()
    used = int(mandate.get("runs_used_today") or 0) if mandate.get("runs_day") == today else 0
    ref = db.collection(MANDATES_COLLECTION).document(f"{agent_id}:{chain_id}")
    await ref.update(
        {
            "runs_day": today,
            "runs_used_today": used + 1,
            "last_used_at": time.time(),
        }
    )
    # Return the post-write state so callers (and logs) report the run that just
    # happened rather than the budget as it was before it.
    return {**mandate, "runs_day": today, "runs_used_today": used + 1}


async def revoke_mandate(
    db,
    *,
    agent_id: str,
    chain_id: int,
    reason: str = "revoked by owner",
) -> bool:
    """Revoke whatever mandate exists. Returns True if there was one.

    Callers must have already established that the caller is the current owner
    (see issue_mandate_revocation_challenge / confirm_mandate_revocation).
    """
    ref = db.collection(MANDATES_COLLECTION).document(f"{agent_id}:{chain_id}")
    doc = await ref.get()
    if not doc.exists:
        return False
    await ref.update({"revoked_at": time.time(), "revoked_reason": reason})
    logger.info("mandate for agent %s revoked: %s", agent_id, reason)
    await _set_auto_scout(db, agent_id, False)
    return True


async def issue_mandate_revocation_challenge(
    db,
    *,
    agent_id: str,
    chain_id: int,
) -> dict[str, Any]:
    """Message the owner signs to cancel a mandate.

    Revocation needed a signature for the same reason granting did: without one,
    anyone who knows an agent_id could switch off another owner's background
    runs — a cheap way to stop someone else's agent from learning.
    """
    ref = db.collection(MANDATES_COLLECTION).document(f"{agent_id}:{chain_id}")
    doc = await ref.get()
    if not doc.exists:
        raise HTTPException(
            status_code=404, detail=f"No mandate exists for agent {agent_id}"
        )

    agent_wallet = (doc.to_dict() or {}).get("agent_wallet") or ""
    owner_wallet = await current_owner_of(db, agent_id, agent_wallet, chain_id)

    nonce = secrets.token_urlsafe(24)
    expires_at = time.time() + MANDATE_CHALLENGE_TTL_SECONDS
    message = (
        "ASAJU AI Agent Mandate Revocation\n"
        f"Agent ID: {agent_id}\n"
        f"Chain ID: {chain_id}\n"
        f"Owner wallet: {owner_wallet}\n"
        f"Nonce: {nonce}\n"
        f"Expires at: {int(expires_at)}\n"
        "This cancels the standing authorisation. Background runs will stop "
        "after the current one finishes."
    )
    await db.collection(REVOCATION_CHALLENGES_COLLECTION).document(nonce).set(
        {
            "nonce": nonce,
            "message": message,
            "agent_id": agent_id,
            "chain_id": chain_id,
            "owner_wallet": owner_wallet,
            "expires_at": expires_at,
            "created_at": time.time(),
        }
    )
    return {"nonce": nonce, "message": message, "expires_at": expires_at}


async def confirm_mandate_revocation(
    db,
    *,
    nonce: str,
    signature: str,
) -> dict[str, Any]:
    """Verify the owner's signature and cancel the mandate."""
    ref = db.collection(REVOCATION_CHALLENGES_COLLECTION).document(nonce)
    doc = await ref.get()
    if not doc.exists:
        raise HTTPException(status_code=401, detail="Unknown or expired revocation request")
    challenge = doc.to_dict() or {}
    if float(challenge.get("expires_at") or 0) < time.time():
        raise HTTPException(status_code=401, detail="Revocation request expired — start again")

    try:
        recovered = Account.recover_message(
            encode_defunct(text=challenge["message"]), signature=signature
        )
    except Exception as exc:
        logger.warning(
            "mandate revocation: signature recovery failed for nonce %s: %s",
            nonce[:8], exc.__class__.__name__,
        )
        raise HTTPException(status_code=401, detail="Signature could not be recovered")

    if recovered.lower() != (challenge.get("owner_wallet") or "").lower():
        raise HTTPException(
            status_code=403,
            detail="Only the current owner can cancel this mandate",
        )

    revoked = await revoke_mandate(
        db,
        agent_id=challenge["agent_id"],
        chain_id=int(challenge.get("chain_id") or 5003),
        reason="revoked by owner",
    )
    await ref.delete()
    return {"revoked": revoked, "agent_id": challenge["agent_id"]}


async def list_mandates(db, agent_id: str) -> list[dict[str, Any]]:
    """All mandates ever issued for an agent, newest first."""
    query = (
        db.collection(MANDATES_COLLECTION)
        .where(filter=FieldFilter("agent_id", "==", agent_id))
    )
    out: list[dict[str, Any]] = []
    async for doc in query.stream():
        out.append(doc.to_dict() or {})
    out.sort(key=lambda m: m.get("created_at") or 0, reverse=True)
    return out