"""
GCP Secret Manager integration.

In Cloud Run (USE_SECRET_MANAGER=true):  secrets are fetched from Secret Manager.
In local dev (USE_SECRET_MANAGER=false): secrets fall back to environment variables.

Secrets that must be created in GCP Secret Manager before first deploy:
  gcloud secrets create AGENT_PRIVATE_KEY --replication-policy=automatic
  gcloud secrets create LLM_API_KEY       --replication-policy=automatic
  gcloud secrets create MANTLE_RPC_URL    --replication-policy=automatic  (optional)
"""

import logging
import os
from functools import lru_cache

logger = logging.getLogger(__name__)

# Lazy-import so local dev without google-cloud SDK still imports fine
_client = None


def _get_client():
    global _client
    if _client is None:
        from google.cloud import secretmanager  # type: ignore

        _client = secretmanager.SecretManagerServiceClient()
    return _client


def _fetch_from_secret_manager(
    secret_id: str,
    project_id: str,
    version: str = "latest",
) -> str:
    """Pull a secret version payload from GCP Secret Manager."""
    client = _get_client()
    name = f"projects/{project_id}/secrets/{secret_id}/versions/{version}"
    try:
        response = client.access_secret_version(request={"name": name})
        return response.payload.data.decode("utf-8").strip()
    except Exception as exc:
        logger.error("Failed to fetch secret '%s': %s", secret_id, exc)
        raise RuntimeError(f"Secret '{secret_id}' unavailable: {exc}") from exc


def _get_secret(secret_id: str) -> str:
    """
    Resolve a secret value:
      1. Local env var override (for dev / CI)
      2. GCP Secret Manager (production)
    """
    from core.config import settings  # local import avoids circular deps

    env_val = os.environ.get(secret_id)
    if env_val:
        return env_val.strip()

    if not settings.use_secret_manager:
        raise RuntimeError(
            f"Secret '{secret_id}' not found in env and USE_SECRET_MANAGER=false"
        )

    return _fetch_from_secret_manager(secret_id, settings.gcp_project_id)


def _get_env_or_secret(name: str, *, default: str) -> str:
    """Non-secret setting that may still be overridden in Secret Manager.

    Model names and tuning knobs are not credentials, but keeping them behind
    the same lookup means a deploy can change one without a code change.
    """
    try:
        value = _get_secret(name).strip()
    except RuntimeError:
        value = ""
    return value or os.environ.get(name, "").strip() or default


@lru_cache(maxsize=None)
def get_agent_private_key() -> str:
    """Return AGENT_PRIVATE_KEY (the backend minting wallet's private key)."""
    key = _get_secret("AGENT_PRIVATE_KEY").strip()
    return key if key.startswith("0x") else f"0x{key}"


@lru_cache(maxsize=None)
def get_minter_service_private_key() -> str:
    """
    Return MINTER_SERVICE_PRIVATE_KEY (preferred) or AGENT_PRIVATE_KEY (legacy).

    This allows separating:
      - deployer/admin wallet (cold, infrequent)
      - minter service wallet (hot, operational Mode A)
    """
    try:
        key = _get_secret("MINTER_SERVICE_PRIVATE_KEY").strip()
    except RuntimeError:
        logger.warning(
            "MINTER_SERVICE_PRIVATE_KEY not set, falling back to AGENT_PRIVATE_KEY. "
            "Configure MINTER_SERVICE_PRIVATE_KEY for safer wallet separation."
        )
        key = _get_secret("AGENT_PRIVATE_KEY").strip()
    return key if key.startswith("0x") else f"0x{key}"


@lru_cache(maxsize=None)
def get_llm_api_key() -> str:
    """Return LLM_API_KEY (Google Gemini API key)."""
    return _get_secret("LLM_API_KEY")


@lru_cache(maxsize=None)
def get_minimax_api_key() -> str | None:
    """Return MINIMAX_API_KEY if configured, else None.

    Optional. The app runs entirely on Gemini without this; MiniMax is only
    used where a dialogue-tuned model reads better (Agent Room).
    Cached like the Gemini key: Agent Room asks on every turn, and an unset
    key would otherwise cost a failed Secret Manager call each time.
    """
    try:
        key = _get_secret("MINIMAX_API_KEY").strip()
    except RuntimeError:
        return None
    return key or None


@lru_cache(maxsize=None)
def get_minimax_model() -> str:
    """Model name for MiniMax calls."""
    return _get_env_or_secret("MINIMAX_MODEL", default="MiniMax-M3.1-Flash-Preview")


@lru_cache(maxsize=None)
def get_minimax_effort() -> str:
    """Thinking depth for M3.1: low | medium | high | xhigh | max.

    Thinking cannot be turned off on M3.1 — the only way to spend less is to
    ask for less depth. Default is high: Agent Room answers are multi-turn and
    quality matters more than latency there, and the Gemini fallback plus the
    10-minute cooldown on failure keep a bad configuration from costing much.
    """
    allowed = {"low", "medium", "high", "xhigh", "max"}
    value = _get_env_or_secret("MINIMAX_EFFORT", default="high").strip().lower()
    return value if value in allowed else "high"


def get_youtube_api_key() -> str | None:
    """Return YOUTUBE_API_KEY if configured, None otherwise (auto scout disabled)."""
    try:
        return _get_secret("YOUTUBE_API_KEY")
    except RuntimeError:
        return None


def get_mantle_rpc_url() -> str:
    """Return MANTLE_RPC_URL, falling back to public Sepolia RPC."""
    try:
        return _get_secret("MANTLE_RPC_URL")
    except RuntimeError:
        logger.warning("MANTLE_RPC_URL secret not found, using public Sepolia RPC")
        return "https://rpc.sepolia.mantle.xyz"


def get_coingecko_api_key() -> str | None:
    """Return COINGECKO_API_KEY if configured, None otherwise (keyless demo calls only)."""
    try:
        return _get_secret("COINGECKO_API_KEY")
    except RuntimeError:
        return None


def get_coinmarketcap_api_key() -> str | None:
    """Return COINMARKETCAP_API_KEY if configured, None otherwise (CMC endpoints disabled)."""
    try:
        return _get_secret("COINMARKETCAP_API_KEY")
    except RuntimeError:
        return None


def get_operator_api_key() -> str | None:
    """Return OPERATOR_API_KEY — gates the internal-only operator health endpoint.
    None if unset, which the caller treats as "endpoint disabled", not "open"."""
    try:
        return _get_secret("OPERATOR_API_KEY")
    except RuntimeError:
        return None
