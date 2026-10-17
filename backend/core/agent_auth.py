"""
Agent action authorization — proves a request comes from the wallet that owns
the agent on-chain *right now*.

Why this module exists
----------------------
Two routers decrypt an agent's private key and sign with it on the owner's
behalf. Before this existed, neither endpoint checked who was asking: anyone
who knew an `agent_id` could have the platform sign as that agent.

That is survivable with no marketplace, and unacceptable with one. The moment
an agent can be sold, "who is allowed to make this agent act" stops being a
detail and becomes the whole security model — the previous owner must lose
control the instant the sale settles, not whenever an indexer happens to catch
up.

How ownership is resolved
-------------------------
The contract's own `agentOwner[agentWallet]` mapping is the source of truth,
not the Firestore `user_wallet` mirror. Firestore is a cache written by
`marketplace_indexer` on a poll loop, so it lags a sale by minutes; the chain
does not. Authorization therefore reads the chain whenever a reader is
available, and falls back to Firestore only for chains that predate V5 (which
have no ownership-transfer primitive and so can never change hands anyway).

The flow mirrors the proposal approval flow that already ships:
challenge -> owner signs -> backend recovers -> backend compares to the
chain's current owner -> challenge is consumed so it cannot be replayed.
"""
from __future__ import annotations

import logging
import secrets
import time
from typing import Any

from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import HTTPException

logger = logging.getLogger(__name__)

AGENT_AUTH_CHALLENGES_COLLECTION = "agent_auth_challenges"
CHALLENGE_TTL_SECONDS = 10 * 60


def agent_action_message(
    agent_id: str,
    action: str,
    agent_wallet: str,
    chain_id: int,
    nonce: str,
    expires_at: float,
) -> str:
    """The exact text the owner signs. Every field that scopes the authorisation
    is inside the signed payload, so a signature captured for one action on one
    agent cannot be replayed against another."""
    return (
        "ASAJU AI Agent Action Authorization\n"
        f"Action: {action}\n"
        f"Agent ID: {agent_id}\n"
        f"Agent wallet: {agent_wallet}\n"
        f"Chain ID: {chain_id}\n"
        f"Nonce: {nonce}\n"
        f"Expires at: {int(expires_at)}\n"
        "This signature authorises the platform to act as this agent for this "
        "action only. It does not transfer ownership."
    )


async def issue_agent_auth_challenge(
    db,
    *,
    agent_id: str,
    agent_wallet: str,
    action: str,
    chain_id: int,
) -> dict[str, Any]:
    """Mint a short-lived nonce the owner must sign. Returns the message plus
    the nonce so the client can echo both back."""
    nonce = secrets.token_urlsafe(24)
    expires_at = time.time() + CHALLENGE_TTL_SECONDS
    message = agent_action_message(agent_id, action, agent_wallet, chain_id, nonce, expires_at)
    # The exact message is persisted, not regenerated on verify. If it were
    # rebuilt from fields, any drift in formatting between issue and verify
    # would make every signature fail to recover.
    await db.collection(AGENT_AUTH_CHALLENGES_COLLECTION).document(nonce).set(
        {
            "nonce": nonce,
            "message": message,
            "agent_id": agent_id,
            "agent_wallet": agent_wallet.lower(),
            "action": action,
            "chain_id": chain_id,
            "expires_at": expires_at,
            "created_at": time.time(),
        }
    )
    return {"nonce": nonce, "message": message, "expires_at": expires_at}


async def current_owner_of(db, agent_id: str, agent_wallet: str, chain_id: int) -> str:
    """Resolve who owns the agent *now*.

    Prefers the chain. Falls back to the Firestore mirror only when the chain
    cannot be read, and says so in the log — a silent fallback would let a
    just-sold agent keep answering to its old owner.
    """
    chain_owner = await _read_agent_owner_on_chain(agent_wallet, chain_id)
    if chain_owner:
        return chain_owner

    doc = await db.collection("agents").document(agent_id).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_id}' not found")
    data = doc.to_dict() or {}
    firestore_owner = (data.get("user_wallet") or "").strip()
    if not firestore_owner:
        raise HTTPException(
            status_code=409,
            detail=f"Agent '{agent_id}' has no registered owner wallet",
        )
    logger.warning(
        "agent_auth: could not read agentOwner on chain %s for %s; using the "
        "Firestore mirror, which can lag a marketplace sale",
        chain_id,
        agent_id,
    )
    return Web3Normalise.to_checksum(firestore_owner)


