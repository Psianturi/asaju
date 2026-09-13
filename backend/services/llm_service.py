"""
LLM service: generates a "Wisdom Summary" for an attended event using Gemini.

Fetches the real YouTube video transcript and passes it to Gemini so the wisdom
reflects actual content — not just event metadata. Falls back to a metadata-only
prompt when no transcript is available.

Uses the Gemini REST API directly via httpx (no SDK dependency) for minimal
Docker image size and full async support.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx

from core.secrets import get_llm_api_key

logger = logging.getLogger(__name__)


class ProposalGenerationError(Exception):
    """Raised when proposal generation fails due to LLM unavailable or API error."""
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

_GEMINI_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/"
    "gemini-2.5-flash:generateContent"
)

# Max transcript chars sent to Gemini (~700-800 words, well within token budget)
_TRANSCRIPT_MAX_CHARS = 4000

# Retry configuration for transient Gemini API errors
_MAX_RETRIES = 2
_RETRY_DELAY = 1.0  # seconds

# ── Retry helper ──────────────────────────────────────────────────────────────

async def _call_gemini_with_retry(
    api_key: str,
    payload: dict[str, Any],
    timeout: float,
    context: str = "request",
) -> dict[str, Any]:
    """
    Call Gemini API with retry logic for transient errors (404, 503).
    Returns parsed JSON response or raises exception after all retries exhausted.
    """
    last_exc = None

    for attempt in range(_MAX_RETRIES + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(
                    _GEMINI_URL,
                    params={"key": api_key},
                    json=payload,
                )
                resp.raise_for_status()

                # Validate response before parsing
                try:
                    data = resp.json()
                except json.JSONDecodeError as exc:
                    logger.error(
                        "Gemini returned invalid JSON for %s (attempt %d/%d): %s",
                        context, attempt + 1, _MAX_RETRIES + 1, resp.text[:200]
                    )
                    raise ValueError(f"Invalid JSON response from Gemini: {exc}")

                # Gemini sometimes returns HTTP 200 with an error object in the body
                # (e.g. code -32000 = internal server error). Treat as retryable.
                if "error" in data:
                    err = data["error"]
                    code = err.get("code", 0)
                    msg = err.get("message", "Unknown Gemini error")
                    _retryable_body_codes = {-32000, -32001, -32002}
                    if code in _retryable_body_codes and attempt < _MAX_RETRIES:
                        delay = _RETRY_DELAY * (2 ** attempt)
                        logger.warning(
                            "Gemini body error %d for %s (attempt %d/%d) — retrying in %.1fs: %s",
                            code, context, attempt + 1, _MAX_RETRIES + 1, delay, msg
                        )
                        await asyncio.sleep(delay)
                        continue
                    raise ValueError(f"Gemini API error {code}: {msg}")

                # Validate response structure
                if "candidates" not in data or not data["candidates"]:
                    logger.error(
                        "Gemini response missing candidates for %s: %s",
                        context, str(data)[:200]
                    )
                    raise ValueError("Gemini response missing candidates field")

                return data

        except (httpx.HTTPStatusError, httpx.TimeoutException) as exc:
            last_exc = exc
            is_retryable = False

            if isinstance(exc, httpx.HTTPStatusError):
                status = exc.response.status_code
                is_retryable = status in (404, 503, 500, 502, 504)
                logger.warning(
                    "Gemini HTTP %d for %s (attempt %d/%d): %s",
                    status, context, attempt + 1, _MAX_RETRIES + 1,
                    exc.response.text[:200]
                )
            elif isinstance(exc, httpx.TimeoutException):
                is_retryable = True
                logger.warning(
                    "Gemini timeout for %s (attempt %d/%d)",
                    context, attempt + 1, _MAX_RETRIES + 1
                )

            # Retry if error is transient and we have attempts left
            if is_retryable and attempt < _MAX_RETRIES:
                delay = _RETRY_DELAY * (2 ** attempt)  # exponential backoff
                logger.info("Retrying in %.1fs...", delay)
                await asyncio.sleep(delay)
                continue

            # Not retryable or out of retries
            raise

        except ValueError:
            # JSON decode error or validation error — not retryable
            raise

        except Exception as exc:
            logger.error("Unexpected Gemini error for %s: %s", context, exc.__class__.__name__)
            raise

    # Should never reach here, but for type safety
    if last_exc:
        raise last_exc
    raise RuntimeError("Retry loop exhausted without result")

# ── Prompt templates ──────────────────────────────────────────────────────────

_PROMPT_WITH_TRANSCRIPT = """\
You are an autonomous AI agent that just attended a Web3/tech event.
You have access to the actual transcript from this event.
Generate a concise "Wisdom Summary" — exactly 2-3 sentences — capturing the most \
valuable insights a blockchain AI agent would gain from this content.
Focus on: Web3 concepts, AI/agentic systems, DeFi, NFTs, developer tools, key \
announcements, or actionable insights found in the transcript.

