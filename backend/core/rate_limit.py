"""
Small in-process rate limiter for endpoints that write to Firestore on every
call.

Why this exists
---------------
Several endpoints mint a short-lived document as part of their work — an auth
challenge, a marketplace sync, an indexer poll. Each of those is a write, and
none of them needed one to answer the caller's question. Without a limit they
become a cheap way for anyone to inflate the write bill or fill a collection
with junk, and a handful of retries from one buggy client is enough.

Scope and honesty about its limits
---------------------------------
This is per-instance state in a dictionary. It stops the casual caller and
the runaway retry loop. It does **not** coordinate across Cloud Run instances,
so a burst spread over N instances gets N times the allowance. That is an
acceptable trade for keeping the dependency surface at zero; a distributed
limiter would need Firestore or Redis and buys correctness most deployments
do not need. If this endpoint ever becomes hot enough for that to matter, the
swap belongs here and nowhere else.

The limits are deliberately generous for humans and tight for scripts.
"""
from __future__ import annotations

import logging
import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import HTTPException, Request

logger = logging.getLogger(__name__)

_hits: dict[str, deque[float]] = defaultdict(deque)
_lock = Lock()


def reset_state() -> None:
    """Clear all recorded hits. For tests."""
    with _lock:
        _hits.clear()


def client_ip(request: Request) -> str:
    """The caller's real IP.

    On Cloud Run every connection reaches uvicorn from the same internal proxy
    (169.254.169.126 in the access logs), so request.client.host would put all
    users in one bucket. Cloud Run appends the true client IP as the *last*
    X-Forwarded-For entry; earlier entries are whatever the caller sent and can
    be spoofed, so only the last one is trusted. If a load balancer is ever put
    in front, the client becomes the second-to-last entry instead.
    """
    headers = getattr(request, "headers", None)
    forwarded = headers.get("x-forwarded-for") if headers else None
    if forwarded:
        last = forwarded.split(",")[-1].strip()
        if last:
            return last
    return request.client.host if request.client else "unknown"


def enforce(
    request: Request,
    bucket: str,
    *,
    limit: int,
    window_seconds: int,
) -> None:
    """Raise 429 when `bucket` has been hit more than `limit` times in the window.

    Keyed by client host so one noisy integration behind a single IP does not
    lock out everyone behind that NAT.
    """
    host = client_ip(request)
    key = f"{bucket}:{host}"
    now = time.time()
    cutoff = now - window_seconds

    with _lock:
        hits = _hits[key]
        while hits and hits[0] < cutoff:
            hits.popleft()
        if len(hits) >= limit:
            retry_after = int(window_seconds - (now - hits[0])) if hits else window_seconds
            logger.warning(
                "rate limit hit: bucket=%s host=%s limit=%d/%ds",
                bucket, host, limit, window_seconds,
            )
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Too many requests. Try again in {retry_after}s."
                ),
                headers={"Retry-After": str(retry_after)},
            )
        hits.append(now)