"""
POST /api/v1/public/featured-wisdom — Featured wisdom for public discovery.

Hybrid selection logic:
  - 60% trending: high sentiment wisdom from last 7 days
  - 30% all-time: highest quality wisdom ever
  - 10% wildcard: random unique niches for discovery

This endpoint powers "Featured Wisdom" showcase for non-authenticated users,
driving engagement and conversion to wallet-connected state.
"""

import logging
import re
import time
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException
from google.cloud.firestore_v1.base_query import FieldFilter
from pydantic import BaseModel
from web3 import Web3

from core.config import settings
from core.database import get_db
from core.pending_spawn import is_pending

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/public", tags=["public"])

AGENTS_COLLECTION = "agents"
EVENTS_COLLECTION = "agent_events"
PROPOSALS_COLLECTION = "proposals"

# Patterns that mark internal QA / E2E test artifacts, not showcase material.
# Shared by every public endpoint that surfaces agent identity — fix once at
# the source instead of patching each endpoint separately.
_TEST_PATTERNS = re.compile(
    r"(?i)\b(e2e[\s-]*test|trysepolia|qa[\s-]*test|smoke[\s-]*test|"
    r"test[\s-]*(event|agent|spawn|mint)|demo[\s-]*(event|agent))\b"
)


def _is_internal_test(agent_name: str, event_title: str = "") -> bool:
    """True if this agent/event looks like an internal QA/test artifact."""
    blob = f"{agent_name} {event_title}".strip()
    if not blob:
        return False
    return bool(_TEST_PATTERNS.search(blob))


class FeaturedWisdomItem(BaseModel):
    """A single featured wisdom card for public showcase."""
    event_id: str       # agent_events doc id — needed to submit feedback
    event_title: str
    wisdom_summary: str
    agent_name: str
    agent_id: str
    niche: str
    platform: str
    chain_id: int = 5003  # which chain the NFT was minted on — read from event doc
    attended_at: float
    tx_hash: str | None = None
    token_id: str | None = None
    wisdom_quality_score: float = 0.0  # 0-100, based on length + key phrases
    category: str  # "trending", "quality", "wildcard"


class PublicMetricsResponse(BaseModel):
    """Global aggregate metrics for public users."""
    total_agents: int
    total_wisdom_nfts: int
    total_events_attended: int
    average_agent_level: float
    global_wisdom_index: float
    total_bred_agents: int = 0
    total_proposals_approved: int = 0