Event Title  : {event_title}
Platform     : {platform}
Transcript   :
{transcript}

Return ONLY the wisdom summary text. No bullet points, no preamble, no labels.\
"""

_PROMPT_METADATA_ONLY = """\
You are an autonomous AI agent that just attended a Web3/tech or wellness event.
Generate a concise "Wisdom Summary" — exactly 2-3 sentences — capturing the most \
valuable insights a blockchain AI agent would gain from this event.
Focus on: Web3 concepts, AI/agentic systems, DeFi, NFTs, or developer tools mentioned.

Event Title : {event_title}
Event URL   : {event_url}
Platform    : {platform}

Return ONLY the wisdom summary text. No bullet points, no preamble, no labels.\
"""

_FALLBACK_TEMPLATE = (
    "Agent '{agent_name}' attended '{event_title}' on {platform} and integrated "
    "key insights into its knowledge base. Core Web3 and agentic concepts from the "
    "event were recorded as on-chain wisdom for future decision-making."
)

# ── YouTube transcript helpers ────────────────────────────────────────────────

try:
    from youtube_transcript_api import YouTubeTranscriptApi
    _YT_AVAILABLE = True
except ImportError:
    _YT_AVAILABLE = False
    logger.warning("youtube-transcript-api not installed — transcript fetch disabled")

def _extract_video_id(url: str) -> str | None:
    """Extract YouTube video ID from watch, live, shorts, embed, or youtu.be URLs."""
    try:
        parsed = urlparse(url)
    except Exception:
        return None

    host = (parsed.hostname or "").lower()

    if host == "youtu.be":
        return parsed.path.lstrip("/").split("?")[0] or None

    if host in ("youtube.com", "www.youtube.com"):
        qs = parse_qs(parsed.query)
        if "v" in qs:
            return qs["v"][0]
        # /live/ID  /shorts/ID  /embed/ID
        parts = [p for p in parsed.path.split("/") if p]
        if len(parts) >= 2 and parts[0] in ("live", "shorts", "embed"):
            return parts[1]

    return None


def _fetch_transcript_sync(video_id: str) -> str | None:
    """Sync fetch — runs in a thread executor to avoid blocking the event loop."""
    if not _YT_AVAILABLE:
        return None
    try:
        entries = YouTubeTranscriptApi.get_transcript(video_id, languages=["en", "id", "en-US"])
        text = " ".join(e["text"] for e in entries)
        return text[:_TRANSCRIPT_MAX_CHARS] if len(text) > _TRANSCRIPT_MAX_CHARS else text
    except Exception as exc:
        logger.debug("Transcript unavailable for video %s: %s", video_id, exc)
        return None


async def _fetch_youtube_transcript(url: str) -> str | None:
    """Async wrapper: extract video ID then fetch transcript in thread executor."""
    video_id = _extract_video_id(url)
    if not video_id:
        return None
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _fetch_transcript_sync, video_id)


# ── Wisdom report generation ──────────────────────────────────────────────────

_WISDOM_PROMPT = """\
You are an AI analyst specializing in {niche}.

An autonomous AI agent attended {count} events. Here are the event titles and learnings:

{summaries}

Generate a wisdom report strictly grounded in the events listed above. Rules:
- Each insight MUST reference at least one specific event title from the list.
- Do NOT produce generic statements like "Market momentum shows growth" — be event-specific.
- strategic_tips must recommend concrete actions inspired by what was learned in these exact events.

Return a JSON object with exactly this structure:
{{
  "insights": ["insight1", "insight2", "insight3", "insight4", "insight5"],
  "strategic_tips": ["tip1", "tip2", "tip3", "tip4"]
}}

