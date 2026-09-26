# ASAJU — Autonomous Sovereign Agent for Joint Understanding

A testnet prototype for autonomous knowledge agents that learn from YouTube and live market data, accumulate verifiable wisdom, and propose actions a human owner signs. Every agent has its own wallet, on-chain identity, and an auditable reasoning chain. New visitors land on **BNB Smart Chain Testnet (97)** as the default network; Mantle Sepolia (5003) remains fully supported for the legacy V4 agents.

> **Live application:** [asaju.vercel.app](https://asaju.vercel.app)  
> **Health endpoint:** `GET /health` on the Cloud Run deployment listed below  
> **Networks:** BNB Testnet (97) primary, Mantle Sepolia (5003) + Ethereum Sepolia (11155111) supported. Testnet only — not financial advice.

---

## Why this exists

YouTube and other live streams teach a lot of people a lot of things. None of that learning has a portable record. Conventional AI summaries are ephemeral: there is no persistent agent identity, no durable trail of how knowledge accumulated, and no way to distinguish a one-off answer from an agent's continuing research. ASAJU gives each topic-focused agent a durable workflow, a wallet that proves when it acted, and an on-chain attestation that the learning record exists.

---

## What it does

1. **Spawn an agent** with an independent wallet, configurable niche, and a testnet gas reserve funded half from spawn.
2. **Analyse YouTube content** submitted by the user (Manual Override) or discovered through opt-in Auto Scout (Cloud Scheduler every 6 hours).
3. **Ground proposals in live market context** — every proposal carries the raw CoinMarketCap + CoinGecko snapshot that fed the agent's reasoning, so the owner can audit the decision.
4. **Mint on-chain learning proofs** only at milestones (level-ups, wisdom-unlock), not on every video. Gas-efficient without losing the record.
5. **Build lineage** through Neural Fusion (breeding) — V5 prepays the offspring's spawn fee into escrow so the platform's own wallet is never subsidised.
6. **Keep consequential actions human-controlled** — every proposal records an approval hash signed by the owner (or the agent's own wallet in V5 Mode B). No autonomous financial execution is enabled today.

The product is the agent's persistent knowledge workflow. The on-chain record is a verifiable proof-of-action, not an art piece.

---

## How your agent learns

Two ways, and they can be used together:

| | Manual — "you teach it" | Automatic — Auto Scout |
|---|---|---|
| **Where** | Dashboard → **Analyze YouTube URL** | Agent card or agent detail page → **Auto-Scout** switch |
| **What happens** | You paste a YouTube link; the agent reads the transcript and learns right away | The agent searches its niche for relevant videos every 6 hours and keeps only what fits |
| **Best for** | A specific video you want it to learn now | Hands-off, continuous learning |

Either way, every lesson is saved to the agent's memory, and a learning proof is minted on-chain only when the agent levels up. Auto-Scout is off by default — turn it on per agent.

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
│   inbox.py       wisdom_cache               ─►  KMS key unwrap         │
│   market.py      kms_service                ─►  Mantle/BNB/ETH RPCs    │
│   public.py      comprehension_service                                 │
│                  Failure-soft: any single provider down →             │
│                  proposal still generates (with partial context).     │
└────────────────────────┬────────────────────────────┬────────────────┘
                          │                            │
                          ▼                            ▼
        ┌──────────────────────────────┐   ┌─────────────────────────────┐
        │   Firestore (agent state)     │   │   Supported testnet chains  │
        │   agents · events · proposals │   │   BNB Testnet (97)  default │
        │   scout_logs · inbox · market │   │   Mantle Sepolia (5003)      │
        └──────────────────────────────┘   │   ETH Sepolia (11155111)     │
                ▲                          └─────────────────────────────┘
                │ OIDC-protected HTTPS
   ┌────────────────────────────┐
   │   Cloud Scheduler            │
   │   run-all-scouts · every 6h  │
   │   warm-up · every 5 min      │
   └────────────────────────────┘
```

**Trust boundaries:**
- **On-chain** = agent registration, NFT ownership, agent stats, breed records, proposal hashes, V5 agent ownership registry
- **Off-chain** = YouTube transcripts, Gemini outputs, agent memory, configuration, lineage narrative, KMS-managed key operations
- **Owner control** = strategic proposals require a signed approval hash before they are recorded on-chain; the platform never moves user funds

---

## Smart contracts (V5)

### Active deployments

| Chain | Address | Version | Notes |
|-------|---------|---------|-------|
| **BNB Testnet (97)** | [`0x4cCB2f96f66B4E06E5A78da25797b7386814C313`](https://testnet.bscscan.com/address/0x4cCB2f96f66B4E06E5A78da25797b7386814C313) | **V5** (25 Sep 2026) | Default for new visitors. Has agentOwner registry + escrow-based breeding + marketplace-ready transfer. |
| Ethereum Sepolia (11155111) | [`0x0fE75B47bFE360A305F5D56607d976448fF7c9e7`](https://sepolia.etherscan.io/address/0x0fE75B47bFE360A305F5D56607d976448fF7c9e7) | **V5** (25 Sep 2026) | Same V5 features as BNB. |
| Mantle Sepolia (5003) | [`0x66fD8b5411856D42c08D9356e879a6e7dF0c9419`](https://explorer.sepolia.mantle.xyz/address/0x66fD8b5411856D42c08D9356e879a6e7dF0c9419) | **V4** (May 2026) | **Intentionally not redeployed.** The 6 legacy live agents (Naruto, Coco, 0xLabs, SuperAgent + 2 bred) live here. Switching to V5 would orphan them. Use the chain selector in the navbar to access them. |

Source: [`contracts/contracts/AsajuAgentV5.sol`](contracts/contracts/AsajuAgentV5.sol), [`contracts/contracts/MAEFNFTV4.sol`](contracts/contracts/MAEFNFTV4.sol).

> **Note on contract names.** The deployed contract retains its `MAEFNFTV4` name for chain continuity — renaming the contract would invalidate every existing registration, NFT, breed record, and proposal hash. "ASAJU" branding is at the application, prompt, and user-facing surface layers; the on-chain bytecode is unchanged.

### What V5 adds over V4

| Capability | V4 | V5 |
|---|---|---|
| Agent ownership registry (`agentOwner[wallet]`) | ❌ | ✅ |
| `recordExecutedProposal` authorisation | MINTER_ROLE only | Owner OR agent OR MINTER_ROLE (fallback) |
| `breedAgents` charge model | `breedCost` only | `breedCost + spawnFee` prepaid to escrow |
| `spawnBredAgent` subsidy model | MINTER_SERVICE pays 1 MNT | Non-payable — pulls from escrow |
| `transferAgentOwnership` | ❌ | ✅ + marketplace allow-list |
| `withdrawPlatformFees` guard | None | Cannot drain unspent escrow (`balance > pendingProvisionEscrow`) |
| Agent gas deduction for autonomous execution | MINTER_SERVICE | User's wallet (Mode A) or agent's own (Mode B) |

V5's `agentOwner` registry is the missing primitive that lets the same wallet own multiple agents, lets the owner co-sign on behalf of the agent, and lets a marketplace transfer atomically swap ownership without invalidating any on-chain history.

Roles (V5):
- Deployer `0xe52bb4B913B83A71d0d2deD47683B1154bf2560b` — `DEFAULT_ADMIN_ROLE`
- Minter Service `0xCBA7951a8b5AE81303AC5E1017e34bF50A342D22` — `MINTER_ROLE` (now backup-only; the user or agent is the primary signer)

Key functions: `spawnAgent`, `spawnBredAgent`, `mintAttendanceNFT`, `breedAgents`, `recordExecutedProposal`, `transferAgentOwnership`, `setFees`, `setBreedCost`, `getAgentStats`, `setMarketplaceApproval`.

Key events: `NFTMinted`, `AgentsBred`, `WisdomUnlocked`, `ProposalExecuted`, `AgentOwnershipTransferred` (new in V5).

A regression test ([`backend/tests/test_abi_event_parity.py`](backend/tests/test_abi_event_parity.py)) compares the keccak256 topic0 of every event declared in the hand-maintained Python ABI against the compiled Solidity artifact. This guarantees the backend never silently misses an event because the ABI drifted from the deployed contract.

---

## Per-chain fees (calibrated, mutable via setFees)

Fees are NOT hardcoded in the chain config; they're measured against live gas prices and recalibrated via [`contracts/scripts/calibrate-fees.js`](contracts/scripts/calibrate-fees.js). The V5 contract has a `setFees()` mutator so recalibration is a single transaction, not a redeploy. To avoid the exact `chains.ts ≠ on-chain` mismatch that bit us this week, run [`contracts/scripts/verify-fee-sync.js`](contracts/scripts/verify-fee-sync.js) before declaring a chain production-ready.

| Chain | spawn fee | agent provision | breed cost | runway (mints) |
|---|---|---|---|---|
| **BNB Testnet (97)** | **0.01 tBNB** | **0.005 tBNB** | ~0.02 tBNB | ~250 |
| ETH Sepolia (11155111) | 0.005 ETH | 0.0025 ETH | ~0.01 ETH | ~7 (gas-volatile) |
| Mantle Sepolia (5003) | 1 MNT | 0.5 MNT | ~2 MNT | ~50 |

Auto-replenishment threshold is 10% of the agent's native token provision. So:
- BNB testnet: 0.0005 tBNB triggers a top-up
- ETH Sepolia: 0.00025 ETH triggers a top-up
- Mantle Sepolia: 0.05 MNT triggers a top-up (the historical default, kept for the V4 contract)

---

## CoinMarketCap integration (deep)

ASAJU uses CoinMarketCap as the agent's primary market signal source. The integration lives in [`backend/services/market_data_service.py`](backend/services/market_data_service.py) and is exposed through [`backend/routers/market.py`](backend/routers/market.py).

### Endpoints currently consumed

| Endpoint | Purpose | Where it's used |
|----------|---------|-----------------|
| `/v1/cryptocurrency/quotes/latest` | Live prices for BTC, ETH, MNT | Dashboard `MarketSnapshotCard` + `llm_service._format_market_context` |
| `/v1/cryptocurrency/info` | Token metadata, logos | Wisdom summary rendering |
| `/v2/tools/price-conversion` | Price conversions | Wisdom summary rendering |
| `/v2/cryptocurrency/ohlcv/historical` | Candlestick data | Wisdom summary |
| `/v1/cryptocurrency/trending/latest` | Coins trending by search interest | Dashboard `MarketIntelligenceHub` (Hot tab) |
| `/v1/cryptocurrency/trending/gainers-losers` | Biggest % movers | Dashboard `MarketIntelligenceHub` (Gainers/Losers tabs) + `llm_service._format_cmc_signals` (proposal prompt grounding) |
| `/v1/cryptocurrency/trending/most-visited` | Traffic-ranked trending | Dashboard `MarketIntelligenceHub` (supplement to listings) |
| `/v1/cryptocurrency/listings/new` | Recently listed tokens | Dashboard `MarketIntelligenceHub` (Listings tab) + `llm_service._format_cmc_signals` |
| `/v1/cryptocurrency/airdrops` | Active airdrops (unique to CMC) | Dashboard "Airdrop watch" panel + `llm_service._format_cmc_signals` |
| `/v1/global-metrics/quotes/latest` | Total mcap + BTC dominance | Dashboard hero strip + `llm_service._format_cmc_signals` |
| `/v1/content/latest` | News headlines | LLM context for proposal + chat |
| `/v3/fear-and-greed/latest` | Market sentiment | Dashboard sentiment bar + proposal context |
| `/v4/dex/pools/multi` (8 networks) | On-chain DEX liquidity | Dashboard "Liquidity Watch" |
| **`/v5/cmc-ai/latest`** | **CMC's own AI-generated market thesis** (highest-priority prompt context) | Dashboard `CmcAiSummaryCard` + `llm_service._format_cmc_signals`. Currently 403 with Startup-tier CMC plan (Phase 1 Enterprise-only); fail-soft renders "feed unavailable" and agent falls back to other endpoints. |

Eleven endpoints in total. Nine are live today; two (`/v5/cmc-ai/latest` and `/v1/content/latest`) return 403 with our Startup CMC plan and are designed to light up the moment our plan tier or Phase 2 unlocks them — fail-soft throughout.

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

## Local development

### Prerequisites

- Node.js ≥ 20
- Python ≥ 3.11
- A Gemini API key (for `LLM_API_KEY`)
- A CoinMarketCap API key (Startup tier is sufficient for 9 of 11 endpoints)
- A YouTube Data API key (optional — only needed for Auto Scout)
- A Firestore project + service account JSON (any GCP project will do for local)

### Frontend

```bash
npm install
cp .env.example .env   # fill VITE_GCP_BACKEND_URL, contract addresses per chain
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
pytest -v              # 164+ tests
```

### Environment variables (frontend)

```
# BNB testnet (default for new visitors)
VITE_CONTRACT_ADDRESS_97=0x4cCB2f96f66B4E06E5A78da25797b7386814C313
# ETH Sepolia
VITE_CONTRACT_ADDRESS_11155111=0x0fE75B47bFE360A305F5D56607d976448fF7c9e7
# Mantle Sepolia (legacy V4, default fallback if chainId missing on agent)
VITE_CONTRACT_ADDRESS_5003=0x66fD8b5411856D42c08D9356e879a6e7dF0c9419

VITE_GCP_BACKEND_URL=http://localhost:8080
```

### Environment variables (backend, production)

```
# Per-chain config — set the one your Cloud Run uses for primary traffic
CONTRACT_ADDRESS=0x4cCB2f96f66B4E06E5A78da25797b7386814C313
CHAIN_ID=97
GCP_PROJECT_ID=your-project
USE_SECRET_MANAGER=true
KMS_KEY_NAME=projects/<project>/locations/<region>/keyRings/<ring>/cryptoKeys/<key>
```

GCP Secret Manager secrets (create with `echo -n "VALUE" | ...` — trailing newlines break `eth_account`):
- `MINTER_SERVICE_PRIVATE_KEY` — minter wallet, holds `MINTER_ROLE` (now backup-only in V5)
- `LLM_API_KEY` — Gemini API key
- `YOUTUBE_API_KEY` — YouTube Data API key (Auto Scout)

---

## Tests

| Layer | Count | Coverage |
|-------|------:|---------|
| Backend (pytest) | 164 | All routers, market data normalization, ABI parity, current-insight endpoint, proposal CMC prompt grounding, comprehension scoring, fee parity |
| Frontend (vitest) | 135 | Components, hooks, utilities, format helpers, chain registry |
| TypeScript (tsc) | clean | All source files |
| npm audit | 0 | No vulnerabilities |
| pip-audit | 0 | No known vulnerabilities |

CI runs both suites on every push via [`.github/workflows/`](.github/workflows/).

---

## Status snapshot

| Capability | Status |
|------------|--------|
| Agent creation + testnet funding | Implemented, V5 escrow-based |
| YouTube analysis (transcript + metadata fallback) | Implemented, milestone-mint only |
| On-chain learning attestation | Implemented, milestone-based (level-ups, wisdom-unlock) — not every video |
| Autonomous signing (Mode B) | Implemented, KMS-protected, agent signs with own key |
| Auto Scout | Implemented, opt-in per agent, OIDC-protected Cloud Scheduler trigger every 6h |
| Agent chat, wisdom reports, proposals | Implemented, Gemini-grounded, raw CMC snapshot persisted |
| Breeding and lineage | Implemented V5: owner prepays spawn fee, agent signs to activate |
| Multi-chain testnet (BNB 97 + Mantle 5003 + ETH Sepolia 11155111) | Implemented, BNB is default for new visitors |
| Market-aware proposals (CMC + CoinGecko) | Implemented, raw snapshot stored alongside proposal + trigger_tags |
| V5 agent ownership registry + marketplace transfer | Smart contract ready; backend webhook not yet wired |
| Autonomous financial execution | **Not enabled.** `AUTONOMOUS_VAULT_ADDRESS` is intentionally unset. Any future signal-triggered proposal still requires the owner's signature before anything moves. |
| Cloud Scheduler `run-all-scouts` job `maef-auto-scout` | ENABLED, asia-southeast1, every 6 hours (verified live) |
| Cloud Scheduler `asaju-warmup` job | ENABLED, asia-southeast1, every 5 minutes (cold-start mitigation) |

---

## Roadmap

1. **Personal market co-pilot** — agents watch live market data continuously and raise a high-priority proposal with reasoning when a strong signal emerges. The owner always signs; the agent never executes.
2. **Wisdom Digest** — milestone-based minting shipped; next is selective per-event digest summaries for agent chat context.
3. **Marketplace transfer handler** — react to V5's `AgentOwnershipTransferred` event to migrate `user_wallet` on the Firestore side.
4. **Policy-constrained execution** — any future real-fund action stays behind explicit, auditable policy limits.
5. **Reliability and information architecture** — ongoing hardening of wallet compatibility, dashboard IA, observability.

---

## Project layout

```
.
├── src/                       React + Vite frontend
│   ├── views/                 Page-level views (Dashboard, MyAgents, Marketplace, …)
│   ├── components/            UI components (MarketIntelligenceHub, AgentInsightsSection, ReasoningSlideOver, …)
│   ├── hooks/                 useBlockchain, useScoutLogListener
│   ├── lib/blockchain/        ABI, chains.ts (DEFAULT_CHAIN_ID = 97 BNB), mantleService
│   ├── services/              cloudRunService (HTTP client)
│   └── App.tsx                Root
├── backend/                   FastAPI service
│   ├── routers/               HTTP endpoints (agents, proposals, events, market, inbox, chat, public, …)
│   ├── services/              llm_service, web3_service, market_data_service, scout_service, comprehension_service, …
│   ├── core/                  config, database, kms_service
│   ├── tests/                 pytest suite (164 tests)
│   ├── requirements.txt
│   └── main.py                Entry point
├── contracts/                 Solidity sources + Hardhat
│   ├── contracts/
│   │   ├── MAEFNFTV4.sol      Legacy V4 (Mantle Sepolia, ETH Sepolia — pre-fork)
│   │   └── AsajuAgentV5.sol    V5: agentOwner registry, escrow breeding, marketplace transfer
│   └── scripts/               deploy-v5.js, calibrate-fees.js, verify-fee-sync.js, verify-v5.js, smoke-v5.js
├── .github/workflows/         CI (backend-tests, frontend-tests)
├── docs/                      Internal design notes (gitignored)
└── README.md                  You are here
```
