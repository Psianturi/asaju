"""
GET /api/v1/monitoring/gas-status/{agent_wallet}  — Check agent gas balance & minting capacity
GET /api/v1/monitoring/spawn-quota/{user_wallet}  — Check user's per-chain spawn quota (max 3 direct spawns)

Read-only monitoring endpoints for frontend visibility.
"""

import logging

from fastapi import APIRouter, HTTPException, Query
from google.cloud.firestore_v1.base_query import FieldFilter
from web3 import Web3

from core.database import get_db
from core.config import get_chain_config
from core.pending_spawn import confirm_on_chain, is_direct, is_pending
from services.web3_service import web3_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/monitoring", tags=["monitoring"])

AGENTS_COLLECTION = "agents"


@router.get("/gas-status/{agent_wallet}")
async def get_agent_gas_status(agent_wallet: str, chain_id: int = Query(default=5003)) -> dict:
    """
    Read-only endpoint: check agent's gas balance and minting capacity.
    Returns status (healthy/warning/critical) based on balance thresholds.
    
    Response shows:
    - Current balance in MNT and wei
    - Status indicator (healthy/warning/critical/depleted)
    - Can agent still mint NFTs?
    - Estimated remaining mints based on gas consumption
    """
    if not Web3.is_address(agent_wallet):
        raise HTTPException(status_code=400, detail="Invalid agent wallet address")
    agent_wallet = Web3.to_checksum_address(agent_wallet)
    try:
        chain_config = get_chain_config(chain_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        balance_wei = await web3_service.get_balance(agent_wallet, chain_id)
        balance_mnt = Web3.from_wei(balance_wei, "ether")
    except ConnectionError as exc:
        logger.error("RPC connection failed for %s: %s", agent_wallet, exc)
        raise HTTPException(status_code=503, detail="Blockchain RPC temporarily unavailable")
    except ValueError as exc:
        logger.error("Invalid wallet address for %s: %s", agent_wallet, exc)
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.error("Unexpected error fetching balance for %s: %s", agent_wallet, exc, exc_info=True)
        raise HTTPException(status_code=503, detail=f"Blockchain query failed: {str(exc)}")

    # Thresholds are relative to this chain's agentProvision (read live from the
    # contract — not a hardcoded absolute number). A freshly-spawned agent on ANY
    # chain starts at 100% of its provision; "healthy" means still close to that,
    # regardless of whether the chain's whole economy runs on 0.01 ETH or 0.5 MNT.
    try:
        agent_provision = await web3_service.get_agent_provision(chain_id)
    except Exception as exc:
        logger.warning("Could not read agentProvision for chain %d, using 0.5 fallback: %s", chain_id, exc)
        agent_provision = 0.5

    HEALTHY_THRESHOLD = agent_provision * 0.5
    WARNING_THRESHOLD = agent_provision * 0.2
    CRITICAL_THRESHOLD = agent_provision * 0.05

    if balance_mnt >= HEALTHY_THRESHOLD:
        status = "healthy"
    elif balance_mnt >= WARNING_THRESHOLD:
        status = "warning"
    elif balance_mnt >= CRITICAL_THRESHOLD:
        status = "critical"
    else:
        status = "depleted"

    # Rough estimate: a mint costs ~4% of a fresh provision, all chains considered
    gas_per_mint = max(agent_provision * 0.04, 1e-9)
    estimated_mints = int(float(balance_mnt) / gas_per_mint) if balance_mnt > 0 else 0

    return {
        "agent_wallet": agent_wallet,
        "chain_id": chain_id,
        "native_symbol": chain_config["native_symbol"],
        "gas_balance_wei": str(balance_wei),
        "gas_balance_mnt": f"{balance_mnt:.4f}",
        "status": status,
        "can_mint": balance_mnt >= CRITICAL_THRESHOLD,
        "estimated_mints_remaining": estimated_mints,
        "thresholds": {
            "healthy": f"{HEALTHY_THRESHOLD:.4f}",
            "warning": f"{WARNING_THRESHOLD:.4f}",
            "critical": f"{CRITICAL_THRESHOLD:.4f}",
        },
    }


@router.get("/spawn-quota/{user_wallet}")
async def get_spawn_quota(user_wallet: str, chain_id: int = Query(default=5003)) -> dict:
    """
    Read-only endpoint: check how many agents user has spawned on a chain (max 3 direct spawns).
    Bred offspring are excluded from the count (ownership_status != 'bred').
    
    Response shows:
    - Current spawn count vs. max limit (3)
    - Remaining slots available
    - Can user spawn another agent?
    - List of directly spawned agents
    """
    if not Web3.is_address(user_wallet):
        raise HTTPException(status_code=400, detail="Invalid wallet address")
    user_wallet = Web3.to_checksum_address(user_wallet)
    try:
        get_chain_config(chain_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    MAX_SPAWN_LIMIT = 3
    db = get_db()

    try:
        query = db.collection(AGENTS_COLLECTION).where(filter=FieldFilter("user_wallet", "==", user_wallet))
        docs = await query.get()
    except Exception as exc:
        logger.error("Firestore query failed for wallet %s: %s", user_wallet, exc)
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")

    spawned_agents = []
    for doc in docs:
        data = doc.to_dict() or {}
        # Count only direct spawns confirmed on-chain (same rule /agent/spawn enforces)
        if is_direct(data) and data.get("chain_id", 5003) == chain_id:
            if is_pending(data) and await confirm_on_chain(db, AGENTS_COLLECTION, data) is not True:
                continue
            spawned_agents.append({
                "agent_wallet": data.get("agent_wallet"),
                "agent_name": data.get("agent_name"),
                "spawned_at": data.get("created_at"),
            })

    spawned_count = len(spawned_agents)
    remaining_slots = max(0, MAX_SPAWN_LIMIT - spawned_count)

    return {
        "user_wallet": user_wallet,
        "chain_id": chain_id,
        "spawned_count": spawned_count,
        "max_spawn_limit": MAX_SPAWN_LIMIT,
        "remaining_slots": remaining_slots,
        "can_spawn": spawned_count < MAX_SPAWN_LIMIT,
        "agents": spawned_agents,
    }