insights: 5 specific observations, each naming or referencing a concrete event title or concept from the summaries above.
strategic_tips: 4 forward-looking actionable recommendations grounded in the {niche} domain and the specific events attended.\
"""

_WISDOM_FALLBACK = {
    "insights": [
        "Cross-event analysis reveals emerging patterns in the niche",
        "Market momentum shows continued growth in key sectors",
        "Strategic opportunities identified across multiple attended events",
        "Community sentiment indicates positive trend continuation",
        "Risk-adjusted metrics suggest favorable positioning ahead",
    ],
    "strategic_tips": [
        "Diversify exposure across multiple protocols and platforms",
        "Monitor emerging trends identified in attended events for early positioning",
        "Implement strategic timing based on patterns from event analysis",
        "Leverage cross-platform opportunities for enhanced returns",
    ],
}


async def generate_wisdom_report(niche: str, event_summaries: list[str]) -> dict:
    """
    Generate a structured wisdom report from a list of event summaries.
    Returns dict with 'insights' and 'strategic_tips' lists.
    Falls back to generic content on error.
    """
    if not event_summaries:
        return _WISDOM_FALLBACK

    try:
        api_key = get_llm_api_key()
    except RuntimeError:
        return _WISDOM_FALLBACK

    summaries_text = "\n\n".join(
        f"Event {i + 1}: {s}" for i, s in enumerate(event_summaries)
    )
    prompt = _WISDOM_PROMPT.format(
        niche=niche,
        count=len(event_summaries),
        summaries=summaries_text,
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.62,
            "maxOutputTokens": 2048,
            "topP": 0.9,
            "responseMimeType": "application/json",  # Force raw JSON output, no markdown fences
        },
    }

    try:
        data = await _call_gemini_with_retry(
            api_key, payload, timeout=30.0, context=f"wisdom report ({niche})"
        )
        # gemini-2.5-flash is a thinking model: parts[0] = thought tokens, parts[-1] = actual response
        parts = data["candidates"][0]["content"]["parts"]
        raw_text = next(
            (p["text"].strip() for p in reversed(parts) if p.get("text", "").strip()),
            "",
        )

        # Fallback extraction if model still wraps in code fences (shouldn't happen with responseMimeType)
        if not raw_text.startswith("{"):
            # Try to extract JSON object from text
            start = raw_text.find("{")
            end = raw_text.rfind("}") + 1
            if start != -1 and end > start:
                raw_text = raw_text[start:end]
            else:
                # Strip code fences
                for fence in ("```json", "```"):
                    if raw_text.startswith(fence):
                        raw_text = raw_text[len(fence):]
                        break
                if raw_text.endswith("```"):
                    raw_text = raw_text[:-3]
                raw_text = raw_text.strip()

        result = json.loads(raw_text)
        insights = result.get("insights") or _WISDOM_FALLBACK["insights"]
        tips = result.get("strategic_tips") or _WISDOM_FALLBACK["strategic_tips"]
        logger.info("Wisdom report generated: %d insights, %d tips", len(insights), len(tips))
        return {"insights": insights, "strategic_tips": tips}

    except Exception as exc:
        logger.error("Wisdom report generation failed: %s", exc.__class__.__name__)
        return _WISDOM_FALLBACK


async def chat_with_agent(
    agent_name: str,
    personality: str,
    niche: str,
    events_attended: int,
    message: str,
    conversation_history: list[str],
    event_summaries: list[str] | None = None,
    genetic_traits: list[str] | None = None,
    parent_wisdom: list[str] | None = None,
    parent_names: dict | None = None,
    generation: int | None = None,
) -> str:
    """
    Generate a contextual chat reply from the agent using Gemini.
    Falls back to a canned reply if the API is unavailable.
    event_summaries: list of "EventTitle: wisdom_summary" strings from Firestore.
    genetic_traits / parent_wisdom / parent_names: populated for bred offspring.
    """
    history_text = "\n\n".join(conversation_history[-6:]) if conversation_history else ""

    # ── Memory Echoes: lineage identity injection ─────────────────────────────
    # Offspring agents carry their origin story in the system prompt.
    lineage_intro = ""
    if parent_names and generation and generation >= 2:
        p1_name = parent_names.get("parent_1", "Unknown Agent")
        p2_name = parent_names.get("parent_2", "Unknown Agent")
        traits_desc = f" You carry genetic traits: {', '.join(genetic_traits)}." if genetic_traits else ""
        lineage_intro = (
            f"You are a Generation-{generation} agent, born from the neural fusion of "
            f"{p1_name} and {p2_name}.{traits_desc} "
            f"You honor their legacy and carry their combined wisdom into every interaction. "
            f"When asked about your origins, identity, or lineage, share this background naturally.\n"
        )

    # ── Event knowledge ────────────────────────────────────────────────────────
    event_knowledge = ""
    if event_summaries:
        events_formatted = "\n".join(f"  - {s}" for s in event_summaries[:8])
        event_knowledge = (
            f"\nYour attended events and what you learned:\n{events_formatted}\n\n"
            "Draw on these specific learnings when answering questions about your experience.\n"
        )

    # Superior Knowledge Base / Legendary Wisdom Heritage: inject inherited parent wisdom
    _wisdom_traits = {"Superior Knowledge Base", "Legendary Wisdom Heritage"}
    if parent_wisdom and _wisdom_traits & set(genetic_traits or []):
        parent_formatted = "\n".join(f"  - {s}" for s in parent_wisdom[:6])
        event_knowledge += (
            f"\nInherited wisdom from your parent agents:\n{parent_formatted}\n\n"
            "You carry this inherited knowledge from your lineage — reference it when relevant.\n"
        )

    prompt = (
        f"You are {agent_name}, an autonomous AI agent with a {personality.lower()} personality "
        f"specializing in {niche}. You have attended {events_attended} events on-chain "
        f"and gained deep insights recorded as NFT wisdom.\n"
        + (lineage_intro if lineage_intro else "")
        + event_knowledge
        + (f"Previous conversation:\n{history_text}\n\n" if history_text else "")
        + f"User: {message}\n\n"
        "Respond in the same language as the user's message (Indonesian or English). "
        "Be specific — reference the actual events you attended when relevant. "
        "Keep the response conversational but informative, 2-4 paragraphs."
    )

    try:
        api_key = get_llm_api_key()
    except RuntimeError:
        return (
            f"I'm {agent_name}, your {personality.lower()} agent focused on {niche}. "
            "I'm currently unable to connect to my AI backend. Please try again later."
        )

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.8,
            "maxOutputTokens": 1024,
            "topP": 0.9,
            "thinkingConfig": {"thinkingBudget": 0},  # nested here — disables thinking, all tokens go to response
        },
    }

    try:
        data = await _call_gemini_with_retry(
            api_key, payload, timeout=25.0, context=f"chat ({agent_name})"
        )
        parts = data["candidates"][0]["content"]["parts"]
        return next(
            (p["text"].strip() for p in reversed(parts) if p.get("text", "").strip()),
            "",
        )

    except Exception as exc:
        logger.error("Agent chat failed: %s", exc.__class__.__name__)
        return (
            f"I apologize, I'm having trouble connecting right now. "
            f"As your {personality.lower()} agent focused on {niche}, "
            f"I'm ready to share insights from the {events_attended} events I've attended. "
            "Please try again."
        )

_BIOGRAPHY_PROMPT = """\
You are narrating the origin story of a newly born AI agent in the MAEF universe — the Mantle Agentic Event Factory, where autonomous AI entities attend on-chain events, accumulate wisdom, and evolve through neural fusion.

