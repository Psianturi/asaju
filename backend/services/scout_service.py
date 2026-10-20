"""Secretary sub-agent: rational YouTube event discovery for autonomous agents."""

import asyncio
import datetime
import html
import json
import logging
import re
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
_NEUTRAL_CUSTOM_INSTRUCTIONS = (
    "No special owner directive. Optimize for the agent's niche and practical learning value."
)
_SHORTLIST_SIZE = 5
_TOPIC_OVERLAP_THRESHOLD = 0.6

# Primary and fallback queries per niche
_NICHE_QUERIES: dict[str, list[str]] = {
    "Blockchain/DeFi": [
        "blockchain DeFi summit webinar 2026",
        "crypto decentralized finance conference talk",
    ],
    "Trading/Investment": [
        "crypto trading strategy analysis webinar 2026",
        "algorithmic trading conference workshop",
    ],
    "Technology": [
        "AI technology developer conference 2026",
        "software engineering summit workshop",
    ],
    "Health/Wellness": [
        "health wellness innovation summit 2026",
        "mental health conference workshop",
    ],
    "General": [
        "technology innovation summit webinar 2026",
        "startup product conference talk",
    ],
}


async def search_youtube(
    niche: str,
    max_results: int = 10,
    published_after_days: int = 30,
    additional_niches: list[str] | None = None,
) -> list[dict]:
    """
    Search YouTube for long-form videos in the agent's niche.
    Returns list of candidate dicts: {video_id, title, description, channel, url}.
    When additional_niches provided (Cross-Domain Intelligence trait), also searches those niches.
    """
    from core.secrets import get_youtube_api_key

    api_key = get_youtube_api_key()
    if not api_key:
        raise RuntimeError("YOUTUBE_API_KEY not configured — cannot run Auto Scout")

    cutoff = (
        datetime.datetime.utcnow() - datetime.timedelta(days=published_after_days)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")

    queries = list(_NICHE_QUERIES.get(niche, _NICHE_QUERIES["General"]))
    if additional_niches:
        for extra_niche in additional_niches:
            for q in _NICHE_QUERIES.get(extra_niche, []):
                if q not in queries:
                    queries.append(q)
    # Expand candidate pool when cross-domain to account for extra queries
    search_max = max_results + 5 * len(additional_niches or [])

    candidates: list[dict] = []
    seen_ids: set[str] = set()
    quota_limited = False

    for query in queries:
        params = {
            "key": api_key,
            "q": query,
            "part": "snippet",
            "type": "video",
            "videoDuration": "long",   # > 20 min — webinars, conferences
            "publishedAfter": cutoff,
            "maxResults": max_results,
            "relevanceLanguage": "en",
            "order": "relevance",
        }
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(_YOUTUBE_SEARCH_URL, params=params)
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPStatusError as exc:
            logger.warning("YouTube search HTTP error (query=%r): %s", query, exc.response.status_code)
            if exc.response.status_code in (403, 429):
                quota_limited = True
            continue
        except Exception as exc:
            logger.warning("YouTube search failed (query=%r): %s", query, type(exc).__name__)
            continue

        for item in data.get("items", []):
            video_id = item.get("id", {}).get("videoId", "")
            if not video_id or video_id in seen_ids:
                continue
            seen_ids.add(video_id)
            snippet = item.get("snippet", {})
            candidates.append({
                "video_id": video_id,
                # The search API returns these HTML-escaped ("&amp;", "&#39;").
                "title": html.unescape(snippet.get("title", "Untitled")),
                "description": html.unescape(snippet.get("description", ""))[:300],
                "channel": html.unescape(snippet.get("channelTitle", "")),
                "published_at": snippet.get("publishedAt", ""),
                "url": f"https://www.youtube.com/watch?v={video_id}",
            })

        if len(candidates) >= search_max:
            break

    if not candidates and quota_limited:
        raise RuntimeError("YOUTUBE_API_LIMIT: YouTube API quota exceeded or temporarily unavailable")

    logger.info(
        "Secretary: found %d YouTube candidates for niche '%s'%s",
        len(candidates), niche,
        f" + cross-domain {additional_niches}" if additional_niches else "",
    )
    return candidates


def _tokenize(text: str) -> set[str]:
    return {
        token
        for token in re.findall(r"[a-z0-9]{4,}", text.lower())
        if token not in {"with", "from", "that", "this", "have", "your", "about", "into", "their"}
    }


def _topic_overlap_ratio(candidate_text: str, historical_text: str) -> float:
    candidate_tokens = _tokenize(candidate_text)
    historical_tokens = _tokenize(historical_text)
    if not candidate_tokens or not historical_tokens:
        return 0.0
    intersection = len(candidate_tokens & historical_tokens)
    baseline = min(len(candidate_tokens), len(historical_tokens))
    return intersection / baseline if baseline else 0.0


def _is_duplicate_topic(candidate: dict[str, Any], recent_topics: list[str]) -> bool:
    candidate_text = f"{candidate.get('title', '')} {candidate.get('description', '')}"
    return any(
        _topic_overlap_ratio(candidate_text, historical_text) >= _TOPIC_OVERLAP_THRESHOLD
        for historical_text in recent_topics
    )


def _parse_published_at(value: str) -> datetime.datetime | None:
    if not value:
        return None
    try:
        return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _heuristic_score_candidate(candidate: dict[str, Any], custom_instructions: str | None) -> dict[str, Any]:
    transcript_available = bool(candidate.get("transcript_preview"))
    niche_tokens = _tokenize(candidate.get("title", "") + " " + candidate.get("description", ""))
    custom_tokens = _tokenize(custom_instructions or "")

    base_niche_score = min(70, 42 + min(28, len(niche_tokens) // 2))
    custom_instruction_bonus = min(20, len(niche_tokens & custom_tokens) * 4) if custom_tokens else 0

    freshness_bonus = 0
    published_at = _parse_published_at(candidate.get("published_at", ""))
    if transcript_available:
        freshness_bonus += 6
    if published_at and (datetime.datetime.now(datetime.timezone.utc) - published_at).days <= 10:
        freshness_bonus += 4
    freshness_bonus = min(10, freshness_bonus)

    score = min(100, base_niche_score + custom_instruction_bonus + freshness_bonus)
    return {
        "base_niche_score": int(base_niche_score),
        "custom_instruction_bonus": int(custom_instruction_bonus),
        "freshness_bonus": int(freshness_bonus),
        "score": int(score),
        "reason_code": "MINTED",
        "justification": "Fallback heuristic score based on niche relevance, custom alignment, and transcript freshness.",
    }


async def _score_candidates_with_gemini(
    candidates: list[dict[str, Any]],
    *,
    niche: str,
    agent_name: str,
    custom_instructions: str | None,
) -> list[dict[str, Any]]:
    from core.secrets import get_llm_api_key
    from services.llm_service import _call_gemini_with_retry

    instruction_text = custom_instructions.strip() if custom_instructions and custom_instructions.strip() else _NEUTRAL_CUSTOM_INSTRUCTIONS
    candidates_text = "\n".join(
        (
            f"{idx + 1}. title={candidate['title']} | channel={candidate['channel']} | "
            f"published_at={candidate.get('published_at', '')} | transcript_available={bool(candidate.get('transcript_preview'))} | "
            f"summary={candidate['description'][:160]} | transcript_preview={candidate.get('transcript_preview', '')[:180]}"
        )
        for idx, candidate in enumerate(candidates)
    )

    prompt = (
        "You are evaluating YouTube events for a Web3 autonomous agent.\n\n"
        f"Agent: {agent_name}\n"
        f"Niche: {niche}\n"
        f"Custom instructions: {instruction_text}\n\n"
        "Score each candidate independently using this weighted matrix:\n"
        "- base_niche_score: 0..70 for core domain relevance to the niche\n"
        "- custom_instruction_bonus: 0..20 for alignment with custom owner directives\n"
        "- freshness_bonus: 0..10 for novelty, recency, and transcript richness\n"
        "- score: exact sum of the three values above, capped at 100\n\n"
        "Return ONLY valid JSON with this exact shape:\n"
        '{"scored_candidates":[{"index":1,"base_niche_score":60,"custom_instruction_bonus":10,"freshness_bonus":8,"score":78,"reason_code":"MINTED","justification":"..."}]}\n\n'
        "Rules:\n"
        "- Keep score mathematically consistent with its components\n"
        "- Preserve the agent's niche identity even if custom instructions are off-domain\n"
        "- Use reason_code=MINTED for passing candidates; the caller will decide thresholds\n"
        "- Prefer substantive, educational, non-redundant videos\n\n"
        f"Candidates:\n{candidates_text}"
    )

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.2,
        },
    }

    result = await _call_gemini_with_retry(
        api_key=get_llm_api_key(),
        payload=payload,
        timeout=25,
        context="secretary_weighted_scoring",
    )
    parts = result["candidates"][0]["content"]["parts"]
    raw = next((p["text"].strip() for p in reversed(parts) if p.get("text", "").strip()), "")
    parsed = json.loads(raw)

    scored_by_index = {
        int(item["index"]): item
        for item in parsed.get("scored_candidates", [])
        if str(item.get("index", "")).isdigit()
    }

    scored_candidates: list[dict[str, Any]] = []
    for idx, candidate in enumerate(candidates, start=1):
        raw_item = scored_by_index.get(idx)
        if raw_item is None:
            fallback = _heuristic_score_candidate(candidate, custom_instructions)
            scored_candidates.append({**candidate, **fallback})
            continue

        base_niche_score = max(0, min(70, int(raw_item.get("base_niche_score", 0))))
        custom_instruction_bonus = max(0, min(20, int(raw_item.get("custom_instruction_bonus", 0))))
        freshness_bonus = max(0, min(10, int(raw_item.get("freshness_bonus", 0))))
        score = min(100, base_niche_score + custom_instruction_bonus + freshness_bonus)
        scored_candidates.append(
            {
                **candidate,
                "base_niche_score": base_niche_score,
                "custom_instruction_bonus": custom_instruction_bonus,
                "freshness_bonus": freshness_bonus,
                "score": score,
                "reason_code": raw_item.get("reason_code", "MINTED"),
                "justification": str(raw_item.get("justification", "")).strip(),
            }
        )

    scored_candidates.sort(key=lambda item: item.get("score", 0), reverse=True)
    return scored_candidates


def _threshold_for_balance(balance: float, provision: float) -> int:
    """Score an agent's pick must reach before it spends gas, by how full its
    wallet is relative to this chain's starting provision.

    The old absolute cut-offs (0.15 / 0.08 MNT) only made sense on Mantle; on
    chains whose provision is far smaller, every agent read as nearly empty and
    needed 95/100, so Auto Scout skipped almost everything. The ratios below
    reproduce the Mantle behaviour (0.15 and 0.08 of a 0.5 provision).
    """
    ratio = balance / provision if provision > 0 else 0.0
    if ratio >= 0.30:
        return 80
    if ratio >= 0.16:
        return 90
    return 95


async def discover_event(
    agent_id: str,
    niche: str,
    agent_name: str,
    agent_wallet: str,
    custom_instructions: str | None = None,
    additional_niches: list[str] | None = None,
    chain_id: int = 5003,
) -> dict[str, Any]:
    """Full Secretary workflow with hybrid filtering, RPC gas thresholding, and rational skip decisions."""
    from core.database import get_db
    from google.cloud.firestore_v1.base_query import FieldFilter
    from services.llm_service import _fetch_youtube_transcript
    from services.web3_service import web3_service

    db = get_db()
    attended_urls: set[str] = set()
    recent_topics: list[str] = []
    try:
        historical_events: list[dict[str, Any]] = []
        async for doc in (
            db.collection("agent_events")
            .where(filter=FieldFilter("agent_id", "==", agent_id))
            .stream()
        ):
            data = doc.to_dict() or {}
            url = data.get("event_url", "")
            if url:
                attended_urls.add(url)
            historical_events.append(data)

        historical_events.sort(
            key=lambda item: item.get("attended_at") or item.get("date") or item.get("created_at") or 0,
            reverse=True,
        )
        recent_topics = [
            f"{item.get('event_title', '')} {item.get('wisdom_summary', '')}".strip()
            for item in historical_events[:3]
            if item.get("event_title") or item.get("wisdom_summary")
        ]
    except Exception as exc:
        logger.warning("Could not fetch attended URLs for dedup: %s", type(exc).__name__)

    candidates = await search_youtube(niche=niche, additional_niches=additional_niches)
    if not candidates:
        return {
            "status": "skipped",
            "reason_code": "NO_NEW_EVENTS",
            "message": "Secretary found no new candidates from YouTube search.",
        }

    unattended = [candidate for candidate in candidates if candidate["url"] not in attended_urls]
    if not unattended:
        logger.info("Secretary: all candidates already attended, nothing new to scout")
        return {
            "status": "skipped",
            "reason_code": "NO_NEW_EVENTS",
            "message": "All candidate URLs were already attended by this agent.",
        }

    non_duplicate = [candidate for candidate in unattended if not _is_duplicate_topic(candidate, recent_topics)]
    if not non_duplicate:
        duplicate_candidate = unattended[0]
        return {
            "status": "skipped",
            "reason_code": "DUPLICATE_TOPIC",
            "message": "Top discovered candidates were too similar to the agent's recent attended topics.",
            "candidate": duplicate_candidate,
        }

    shortlist = non_duplicate[:_SHORTLIST_SIZE]
    transcripts = await asyncio.gather(
        *[_fetch_youtube_transcript(candidate["url"]) for candidate in shortlist],
        return_exceptions=True,
    )

    enriched_shortlist: list[dict[str, Any]] = []
    for candidate, transcript in zip(shortlist, transcripts):
        enriched = dict(candidate)
        if isinstance(transcript, str) and transcript:
            enriched["transcript_preview"] = transcript[:240]
        else:
            enriched["transcript_preview"] = ""
        enriched_shortlist.append(enriched)

    try:
        scored_candidates = await _score_candidates_with_gemini(
            enriched_shortlist,
            niche=niche,
            agent_name=agent_name,
            custom_instructions=custom_instructions,
        )
    except Exception as exc:
        logger.warning("Gemini scoring failed (%s); using heuristic fallback", type(exc).__name__)
        scored_candidates = [
            {**candidate, **_heuristic_score_candidate(candidate, custom_instructions)}
            for candidate in enriched_shortlist
        ]
        scored_candidates.sort(key=lambda item: item.get("score", 0), reverse=True)

    if not scored_candidates:
        return {
            "status": "skipped",
            "reason_code": "LLM_UNAVAILABLE",
            "message": "Candidate scoring returned no usable result.",
        }

    try:
        # The agent's own chain: reading Mantle for a BNB or Robinhood agent
        # returned 0 and pinned every run to the strictest threshold.
        agent_gas_balance = await web3_service.get_native_balance(agent_wallet, chain_id)
    except Exception as exc:
        logger.warning("Secretary RPC balance check failed for %s: %s", agent_id, type(exc).__name__)
        return {
            "status": "skipped",
            "reason_code": "RPC_UNAVAILABLE",
            "message": f"Failed to read the agent's gas balance on chain {chain_id} before the decision gate.",
            "error": str(exc),
        }
    try:
        provision = await web3_service.get_agent_provision(chain_id)
    except Exception as exc:
        logger.warning("agentProvision read failed for chain %d (%s); assuming 0.5", chain_id, type(exc).__name__)
        provision = 0.5

    threshold = _threshold_for_balance(agent_gas_balance, provision)
    top_candidate = scored_candidates[0]
    top_candidate["threshold_applied"] = threshold
    top_candidate["agent_gas_balance"] = agent_gas_balance
    top_candidate["scout_reason"] = top_candidate.get("justification", "")

    if int(top_candidate.get("score", 0)) < threshold:
        return {
            "status": "skipped",
            "reason_code": "LOW_SCORE",
            "message": (
                f"Score {int(top_candidate.get('score', 0))}/100 is below the active threshold "
                f"of {threshold}; execution halted to preserve gas."
            ),
            "candidate": top_candidate,
            "score": int(top_candidate.get("score", 0)),
            "threshold_applied": threshold,
            "agent_gas_balance": agent_gas_balance,
        }

    logger.info(
        "Secretary selected '%s' with score=%d threshold=%d balance=%.4f",
        top_candidate["title"],
        int(top_candidate.get("score", 0)),
        threshold,
        agent_gas_balance,
    )
    return {
        "status": "ready_to_mint",
        "candidate": top_candidate,
        "score": int(top_candidate.get("score", 0)),
        "threshold_applied": threshold,
        "agent_gas_balance": agent_gas_balance,
    }
