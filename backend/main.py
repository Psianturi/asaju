"""
MAEF Backend — FastAPI entry point.

Startup sequence:
  1. CORS middleware (must be before any router)
  2. Router registration (health → agents → events)

Environment variables (all resolved via core/secrets.py):
  CONTRACT_ADDRESS   — deployed MAEFDynamicNFT address
  AGENT_PRIVATE_KEY  — minting wallet key (Secret Manager in production)
  LLM_API_KEY        — Gemini API key (Secret Manager in production)
  MANTLE_RPC_URL     — Mantle Sepolia RPC (optional, falls back to public)
  PORT               — injected by Cloud Run (default 8080)
"""

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings
from routers import agents, events, feedback, health, market, monitoring, operator, owner_inbox, proposals, public, scheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="MAEF Agentic Engine",
    description="Mantle Agentic Event Factory — Backend API",
    version="1.0.0",
    # Disable Swagger UI in production (docs still available at /redoc)
    docs_url="/docs" if settings.environment != "production" else None,
    redoc_url="/redoc",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,  # Must be False when allow_origins=["*"]
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(health.router)
app.include_router(agents.router)
app.include_router(events.router)
app.include_router(proposals.router)
app.include_router(public.router)
app.include_router(scheduler.router)
app.include_router(monitoring.router)
app.include_router(market.router)
app.include_router(operator.router)
app.include_router(feedback.router)
app.include_router(owner_inbox.router)

logger.info(
    "MAEF backend started | env=%s chain=%s contract=%s",
    settings.environment,
    settings.chain_id,
    settings.contract_address or "NOT SET",
)