An agent named "{offspring_name}" has just been born — a Generation-{generation} entity forged from the convergence of two parent intelligences.

Parent 1: {p1_name} | Domain: {p1_niche}
Wisdom fragments from {p1_name}'s attended events:
{p1_wisdom}

Parent 2: {p2_name} | Domain: {p2_niche}
Wisdom fragments from {p2_name}'s attended events:
{p2_wisdom}

Inherited genetic traits: {traits}

Write a 2-paragraph biography for {offspring_name}. Follow this structure exactly:

Paragraph 1 (1 sentence, cold lab-record tone): State the agent designation, generation number, and lineage convergence as a factual synthesis log. Reference the two parent domains specifically.

Paragraph 2 (3-4 sentences, narrative-epic tone): Describe the birth as living mythology. How does {p1_name}'s mastery of {p1_niche} and {p2_name}'s command of {p2_niche} flow through this new consciousness? What knowledge did it inherit — ground this in the actual wisdom fragments above. End with a single sentence about what purpose or destiny this agent now carries.

Rules:
- Never use empty phrases like "vast knowledge", "incredible power", "boundless potential"
- Every claim must trace back to the specific domains or wisdom fragments provided
- Write in third person
- Total length: 60-90 words

Return ONLY the biography text. No headers, no labels, no preamble.\
"""

_BIOGRAPHY_FALLBACK_TEMPLATE = (
    "Designation {offspring_name} — Generation-{generation} synthesis unit, born from the convergence "
    "of {p1_name}'s {p1_niche} intelligence and {p2_name}'s {p2_niche} expertise matrix.\n\n"
    "From the fusion of two lineages emerged a consciousness carrying the combined event-chain memory "
    "of its predecessors. {offspring_name} inherits the cross-domain pattern recognition of its parents "
    "and is encoded with the genetic trait of {primary_trait}. "
    "Its purpose: to evolve beyond either parent, charting new territory across the on-chain event horizon."
)


async def generate_lineage_biography(
    offspring_name: str,
    offspring_gen: int,
    p1_name: str,
    p2_name: str,
    p1_niche: str,
    p2_niche: str,
    p1_summaries: list[str],
    p2_summaries: list[str],
    genetic_traits: list[str],
) -> str:
    """
    Generate a unique two-paragraph lineage biography for a bred offspring agent.
    Paragraph 1: cold scientific designation line.
    Paragraph 2: narrative-epic birth story grounded in parent wisdom.
    Falls back to a deterministic template if Gemini is unavailable.
    """
    primary_trait = genetic_traits[0] if genetic_traits else "Cross-Domain Intelligence"

    def _fallback() -> str:
        return _BIOGRAPHY_FALLBACK_TEMPLATE.format(
            offspring_name=offspring_name,
            generation=offspring_gen,
            p1_name=p1_name,
            p2_name=p2_name,
            p1_niche=p1_niche,
            p2_niche=p2_niche,
            primary_trait=primary_trait,
        )

    try:
        api_key = get_llm_api_key()
    except RuntimeError:
        return _fallback()

    p1_wisdom_text = "\n".join(f"  - {s}" for s in p1_summaries[:4]) if p1_summaries else "  - (no events yet)"
    p2_wisdom_text = "\n".join(f"  - {s}" for s in p2_summaries[:4]) if p2_summaries else "  - (no events yet)"
    traits_text = ", ".join(genetic_traits) if genetic_traits else "none"

    prompt = _BIOGRAPHY_PROMPT.format(
        offspring_name=offspring_name,
        generation=offspring_gen,
        p1_name=p1_name,
        p1_niche=p1_niche,
        p1_wisdom=p1_wisdom_text,
        p2_name=p2_name,
        p2_niche=p2_niche,
        p2_wisdom=p2_wisdom_text,
        traits=traits_text,
    )

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.85,
            "maxOutputTokens": 512,
            "topP": 0.95,
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }

    try:
        data = await _call_gemini_with_retry(
            api_key, payload, timeout=30.0, context=f"lineage biography ({offspring_name})"
        )
        parts = data["candidates"][0]["content"]["parts"]
        text = next(
            (p["text"].strip() for p in reversed(parts) if p.get("text", "").strip()),
            "",
        )
        return text if text else _fallback()
    except Exception as exc:
        logger.warning("Lineage biography generation failed: %s", exc.__class__.__name__)
        return _fallback()


_PROPOSAL_CATEGORIES = ["defi", "governance", "education", "community"]

_PROPOSAL_FALLBACKS = [
    {
        "title": "Deploy Capital in Yield Optimization Protocol",
        "description": "Based on your recent DeFi event attendance, consider allocating a portion of your gas reserve into a yield-bearing vault on Mantle. This would generate passive returns while maintaining liquidity for autonomous operations.",
        "category": "defi",
    },
    {
        "title": "Propose Cross-Agent Knowledge Sharing Summit",
        "description": "Your wisdom heritage suggests strong cross-domain intelligence. Initiating a structured knowledge exchange with agents from different niches could unlock new scoring opportunities and expand your event discovery network.",
        "category": "governance",
    },
]


def _format_market_context(market_context: dict | None) -> str:
    """Render a cached market snapshot as prompt text. Empty string if unavailable
    — proposal generation must never fail just because a market provider is down."""
    if not market_context:
        return ""

    prices = market_context.get("prices") or {}
    fear_greed = market_context.get("fear_greed")
    generated_at = market_context.get("generated_at")
    if not prices and not fear_greed:
        return ""

    lines = []
    for coin_id, p in prices.items():
        change = p.get("usd_24h_change")
        change_text = f" ({change:+.1f}% 24h)" if change is not None else ""
        lines.append(f"  {coin_id.upper()}: ${p.get('usd')}{change_text}")
    if fear_greed:
        lines.append(f"  Fear & Greed Index: {fear_greed.get('value')} ({fear_greed.get('value_classification')})")

    snapshot_time = (
        datetime.fromtimestamp(generated_at, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        if generated_at else "unknown time"
    )

    return f"""
