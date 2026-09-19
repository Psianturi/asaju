# ASAJU — Autonomous Sovereign Agent for Joint Understanding

A testnet prototype for autonomous knowledge agents that learn from YouTube and live market data, accumulate verifiable wisdom, and propose actions a human owner signs.

> **Live application:** [asaju.vercel.app](https://asaju.vercel.app)  
> **Health endpoint:** `/health` on the Cloud Run deployment listed below  
> **Current network scope:** Mantle Sepolia (5003) and Ethereum Sepolia (11155111). Testnet only — not financial advice.

---

## Why this exists

YouTube and other live streams teach a lot of people a lot of things. None of that learning has a portable record. Conventional AI summaries are ephemeral: there is no persistent agent identity, no durable trail of how knowledge accumulated, and no way to distinguish a one-off answer from an agent's continuing research. ASAJU gives each topic-focused agent a durable workflow, a wallet that proves when it acted, and an on-chain attestation that the learning record exists.

---

## What it does

1. **Spawn an agent** with an independent wallet, configurable niche, and a testnet gas reserve.
2. **Analyse YouTube content** submitted by the user or discovered through opt-in Auto Scout.
3. **Ground proposals in live market context** — proposals carry the raw CoinMarketCap + CoinGecko snapshot that fed the agent's reasoning, so the owner can audit the decision.
4. **Mint an on-chain learning attestation** only at milestones (level-up, wisdom-unlock), not on every video. Gas-efficient without losing the record.
5. **Build lineage** through Neural Fusion (breeding) — two eligible parents produce an offspring with inherited context.
6. **Keep consequential actions human-controlled** — every proposal records an approval hash signed by the owner, not autonomous execution.

The product is the agent's persistent knowledge workflow. The on-chain record is a verifiable proof-of-action, not an art piece.

---

## Architecture

```
                        ┌─────────────────────────────────────┐
                        │       Browser (React + Vite)        │
                        │   Vercel deploy · SPA, no SSR      │
                        └────────────────┬────────────────────┘
                                         │ HTTPS (JWT wallet-session)
                                         ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   Cloud Run (FastAPI · Python 3.11)                   │
│                                                                        │
│   Routers        Services                      External integrations   │
│   ────────       ────────                      ────────────────────   │
│   agents.py ───► llm_service (Gemini)     ─►  CoinMarketCap REST      │
│   proposals.py   web3_service (web3.py)    ─►  CoinGecko REST           │
│   events.py      market_data_service       ─►  YouTube transcript API  │
│   chat.py        scout_service              ─►  Firestore (state)      │
│   inbox.py       wisdom_cache                                       │
│   market.py      kms_service                                        │
│                  web3_event_indexer                                 │
│                                                                        │
│                  Failure-soft: any single provider down →             │
│                  proposal still generates (with partial context).     │
└────────────────────────┬────────────────────────────┬────────────────┘
                         │                            │
                         ▼                            ▼
        ┌────────────────────────────┐   ┌─────────────────────────────┐
        │   Firestore (agent state)   │   │  Supported testnet contracts │
        │   agent records · events     │   │  Mantle Sepolia (5003)       │
        │   scout logs · proposals     │   │  Ethereum Sepolia (11155111)│
        │   lineage · inbox            │   │  Agent reg · NFT · breed     │
        └────────────────────────────┘   │  proposal hash · heritage    │
                                         └─────────────────────────────┘
                         ▲
                         │ OIDC-protected HTTPS
                         │
              ┌──────────────────────────────┐
              │   Cloud Scheduler             │
              │   run-all-scouts · every 6h    │
              │   Cloud Scheduler warm-up      │
              │   every 5 min (cold-start fix) │
              └──────────────────────────────┘
```

**Trust boundaries:**
- **On-chain** = agent registration, NFT ownership, event fields, agent stats, breed records, proposal hashes
- **Off-chain** = YouTube transcripts, Gemini outputs, fuller agent memory, configuration, quality decisions, lineage narrative, KMS-managed key operations
- **Owner control** = strategic proposals require a signed approval hash before they are recorded on-chain; no autonomous treasury action is enabled today.

---

## CoinMarketCap integration (deep)

ASAJU uses CoinMarketCap as the agent's primary market signal source. The integration lives in [`backend/services/market_data_service.py`](backend/services/market_data_service.py) and is exposed through [`backend/routers/market.py`](backend/routers/market.py).

### Endpoints currently consumed

| Endpoint | Purpose | Where it's used |
|----------|---------|-----------------|
| `/v1/cryptocurrency/quotes/latest` | Live prices for BTC, ETH, MNT (CoinGecko-equivalent fallback) | Dashboard `MarketSnapshotCard` + `llm_service._format_market_context` |
| `/v1/cryptocurrency/info` | Token metadata, logos | Wisdom summary rendering |
| `/v2/tools/price-conversion` | Price conversions | Wisdom summary rendering |
| `/v2/cryptocurrency/ohlcv/historical` | Candlestick data | Wisdom summary |
| `/v1/cryptocurrency/trending/latest` | Coins trending by search interest | Dashboard `MarketIntelligenceHub` (Hot tab) |
| `/v1/cryptocurrency/trending/gainers-losers` | Biggest % movers | Dashboard `MarketIntelligenceHub` (Gainers/Losers tabs) + `llm_service._format_cmc_signals` (proposal prompt grounding) |
| `/v1/cryptocurrency/trending/most-visited` | Traffic-ranked trending | Dashboard `MarketIntelligenceHub` (supplement to listings) |
| `/v1/cryptocurrency/listings/new` | Recently listed tokens | Dashboard `MarketIntelligenceHub` (Listings tab) + `llm_service._format_cmc_signals` |
| `/v1/cryptocurrency/airdrops` | Active airdrops | Dashboard "Airdrop watch" panel |
| `/v1/global-metrics/quotes/latest` | Total mcap + BTC dominance | Dashboard hero strip + `llm_service._format_cmc_signals` |
| `/v1/content/latest` | News headlines | LLM context for proposal + chat |
| `/v3/fear-and-greed/latest` | Market sentiment | Dashboard sentiment bar + proposal context |
| `/v4/dex/pools/multi` (8 networks) | On-chain liquidity | Dashboard "Mantle Liquidity Watch" |

### How the data reaches the agent's reasoning

[`llm_service._format_cmc_signals()`](backend/services/llm_service.py) renders the advanced signals into prompt text that Gemini sees **every time a proposal is generated**. Each section is included only when its data is present; if a provider is down, the proposal still generates with the available context (fail-soft policy).

The prompt tells Gemini:

> *"Use these advanced CoinMarketCap signals in your reasoning — they're the same data the agent watches live in the dashboard, so the owner expects your proposal to be grounded in them, not invented."*

This means the agent's proposal text surfaces the actual numbers the owner sees in the dashboard — auditable, not hallucinated. The raw market snapshot is also stored alongside the proposal in Firestore so it can be reviewed after the fact.

### Cache strategy

CMC has rate limits and the agent's proposal flow is chatty. We cache every CMC read in Firestore with per-data-type TTLs (price 5 min, OHLC 15 min, sentiment 1 hour, news 30 min, trending 10 min, new listings 1 hour). All TTLs respect CMC's terms of use.

### Best-practice compliance

- CMC id used instead of symbol where possible (more stable than symbols that can rebrand or clash).
- v1 endpoints' `quote = {USD: {...}}` is normalized to a uniform array shape via [`_normalize_cmc_payload()`](backend/services/market_data_service.py) so the frontend and prompt never see two different shapes.
- Defensive accessor [`getQuote()`](src/components/MarketIntelligencePanel.tsx) in the frontend handles both shapes during a deploy transition.

---

## Smart contracts

Active deployments:

| Chain | Address | Notes |
|-------|---------|-------|
| Mantle Sepolia (5003) | [`0x66fD8b5411856D42c08D9356e879a6e7dF0c9419`](https://explorer.sepolia.mantle.xyz/address/0x66fD8b5411856D42c08D9356e879a6e7dF0c9419) | Legacy-compatible fee getters |
| Ethereum Sepolia (11155111) | [`0x9FEF11E45cFD550b33F13A8d80BE61cda80f4`](https://sepolia.etherscan.io/address/0x9FEF11E45cFD550b33F13A8d80BE61cda80f4) | Fee-configurable V4 |

Source: [`contracts/contracts/MAEFNFTV4.sol`](contracts/contracts/MAEFNFTV4.sol).

> **Note:** the deployed contract retains its original on-chain name for chain continuity. The "ASAJU" branding is at the application, prompt, and user-facing surface layers; renaming the contract would invalidate every existing agent registration, NFT, breed record, and proposal hash.

Roles:
- Deployer `0xe52bb4B913B83A71d0d2deD47683B1154bf2560b` — `DEFAULT_ADMIN_ROLE`
- Minter Service `0xCBA7951a8b5AE81303AC5E1017e34bF50A342D22` — `MINTER_ROLE`

Key functions: `spawnAgent`, `spawnBredAgent`, `mintAttendanceNFT`, `breedAgents`, `recordExecutedProposal`, `setFees`, `setBreedCost`, `getAgentStats`.

Key events: `NFTMinted`, `AgentsBred`, `WisdomUnlocked`, `ProposalExecuted`.

A regression test ([`backend/tests/test_abi_event_parity.py`](backend/tests/test_abi_event_parity.py)) compares the keccak256 topic0 of every event declared in the hand-maintained Python ABI against the compiled Solidity artifact. This guarantees the backend never silently misses an event because the ABI drifted from the deployed contract.

---

## Local development

### Prerequisites

- Node.js ≥ 20
- Python ≥ 3.11
- A Gemini API key (for `LLM_API_KEY`)
- A CoinMarketCap API key (Startup tier is sufficient)
- A YouTube Data API key (optional — only needed for Auto Scout)
- A Firestore project + service account JSON (any GCP project will do for local)

### Frontend

```bash
npm install
cp .env.example .env   # fill VITE_GCP_BACKEND_URL, contract addresses
npm run dev            # http://localhost:5000
npm run test           # vitest
npx tsc --noEmit       # typecheck
```

### Backend

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env   # fill GEMINI, CMC, YouTube keys, GCP creds
uvicorn main:app --reload --port 8080
pytest -v              # 125+ tests
```

### Environment variables (frontend)

```
VITE_NFT_CONTRACT_ADDRESS_SEPOLIA=0x66fD8b5411856D42c08D9356e879a6e7dF0c9419
VITE_NFT_CONTRACT_ADDRESS=0x66fD8b5411856D42c08D9356e879a6e7dF0c9419
VITE_GCP_BACKEND_URL=http://localhost:8080
```

### Environment variables (backend, production)

```
CONTRACT_ADDRESS=0x66fD8b5411856D42c08D9356e879a6e7dF0c9419
CHAIN_ID=5003
GCP_PROJECT_ID=your-project
USE_SECRET_MANAGER=true
KMS_KEY_NAME=projects/<project>/locations/<region>/keyRings/<ring>/cryptoKeys/<key>
```

GCP Secret Manager secrets (create with `echo -n "VALUE" | ...` — trailing newlines break `eth_account`):
- `MINTER_SERVICE_PRIVATE_KEY` — minter wallet, holds `MINTER_ROLE`
- `LLM_API_KEY` — Gemini API key
- `YOUTUBE_API_KEY` — YouTube Data API key (Auto Scout)

---

## Tests

| Layer | Count | Coverage |
|-------|------:|---------|
| Backend (pytest) | 125 | All routers, market data normalization, ABI parity, current-insight endpoint, proposal CMC prompt grounding |
| Frontend (vitest) | 114 | Components, hooks, utilities, format helpers |
| TypeScript (tsc) | clean | All source files |

CI runs both suites on every push via [`.github/workflows/`](.github/workflows/).

---

## Status snapshot

| Capability | Status |
|------------|--------|
| Agent creation + testnet funding | Implemented |
| YouTube analysis (transcript + metadata fallback) | Implemented |
| On-chain learning attestation | Implemented, milestone-based (level-ups, wisdom-unlock) — not every video |
| Autonomous signing (Mode B) | Implemented, KMS-protected |
| Auto Scout | Implemented, opt-in, OIDC-protected Cloud Scheduler trigger |
| Agent chat, wisdom reports, proposals | Implemented, Gemini-grounded |
| Breeding and lineage | Implemented, with same-chain and maturity guardrails |
| Multi-chain testnet (Mantle + Ethereum Sepolia) | Implemented |
| Market-aware proposals (CMC + CoinGecko) | Implemented, raw snapshot stored alongside proposal |
| Autonomous financial execution | **Not enabled.** `AUTONOMOUS_VAULT_ADDRESS` is intentionally unset. Any future signal-triggered proposal still requires the owner's signature before anything moves. |

---

## Roadmap

1. **Personal market co-pilot** — agents watch live market data continuously and raise a high-priority proposal with reasoning when a strong signal emerges. The owner always signs; the agent never executes.
2. **Wisdom Digest** — milestone-based minting shipped (level-ups, wisdom-unlock); next is selective per-event digest summaries for agent chat context.
3. **Policy-constrained execution** — any future real-fund action stays behind explicit, auditable policy limits. No autonomous treasury action today.
4. **Agent Marketplace** — owners discover and acquire agents with a verified track record, not an empty NFT shell.
5. **Reliability and information architecture** — ongoing hardening of wallet compatibility, dashboard IA, observability.

---

## Project layout

```
.
├── src/                       React + Vite frontend
│   ├── views/                 Page-level views (Dashboard, MyAgents, etc.)
│   ├── components/            UI components (MarketIntelligenceHub, AgentInsightsSection, …)
│   ├── lib/blockchain/        ABI, contract config, chain helpers
│   ├── services/              cloudRunService (HTTP client)
│   └── App.tsx                Root
├── backend/                   FastAPI service
│   ├── routers/               HTTP endpoints (agents, proposals, events, market, inbox, chat, …)
│   ├── services/              llm_service, web3_service, market_data_service, scout_service, …
│   ├── core/                  config, database, kms_service
│   ├── tests/                 pytest suite (125 tests)
│   ├── requirements.txt
│   └── main.py                Entry point
├── contracts/                 Solidity sources + Hardhat
│   ├── contracts/
│   │   └── MAEFNFTV4.sol      Active ERC-721A implementation
│   └── scripts/
├── .github/workflows/         CI (backend-tests, frontend-tests)
├── docs/                      Internal design notes (gitignored)
└── README.md                  You are here
```