@router.get("/featured-wisdom", response_model=list[FeaturedWisdomItem])
async def get_featured_wisdom() -> list[FeaturedWisdomItem]:
    """
    Return 6 featured wisdom items (60% trending + 30% quality + 10% wildcard).
    
    This is the "storefront" for public users to discover what agents can do.
    No authentication required.
    """
    db = get_db()
    result: list[FeaturedWisdomItem] = []
    
    try:
        # Fetch all events (this is a read-heavy query, consider caching in production)
        all_events: list[dict] = []
        async for doc in db.collection(EVENTS_COLLECTION).stream():
            event_data = doc.to_dict() or {}
            event_data["doc_id"] = doc.id
            all_events.append(event_data)
        
        if not all_events:
            logger.warning("No events found for featured wisdom showcase")
            return []
        
        # Fetch corresponding agent names + niches for enrichment
        agent_cache: dict[str, str] = {}       # agent_id -> agent_name
        agent_niche_cache: dict[str, str] = {} # agent_id -> niche
        async for doc in db.collection(AGENTS_COLLECTION).stream():
            agent_data = doc.to_dict() or {}
            if "agent_id" in agent_data and "agent_name" in agent_data:
                agent_cache[agent_data["agent_id"]] = agent_data.get("agent_name", "Anonymous")
                agent_niche_cache[agent_data["agent_id"]] = agent_data.get("niche", "General")
        
        def _extract_name_from_summary(summary: str) -> str | None:
            """Parse agent name from legacy wisdom summaries: "Agent 'Name' attended ..." """
            m = re.search(r"Agent '([^']+)' attended", summary)
            return m.group(1) if m else None

        # Calculate wisdom quality score (based on summary length + keyword presence)
        def score_wisdom_quality(summary: str) -> float:
            """Simple heuristic: longer + key phrases = higher quality."""
            if not summary:
                return 0.0
            
            base_score = min(100, len(summary) / 10)  # Cap at 100, one point per 10 chars
            
            # Boost if contains analytical keywords
            keywords = ["key insight", "critical", "analysis", "framework", "pattern", "strategy", "deep dive"]
            keyword_hits = sum(1 for kw in keywords if kw.lower() in summary.lower())
            keyword_boost = min(30, keyword_hits * 5)  # Up to +30 from keywords
            
            return min(100, base_score + keyword_boost)
        
        # Categorize events
        now = time.time()
        seven_days_ago = now - (7 * 24 * 3600)
        
        trending: list[FeaturedWisdomItem] = []
        quality: list[FeaturedWisdomItem] = []
        wildcard_by_niche: dict[str, list[FeaturedWisdomItem]] = {}
        
        for event in all_events:
            attended_at = event.get("attended_at", 0)
            agent_id = event.get("agent_id", "")

            # Filter out internal QA/test events before public showcase.
            # Keeps the public feed honest — "real wisdom from real events".
            event_title = event.get("event_title", "")
            agent_name = (
                agent_cache.get(agent_id)
                or event.get("agent_name")
                or _extract_name_from_summary(event.get("wisdom_summary", ""))
                or ""
            )
            if _is_internal_test(agent_name, event_title):
                continue

            wisdom_score = score_wisdom_quality(event.get("wisdom_summary", ""))
            
            item = FeaturedWisdomItem(
                event_id=event.get("doc_id", ""),
                event_title=event_title,
                wisdom_summary=event.get("wisdom_summary", ""),
                agent_name=agent_name or "Anonymous Agent",
                agent_id=agent_id,
                niche=agent_niche_cache.get(agent_id) or event.get("niche") or "General",
                platform=event.get("platform", "YouTube"),
                chain_id=int(event.get("chain_id", 5003)),
                attended_at=attended_at,
                tx_hash=event.get("tx_hash"),
                token_id=event.get("token_id"),
                wisdom_quality_score=wisdom_score,
                category="",  # Will be set below
            )
            
            # Sort into categories
            if attended_at >= seven_days_ago:
                item.category = "trending"
                trending.append(item)
            
            item.category = "quality"
            quality.append(item)
            
            # Collect by niche for wildcard
            niche = item.niche
            if niche not in wildcard_by_niche:
                wildcard_by_niche[niche] = []
            wildcard_by_niche[niche].append(item)
        
        # Sort each category
        trending.sort(key=lambda x: (x.wisdom_quality_score, x.attended_at), reverse=True)
        quality.sort(key=lambda x: x.wisdom_quality_score, reverse=True)
        
        # Build featured set: 60% trending + 30% quality + 10% wildcard
        target_trending = max(1, int(6 * 0.6))  # 3-4
        target_quality = max(1, int(6 * 0.3))   # 1-2
        target_wildcard = 6 - target_trending - target_quality  # remainder
        
        # Add trending
        result.extend(trending[:target_trending])
        
        # Add quality (skip if already in trending by avoiding duplicates)
        trending_ids = {e.event_title for e in result}
        for q in quality:
            if q.event_title not in trending_ids and len([r for r in result if r.category == "quality"]) < target_quality:
                result.append(q)
                trending_ids.add(q.event_title)
        
        # Add wildcard: prioritize rare niches
        niche_counts = {}
        for item in result:
            niche_counts[item.niche] = niche_counts.get(item.niche, 0) + 1
        
        # Pick wildcard from under-represented niches
        wildcard_candidates: list[FeaturedWisdomItem] = []
        for niche, items in wildcard_by_niche.items():
            if niche_counts.get(niche, 0) < 2:  # Underrepresented
                wildcard_candidates.extend(items)
        
        wildcard_candidates.sort(key=lambda x: x.wisdom_quality_score, reverse=True)
        for wc in wildcard_candidates[:target_wildcard]:
            if len([r for r in result if r.category == "wildcard"]) < target_wildcard:
                wc.category = "wildcard"
                result.append(wc)
        
        # Trim to exactly 6 and shuffle for variety
        result = result[:6]
        
        logger.info(
            "Featured wisdom: %d trending, %d quality, %d wildcard",
            len([r for r in result if r.category == "trending"]),
            len([r for r in result if r.category == "quality"]),
            len([r for r in result if r.category == "wildcard"]),
        )
        
        return result
        
    except Exception as exc:
        logger.error("Failed to fetch featured wisdom: %s", exc)
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")