async def _read_agent_owner_on_chain(agent_wallet: str, chain_id: int) -> str | None:
    """Read agentOwner(agentWallet) from the deployed contract. Returns None when
    the chain is unreachable or the contract predates V5 (no such getter)."""
    try:
        from services.web3_service import web3_service

        return await web3_service.get_agent_owner(agent_wallet, chain_id)
    except Exception as exc:  # network blip, unsupported chain, legacy contract
        logger.debug(
            "agent_auth: on-chain agentOwner read failed for %s on chain %s: %s",
            agent_wallet,
            chain_id,
            exc.__class__.__name__,
        )
        return None


async def require_agent_owner(
    db,
    *,
    agent_id: str,
    agent_wallet: str,
    action: str,
    chain_id: int,
    nonce: str,
    signature: str,
) -> str:
    """Verify the owner signed this exact action for this exact agent.

    Returns the verified owner address. Raises 401 when the signature does not
    match, and 403 when it matches but the signer is no longer the owner — the
    distinction matters for the seller who was locked out by a sale.
    """
    challenge_ref = db.collection(AGENT_AUTH_CHALLENGES_COLLECTION).document(nonce)
    challenge_doc = await challenge_ref.get()

    if not challenge_doc.exists:
        raise HTTPException(
            status_code=401,
            detail="Unknown or expired authorisation — request a new challenge",
        )

    challenge = challenge_doc.to_dict() or {}
    if challenge.get("used_at"):
        raise HTTPException(
            status_code=401,
            detail="This authorisation was already used — request a new challenge",
        )
    if float(challenge.get("expires_at") or 0) < time.time():
        raise HTTPException(
            status_code=401,
            detail="Authorisation expired — request a new challenge",
        )
    if (
        challenge.get("agent_id") != agent_id
        or challenge.get("action") != action
        or int(challenge.get("chain_id") or 0) != int(chain_id)
    ):
        raise HTTPException(
            status_code=401,
            detail="Authorisation was issued for a different agent or action",
        )

    try:
        recovered = Account.recover_message(
            encode_defunct(text=challenge["message"]), signature=signature
        )
    except Exception as exc:
        # Log the real cause: a bare 401 here would hide malformed-hex bugs
        # behind a generic "could not be recovered".
        logger.warning(
            "agent_auth: signature recovery failed for nonce %s on agent %s: %s: %s",
            nonce[:8],
            agent_id,
            exc.__class__.__name__,
            exc,
        )
        raise HTTPException(status_code=401, detail="Signature could not be recovered")

    claimed_owner = (challenge.get("claimed_owner") or recovered).lower()
    if claimed_owner != recovered.lower():
        raise HTTPException(
            status_code=401,
            detail="Signature does not match the claimed owner wallet",
        )

    # Consume before the ownership check so a rejected signature cannot be
    # retried against the same nonce until it expires.
    await challenge_ref.update({"used_at": time.time(), "used_by": recovered})

    current_owner = await current_owner_of(db, agent_id, agent_wallet, chain_id)
    if current_owner.lower() != recovered.lower():
        raise HTTPException(
            status_code=403,
            detail=(
                "This agent changed hands. Only the current owner "
                f"{current_owner} may authorise agent actions."
            ),
        )

    logger.info(
        "agent_auth: %s authorised by %s for agent %s on chain %s",
        action,
        recovered,
        agent_id,
        chain_id,
    )
    return recovered


class Web3Normalise:
    """Thin wrapper so callers get checksummed addresses without importing web3
    into every module that needs one."""

    @staticmethod
    def to_checksum(address: str) -> str:
        try:
            from web3 import Web3

            return Web3.to_checksum_address(address)
        except Exception:
            return address