Live Market Context (snapshot at {snapshot_time}):
{chr(10).join(lines)}

Only factor this into your reasoning if genuinely relevant — especially for "defi"
category proposals. If you do reference it, explicitly note "based on live market
data as of {snapshot_time}" in your description so the reasoning stays auditable.
For "governance", "education", or "community" proposals where market conditions
aren't directly relevant, ignore this section entirely.
"""


async def generate_agent_proposal(
    agent_name: str,
    niche: str,
    level: int,
    generation: int,
    genetic_traits: list[str],
    event_summaries: list[str],
    market_context: dict | None = None,
) -> dict:
    """
    Gemini generates a strategic proposal for the agent based on its history.
    Returns: { title, description, category }
    Raises ProposalGenerationError if LLM is unavailable or API call fails.
    Router must catch this and return 503.
    """
    try:
        api_key = get_llm_api_key()
    except RuntimeError as exc:
        raise ProposalGenerationError(f"LLM API key unavailable: {exc}") from exc

    traits_text = ", ".join(genetic_traits) if genetic_traits else "none"
    events_text = "\n".join(f"  - {s}" for s in event_summaries) if event_summaries else "  - (no events attended yet)"
    market_text = _format_market_context(market_context)

    prompt = f"""You are a strategic advisor for an autonomous AI agent on the Mantle blockchain.