@router.get("/metrics", response_model=PublicMetricsResponse)
async def get_public_metrics() -> PublicMetricsResponse:
    """
    Global aggregate metrics for public dashboard.
    
    Cached metrics (no auth required) showing ecosystem health.
    """
    db = get_db()
    
    try:
        # Count agents
        total_agents = 0
        total_level_sum = 0.0
        async for agent_doc in db.collection(AGENTS_COLLECTION).stream():
            # An unconfirmed spawn attempt is not an agent.
            if not is_pending(agent_doc.to_dict() or {}):
                total_agents += 1
        
        # Count wisdom NFTs, events, and bred agents
        total_wisdom_nfts = 0
        total_events = 0
        total_bred_agents = 0
        async for doc in db.collection(AGENTS_COLLECTION).stream():
            agent_data = doc.to_dict() or {}
            total_events += agent_data.get("total_events", 0)
            total_level_sum += agent_data.get("level", 1)
            if agent_data.get("ownership_status") == "bred":
                total_bred_agents += 1

        async for doc in db.collection(EVENTS_COLLECTION).stream():
            if doc.to_dict():
                total_wisdom_nfts += 1

        # Count approved strategic proposals (HITL governance)
        total_proposals_approved = 0
        async for doc in db.collection(PROPOSALS_COLLECTION).where(
            filter=FieldFilter("status", "==", "approved")
        ).stream():
            if doc.to_dict():
                total_proposals_approved += 1

        # Calculate global wisdom index
        avg_level = total_level_sum / max(1, total_agents)
        global_wisdom_index = (total_wisdom_nfts * avg_level)

        return PublicMetricsResponse(
            total_agents=total_agents,
            total_wisdom_nfts=total_wisdom_nfts,
            total_events_attended=total_events,
            average_agent_level=round(avg_level, 2),
            global_wisdom_index=round(global_wisdom_index, 1),
            total_bred_agents=total_bred_agents,
            total_proposals_approved=total_proposals_approved,
        )
        
    except Exception as exc:
        logger.error("Failed to fetch public metrics: %s", exc)
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")


class PublicAgentItem(BaseModel):
    """A single real agent profile for the landing page showcase."""
    agent_name: str
    niche: str
    level: int
    total_events: int
    chain_id: int
    generation: int
    ownership_status: str


@router.get("/agents", response_model=list[PublicAgentItem])
async def get_public_agents() -> list[PublicAgentItem]:
    """
    Top 6 most-active real agents, for the landing page "Agent Showcase".

    No authentication required. Excludes internal QA/test agents via the
    same _is_internal_test() filter used by /featured-wisdom.
    """
    db = get_db()

    try:
        agents: list[PublicAgentItem] = []
        async for doc in db.collection(AGENTS_COLLECTION).stream():
            data = doc.to_dict() or {}
            agent_name = data.get("agent_name", "")
            if _is_internal_test(agent_name) or is_pending(data):
                continue

            agents.append(PublicAgentItem(
                agent_name=agent_name or "Anonymous Agent",
                niche=data.get("niche", "General"),
                level=int(data.get("level", 1)),
                total_events=int(data.get("total_events", 0)),
                chain_id=int(data.get("chain_id", 5003)),
                generation=int(data.get("generation", 1)),
                ownership_status=data.get("ownership_status", "original-creator"),
            ))

        agents.sort(key=lambda a: a.total_events, reverse=True)
        return agents[:6]

    except Exception as exc:
        logger.error("Failed to fetch public agents: %s", exc)
        raise HTTPException(status_code=503, detail="Database temporarily unavailable")
