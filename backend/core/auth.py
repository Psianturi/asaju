"""
Google OIDC token verification for Cloud Scheduler → Cloud Run authentication.

Cloud Scheduler is configured to attach a Google-signed OIDC token to every
request. This module validates that token so only Cloud Scheduler (or any
caller holding a valid Google-issued OIDC token for our service URL) can
invoke the protected scheduler endpoints.

Usage:
    from core.auth import require_oidc
    @router.post("/run-all-scouts")
    async def handler(_claims: dict = Depends(require_oidc)): ...
"""

import logging

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from core.config import settings

logger = logging.getLogger(__name__)

_bearer = HTTPBearer(auto_error=False)


async def require_oidc(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    """
    FastAPI dependency: verify a Google-signed OIDC token.

    Validates:
    - Authorization: Bearer <token> header is present
    - Token signature is valid (verified against Google's public certs)
    - Issuer is exactly "https://accounts.google.com"
    - Audience matches our Cloud Run service URL (settings.cloud_run_url)

    Returns the decoded claims dict on success.
    Raises HTTP 401 on any validation failure — no detail leakage.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials
    try:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token

        claims = id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            audience=settings.cloud_run_url,
        )
    except Exception:
        # Log class name only — never log the raw token
        logger.warning("OIDC token validation failed (invalid or expired)")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired OIDC token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if claims.get("iss") != "https://accounts.google.com":
        logger.warning("OIDC token rejected: unexpected issuer")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token issuer",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Any Google account can mint an ID token for our audience; only the
    # scheduler's own service account may call these endpoints.
    allowed = {e.strip().lower() for e in settings.scheduler_service_accounts.split(",") if e.strip()}
    email = str(claims.get("email") or "").lower()
    if not claims.get("email_verified") or email not in allowed:
        logger.warning("OIDC token rejected: caller is not an allowed service account")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Caller not allowed",
        )

    return claims
