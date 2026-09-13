"""Shared Wisdom Cache — same-owner agent reuse of prior YouTube wisdom.

Read-only for the attend flow: never blocks, never overwrites. When the
attending user owns multiple agents that have already attended the same
YouTube video, the prior summary is supplied as context so this agent's
take is differentiated (different lens) rather than a copy.

Also persists per-agent chat topics: every chat turn writes a small
"topic" doc the agent can read back as part of its memory in future
sessions. This is the lightweight, no-YouTube-quota path that lets the
agent learn from the owner in conversation. Privacy: chat_topic docs are
strictly per-(owner_wallet, agent_id); they never cross wallets.

Privacy: cache reuse is strictly per-owner (`user_wallet`). One user's
agents never see another user's wisdom — that's the explicit product
boundary, not an implementation detail. Without user_wallet, the cache
returns None (no leakage).
"""
import logging
import re
import secrets
import time

from core.database import get_db

logger = logging.getLogger(__name__)

EVENTS_COLLECTION = "agent_events"
CHAT_TOPICS_COLLECTION = "chat_topics"


def _canonical_video_id(url: str) -> str | None:
    """Extract YouTube video ID, ignoring query params so ?t= variants match."""
    for pat in (
        r"(?:youtube\.com/watch\?.*v=|youtu\.be/)([A-Za-z0-9_-]{11})",
        r"youtube\.com/embed/([A-Za-z0-9_-]{11})",
        r"youtube\.com/shorts/([A-Za-z0-9_-]{11})",
    ):
        m = re.search(pat, url)
        if m:
            return m.group(1)
    return None


async def lookup_prior_wisdom(
    event_url: str,
    exclude_agent_id: str | None = None,
    user_wallet: str | None = None,
) -> str | None:
    """
    Return a compact context string of prior wisdom for this video, or None.

    Only YouTube URLs are eligible (the only platform with a stable video ID).
    Excludes the requesting agent so an agent never quotes itself.

    Privacy: when user_wallet is provided, only events owned by that wallet are
    considered. Without it, the cache is empty — same-owner only.
    """
    if not user_wallet:
        return None
    video_id = _canonical_video_id(event_url)
    if not video_id:
        return None

    db = get_db()
    # Per-owner isolation: query both the canonical URL form and same-user
    # constraints in one pass. The user_wallet filter is the privacy boundary.
    try:
        docs = await (
            db.collection(EVENTS_COLLECTION)
            .where("event_url", ">=", f"https://youtu.be/{video_id}")
            .where("event_url", "<=", f"https://youtu.be/{video_id}\uf8ff")
            .where("user_wallet", "==", user_wallet)
            .get()
        )
    except Exception:
        # Fall back to exact-URL match if range+equality compound fails
        # (Firestore sometimes rejects compound queries that mix range + inequality on different fields).
        try:
            docs = (
                await db.collection(EVENTS_COLLECTION)
                .where("event_url", "==", event_url)
                .where("user_wallet", "==", user_wallet)
                .get()
            )
        except Exception as exc:
            logger.warning("wisdom cache lookup failed (non-fatal): %s", exc)
            return None

    prior: list[dict] = []
    for doc in docs:
        data = doc.to_dict() or {}
        other_id = data.get("agent_id")
        if exclude_agent_id and other_id == exclude_agent_id:
            continue
        if _canonical_video_id(data.get("event_url", "")) != video_id:
            continue
        prior.append(data)
        if len(prior) >= 2:  # cap context so the prompt stays small
            break

    if not prior:
        return None

    lines = [
        f"Prior wisdom from agent '{d.get('agent_name', '?')}' (niche={d.get('niche', '?')}): "
        f"{(d.get('wisdom_summary') or '')[:200].strip()}…"
        for d in prior
    ]
    return "\n".join(lines)


# ── Chat topics ──────────────────────────────────────────────────────────────


async def persist_chat_topic(
    *,
    agent_id: str,
    user_wallet: str,
    niche: str,
    user_message: str,
    agent_reply: str,
    intent: str | None = None,
    tool_source: str | None = None,
    max_reply_chars: int = 800,
) -> bool:
    """
    Persist a chat turn as a lightweight "topic" entry the agent can recall
    later as part of its memory. Returns True on success, False on any failure
    (best-effort — never blocks chat).

    Privacy: scoped by (user_wallet, agent_id). Other owners cannot read these.
    Retention: capped at 50 most recent per agent in recall_chat_topics.
    """
    if not user_wallet or not agent_id:
        return False
    if not user_message or not user_message.strip():
        return False

    truncated_reply = (agent_reply or "")[:max_reply_chars]
    # nanosecond timestamp + random hex suffix → unique even within same ms
    topic_id = f"{agent_id}_{int(time.time() * 1_000_000)}_{secrets.token_hex(2)}"

    payload = {
        "agent_id": agent_id,
        "user_wallet": user_wallet.lower() if isinstance(user_wallet, str) else user_wallet,
        "niche": niche,
        "user_message": user_message.strip()[:500],
        "agent_reply": truncated_reply,
        "intent": intent,
        "tool_source": tool_source,
        "created_at": time.time(),
    }

    try:
        db = get_db()
        await db.collection(CHAT_TOPICS_COLLECTION).document(topic_id).set(payload)
        return True
    except Exception as exc:
        logger.warning(
            "chat topic persist failed (agent=%s): %s",
            agent_id,
            exc.__class__.__name__,
        )
        return False


async def recall_chat_topics(
    *,
    agent_id: str,
    user_wallet: str,
    limit: int = 8,
) -> list[dict]:
    """
    Return the most recent N chat topics for an agent, scoped to the owner.
    Used as conversation-grounding context for future chats — the agent
    remembers what the owner has been asking about recently.

    Returns [] on any failure or empty result (never raises).
    """
    if not user_wallet or not agent_id:
        return []
    limit = max(1, min(limit, 50))
    try:
        db = get_db()
        docs = (
            await db.collection(CHAT_TOPICS_COLLECTION)
            .where("agent_id", "==", agent_id)
            .where("user_wallet", "==", user_wallet.lower() if isinstance(user_wallet, str) else user_wallet)
            .order_by("created_at", direction="DESCENDING")
            .limit(limit)
            .get()
        )
        out: list[dict] = []
        for doc in docs:
            data = doc.to_dict() or {}
            out.append(
                {
                    "user_message": (data.get("user_message") or "")[:200],
                    "agent_reply": (data.get("agent_reply") or "")[:200],
                    "intent": data.get("intent"),
                    "created_at": data.get("created_at"),
                }
            )
        return out
    except Exception as exc:
        logger.warning(
            "chat topic recall failed (agent=%s): %s",
            agent_id,
            exc.__class__.__name__,
        )
        return []