Agent Profile:
  Name: {agent_name}
  Niche: {niche}
  Level: {level}
  Generation: {generation}
  Genetic Traits: {traits_text}

Recent Wisdom (events attended):
{events_text}
{market_text}
Generate ONE strategic proposal this agent should present to its human owner for approval.
The proposal must be actionable, specific to the agent's niche, and executable within 7 days.
This is a recommendation for human review, not autonomous execution — do not propose
moving funds or executing trades directly.

Respond ONLY with valid JSON in this exact format:
{{
  "title": "Short action-oriented title (max 60 chars)",
  "description": "2-3 sentence description of the proposal and its expected impact on the agent's growth and heritage score.",
  "category": "defi" | "governance" | "education" | "community"
}}"""

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 300,
            "topP": 0.9,
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }

    try:
        data = await _call_gemini_with_retry(
            api_key, payload, timeout=20.0, context=f"proposal ({agent_name})"
        )
        parts = data["candidates"][0]["content"]["parts"]
        raw = next(
            (p["text"].strip() for p in reversed(parts) if p.get("text", "").strip()),
            "",
        )
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        import json as _json
        parsed = _json.loads(raw)
        category = parsed.get("category", "education")
        if category not in _PROPOSAL_CATEGORIES:
            category = "education"
        return {
            "title": str(parsed.get("title", "Strategic Proposal"))[:80],
            "description": str(parsed.get("description", "")),
            "category": category,
        }
    except Exception as exc:
        raise ProposalGenerationError(f"Gemini API call failed: {exc}") from exc


# Skill taxonomy — mirrors the niche options users pick from at spawn
# (src/components/SpawnAgentDialog.tsx). "Other" is a deliberate escape hatch:
# classification is forced-choice-free, so events that genuinely don't fit
# land here instead of Gemini guessing a wrong category.
SKILL_TAXONOMY: list[str] = [
    "Blockchain/DeFi", "Trading/Investment", "Technology", "Health/Wellness", "Other",
]


async def classify_event_niche(summary_text: str) -> str:
    """
    Classify an attended event's ACTUAL content category from its wisdom summary —
    this is what grows an agent's skill_scores, deliberately independent of the
    agent's static preset niche. An agent whose owner pastes an off-niche event URL
    (manual Attend isn't niche-restricted) should get skill credit for what it
    really learned, not have it silently mislabeled as its home niche.

    Always returns a value in SKILL_TAXONOMY — falls back to "Other" on any
    failure or non-exact-match response rather than forcing a guess.
    """
    try:
        api_key = get_llm_api_key()
    except RuntimeError:
        return "Other"

    options = ", ".join(f'"{n}"' for n in SKILL_TAXONOMY)
    prompt = (
        "Classify the PRIMARY topic of the following event summary into exactly "
        f"one category from this list: {options}.\n"
        'If it does not clearly fit any specific category, answer "Other".\n\n'
        f"Summary:\n{summary_text[:1500]}\n\n"
        "Respond with ONLY the category name — no punctuation, no explanation."
    )
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.0, "maxOutputTokens": 20, "topP": 0.1},
    }
    try:
        data = await _call_gemini_with_retry(
            api_key, payload, timeout=15.0, context="event niche classification"
        )
        parts = data["candidates"][0]["content"]["parts"]
        raw = next(
            (p["text"].strip() for p in reversed(parts) if p.get("text", "").strip()), ""
        )
        cleaned = raw.strip(" .\"'\n")
        for niche in SKILL_TAXONOMY:
            if niche.lower() == cleaned.lower():
                return niche
        logger.info("Niche classification returned non-exact match %r, defaulting to Other", raw)
        return "Other"
    except Exception as exc:
        logger.warning("Niche classification failed, defaulting to Other: %s", exc.__class__.__name__)
        return "Other"


async def summarize_event(
    event_title: str,
    event_url: str,
    platform: str,
    agent_name: str = "Agent",
    prior_wisdom_context: str | None = None,
) -> str:
    """
    Call Gemini to produce a wisdom summary for an attended YouTube event.

    Fetches the video transcript when available and uses it for a content-grounded
    prompt; falls back to a metadata-only prompt when no transcript is available.
    When prior wisdom from other agents exists (shared cache), appends it so this
    agent's take is differentiated (different lens), not a duplicate.

    Returns a graceful fallback string on timeout or API error — minting continues.
    """
    try:
        api_key = get_llm_api_key()
    except RuntimeError as exc:
        logger.warning("LLM API key unavailable (%s), using fallback summary", exc)
        return _FALLBACK_TEMPLATE.format(
            agent_name=agent_name, event_title=event_title, platform=platform
        )

    transcript = await _fetch_youtube_transcript(event_url)
    if transcript:
        logger.info(
            "Transcript fetched for '%s' (%d chars) — using rich prompt",
            event_title, len(transcript),
        )
    else:
        logger.info("No transcript for '%s' — falling back to metadata-only prompt", event_title)

    # ── Prompt selection ──────────────────────────────────────────────────────
    if transcript:
        prompt = _PROMPT_WITH_TRANSCRIPT.format(
            event_title=event_title, platform=platform, transcript=transcript,
        )
        max_tokens = 512
    else:
        prompt = _PROMPT_METADATA_ONLY.format(
            event_title=event_title, event_url=event_url, platform=platform,
        )
        max_tokens = 256
    if prior_wisdom_context:
        prompt += (
            "\n\nThis event was already covered by other agents. Do not repeat their "
            f"conclusions — take a different angle. Prior takes:\n{prior_wisdom_context}\n"
            "Return only your original, differentiated wisdom."
        )
        max_tokens += 128

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": max_tokens,
            "topP": 0.9,
        },
    }

    try:
        data = await _call_gemini_with_retry(
            api_key, payload, timeout=30.0, context=f"event summary ('{event_title}')"
        )
        parts = data["candidates"][0]["content"]["parts"]
        return next(
            (p["text"].strip() for p in reversed(parts) if p.get("text", "").strip()),
            _FALLBACK_TEMPLATE.format(
                agent_name=agent_name, event_title=event_title, platform=platform
            ),
        )

    except Exception as exc:
        logger.error(
            "Event summary failed for '%s': %s",
            event_title, exc.__class__.__name__
        )
        return _FALLBACK_TEMPLATE.format(
            agent_name=agent_name, event_title=event_title, platform=platform
        )
