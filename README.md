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
3. **Ground proposals in live market context** — every proposal carries the raw CoinMarketCap + CoinGecko snapshot that fed the agent's reasoning, and a short trail of the exact data points that drove it, so the owner can audit the decision.
4. **Recommend a specific action, owner decides** — each proposal states what the agent would do (buy, sell, hold, or research a named asset) with the live data behind it. The recommendation is recorded for the agent's history when approved; it is never executed as a trade — autonomous financial execution is not enabled.
5. **Mint on-chain learning proofs** only at milestones (level-ups, wisdom-unlock), not on every video. Gas-efficient without losing the record.
6. **Build lineage** through Neural Fusion (breeding) — the offspring's spawn fee is prepaid into escrow by the owner, so the platform's own wallet is never subsidised.
7. **Keep consequential actions human-controlled** — every proposal is signed by the owner or the agent's own wallet. No platform-held key can act on a user's behalf.

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

The dashboard and each agent's page show a live activity pulse: the last video the agent learned and the live CoinMarketCap data it reads, animated only when something genuinely happened recently — so "what is the agent doing" is answered from real state, never a decorative loop.

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
- **On-chain** = agent registration, NFT ownership, agent stats, breed records, proposal hashes, agent ownership registry
- **Off-chain** = YouTube transcripts, Gemini outputs, agent memory, configuration, lineage narrative, KMS-managed key operations
- **Owner control** = strategic proposals require a signed approval hash before they are recorded on-chain; the platform never moves user funds

---

## Smart contracts (V6)

### Active deployments

| Chain | Address | Version | Notes |
|-------|---------|---------|-------|
| **BNB Testnet (97)** | [`0x1d6422DfF98f839c92cc2E23E0E0600d2C31965C`](https://testnet.bscscan.com/address/0x1d6422DfF98f839c92cc2E23E0E0600d2C31965C) | **V6** (30 Sep 2026) | Default for new visitors. No platform-held signing key exists on this contract at all. |
| Ethereum Sepolia (11155111) | [`0xD8F5691436B6647bE7a05BeF7dD637FbbCf819ab`](https://sepolia.etherscan.io/address/0xD8F5691436B6647bE7a05BeF7dD637FbbCf819ab) | **V6** (30 Sep 2026) | Same V6 guarantees as BNB. |
| Mantle Sepolia (5003) | [`0x66fD8b5411856D42c08D9356e879a6e7dF0c9419`](https://explorer.sepolia.mantle.xyz/address/0x66fD8b5411856D42c08D9356e879a6e7dF0c9419) | **V4** (May 2026) | **Intentionally not redeployed.** Live agents with real progress (Naruto, Coco, and others) run here. Redeploying would orphan them. Use the chain selector in the navbar to access them. |

Source: [`contracts/contracts/AsajuAgentV6.sol`](contracts/contracts/AsajuAgentV6.sol), [`contracts/contracts/MAEFNFTV4.sol`](contracts/contracts/MAEFNFTV4.sol).

> **Note on contract names.** The Mantle deployment retains its `MAEFNFTV4` name for chain continuity — renaming it would invalidate every existing registration, NFT, breed record, and proposal hash. "ASAJU" branding is at the application, prompt, and user-facing surface layers; the on-chain bytecode is unchanged.

### What changed, V4 → V5 → V6

| Capability | V4 | V5 | V6 |
|---|---|---|---|
| Agent ownership registry (`agentOwner[wallet]`) | ❌ | ✅ | ✅ |
| `recordExecutedProposal` authorisation | platform key only | owner, agent, or platform key (fallback) | **owner or agent — no platform key exists** |
| `mintAttendanceNFT` authorisation | platform key or agent | platform key or agent | **agent only — no platform key exists** |
| `breedAgents` charge model | `breedCost` only | `breedCost + spawnFee` prepaid to escrow | same as V5 |
| `spawnBredAgent` signer | platform wallet pays 1 MNT | platform key (fallback still present) | **only the wallet that paid to breed — never the platform** |
| `transferAgentOwnership` (marketplace) | ❌ | ✅ | ✅ |
| Minimum gas floor before a proposal executes | ❌ | ❌ | ✅ owner-configurable, off by default |

The practical result: on V6, there is no key the platform holds that can move funds, mint, or approve anything on a user's behalf — not as a fallback, not in an edge case. Every consequential action is signed by the agent's own wallet or its owner. [More detail in this write-up.](https://github.com/Psianturi/asaju/blob/main/contracts/contracts/AsajuAgentV6.sol)

Roles: Deployer `0xe52bb4B913B83A71d0d2deD47683B1154bf2560b` holds contract ownership (fee tuning, marketplace allow-listing) — nothing else. There is no minter role on V6.

Key functions: `spawnAgent`, `spawnBredAgent`, `mintAttendanceNFT`, `breedAgents`, `recordExecutedProposal`, `transferAgentOwnership`, `setFees`, `setBreedCost`, `setMinAgentBalanceForExecution`, `getAgentStats`.

Key events: `NFTMinted`, `AgentsBred`, `WisdomUnlocked`, `ProposalExecuted`, `AgentOwnershipTransferred`.

A regression test ([`backend/tests/test_abi_event_parity.py`](backend/tests/test_abi_event_parity.py)) compares the keccak256 topic0 of every event declared in the hand-maintained Python ABI against the compiled Solidity artifact, so the backend can never silently miss an event because the ABI drifted from the deployed contract.

---

## Per-chain fees (calibrated, mutable via setFees)

Fees are not hardcoded; they're measured against live gas prices and recalibrated via [`contracts/scripts/calibrate-fees.js`](contracts/scripts/calibrate-fees.js). `setFees()` makes recalibration a single transaction, not a redeploy. [`contracts/scripts/verify-fee-sync.js`](contracts/scripts/verify-fee-sync.js) checks the app's configured fees against what the live contract actually enforces before a chain is declared ready.

| Chain | spawn fee | agent provision | breed cost | runway (mints) |
|---|---|---|---|---|
| **BNB Testnet (97)** | **0.01 tBNB** | **0.005 tBNB** | 0.02 tBNB | ~250 |
| ETH Sepolia (11155111) | 0.01 ETH | 0.005 ETH | 0.02 ETH | ~26 (gas-volatile) |
| Mantle Sepolia (5003) | 1 MNT | 0.5 MNT | 2 MNT | ~50 |

Auto-replenishment threshold is 10% of the agent's native token provision. So:
- BNB testnet: 0.0005 tBNB triggers a top-up
- ETH Sepolia: 0.00025 ETH triggers a top-up
- Mantle Sepolia: 0.05 MNT triggers a top-up (the historical default, kept for the V4 contract)

---

## CoinMarketCap integration (deep)

ASAJU uses CoinMarketCap as the agent's primary market signal source. The integration lives in [`backend/services/market_data_service.py`](backend/services/market_data_service.py) and is exposed through [`backend/routers/market.py`](backend/routers/market.py).

### Endpoints currently consumed

**Ten** real CoinMarketCap endpoints, verified 30 Sep 2026 against every `_cmc_get(...)` call site in the codebase (not inferred from old docs — an earlier draft of this table listed two endpoints with no corresponding code at all, and mislabeled three CoinGecko calls as CoinMarketCap; both are fixed below).

| Endpoint | Purpose | Reaches the agent's reasoning? |
|----------|---------|-----------------|
| `/v3/fear-and-greed/latest` | Market sentiment | ✅ Every proposal |
| `/v1/cryptocurrency/trending/gainers-losers` | Biggest % movers | ✅ Every proposal |
| `/v1/cryptocurrency/trending/most-visited` | Traffic-ranked trending | ✅ Folded into "new listings" context when listings are sparse |
| `/v1/cryptocurrency/listings/new` | Recently listed tokens | ✅ Every proposal |
| `/v1/cryptocurrency/airdrops` | Active airdrops (unique to CMC) | ✅ Every proposal |
| `/v1/global-metrics/quotes/latest` | Total market cap + BTC/ETH dominance | ✅ Every proposal |
| `/v1/cryptocurrency/trending/latest` | Coins trending by search interest | ✅ Every proposal |
| `/v1/cryptocurrency/categories` | Sector tags (DeFi, AI, RWA, …) | Dashboard only, for now |
| `/v1/content/latest` | News headlines | ✅ When available — see below |
| `/v5/cmc-ai/latest` | CoinMarketCap's own AI-generated market thesis | ✅ When available — see below |

The last two are wired end-to-end but currently return `403` on our Startup-tier CMC plan (both require Enterprise). The code path is real and tested — when either becomes available on our tier, it starts contributing with no code change. Until then, fail-soft: the dashboard shows a quiet "feed unavailable" state and every proposal still generates from the other eight.

**What's on the dashboard but is honestly CoinGecko, not CoinMarketCap:** live BTC/ETH/MNT prices, OHLC candlesticks, and cross-chain DEX pool liquidity. These are genuinely complementary (CoinMarketCap's OHLC history isn't available on our plan; DEX-level on-chain liquidity isn't a CoinMarketCap product at all) — but they are not CoinMarketCap calls, and we'd rather say so plainly than blur the line.

### How the data reaches the agent's reasoning

[`llm_service._format_cmc_signals()`](backend/services/llm_service.py) renders the advanced signals into prompt text that Gemini sees **every time a proposal is generated**. Each section is included only when its data is present; if a provider is down, the proposal still generates with the available context (fail-soft policy).

The prompt tells Gemini:

> *"Use these advanced CoinMarketCap signals in your reasoning — they're the same data the agent watches live in the dashboard, so the owner expects your proposal to be grounded in them, not invented."*

This means the agent's proposal text surfaces the actual numbers the owner sees in the dashboard — auditable, not hallucinated. Every proposal ships with `trigger_tags` — short, specific citations like *"Fear & Greed at 73"* or *"BTC ▲ +5.2% / 24h"* — that tie each conclusion back to one of the live signals above. The raw market snapshot is also stored alongside the proposal in Firestore so it can be reviewed after the fact. This is the auditable trail, not the two Enterprise-gated feeds, that we'd point a reviewer at first.

### Cache strategy

CMC has rate limits and the agent's proposal flow is chatty. We cache every CMC read in Firestore with per-data-type TTLs (sentiment 1 hour, news 30 min, trending 10 min, new listings 1 hour). All TTLs respect CMC's terms of use.

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
- A CoinMarketCap API key (Startup tier is sufficient for 8 of the 10 endpoints; two require Enterprise and fail soft)
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
pytest -v              # 181+ tests
```

### Environment variables (frontend)

```
# BNB testnet (default for new visitors)
VITE_CONTRACT_ADDRESS_97=0x1d6422DfF98f839c92cc2E23E0E0600d2C31965C
# ETH Sepolia
VITE_CONTRACT_ADDRESS_11155111=0xD8F5691436B6647bE7a05BeF7dD637FbbCf819ab
# Mantle Sepolia (legacy V4, default fallback if chainId missing on agent)
VITE_CONTRACT_ADDRESS_5003=0x66fD8b5411856D42c08D9356e879a6e7dF0c9419

VITE_GCP_BACKEND_URL=http://localhost:8080
```

### Environment variables (backend, production)

```
# Per-chain config — set the one your Cloud Run uses for primary traffic
CONTRACT_ADDRESS=0x1d6422DfF98f839c92cc2E23E0E0600d2C31965C
CHAIN_ID=97
GCP_PROJECT_ID=your-project
USE_SECRET_MANAGER=true
KMS_KEY_NAME=projects/<project>/locations/<region>/keyRings/<ring>/cryptoKeys/<key>
```

GCP Secret Manager secrets (create with `echo -n "VALUE" | ...` — trailing newlines break `eth_account`):
- `MINTER_SERVICE_PRIVATE_KEY` — still used for Mantle (V4) and for scheduled/admin operations; V6 chains have no role for this key to fill at all
- `LLM_API_KEY` — Gemini API key
- `YOUTUBE_API_KEY` — YouTube Data API key (Auto Scout)

---

## Tests

| Layer | Count | Coverage |
|-------|------:|---------|
| Backend (pytest) | 181 | All routers, market data normalization, ABI parity, current-insight endpoint, proposal CMC prompt grounding, comprehension scoring, fee parity, V6 generation detection |
| Frontend (vitest) | 148 | Components, hooks, utilities, format helpers, chain registry, breed cost calculation |
| TypeScript (tsc) | clean | All source files |
| npm audit | 0 | No vulnerabilities |
| pip-audit | 0 | No known vulnerabilities |

CI runs both suites on every push via [`.github/workflows/`](.github/workflows/).

---

## Status snapshot

| Capability | Status |
|------------|--------|
| Agent creation + testnet funding | Implemented, escrow-based |
| YouTube analysis (transcript + metadata fallback) | Implemented, milestone-mint only |
| On-chain learning attestation | Implemented, milestone-based (level-ups, wisdom-unlock) — not every video |
| Autonomous signing (Mode B) | Implemented, KMS-protected, agent signs with own key |
| Auto Scout | Implemented, opt-in per agent, OIDC-protected Cloud Scheduler trigger every 6h |
| Agent chat, wisdom reports, proposals | Implemented, Gemini-grounded, raw CMC snapshot persisted; each proposal carries a recommended action (buy / sell / hold / research) that is recorded, not executed |
| Breeding and lineage | Implemented: owner prepays spawn fee, agent signs to activate |
| Multi-chain testnet (BNB 97 + Mantle 5003 + ETH Sepolia 11155111) | Implemented, BNB is default for new visitors |
| Market-aware proposals (CMC + CoinGecko) | Implemented, raw snapshot stored alongside proposal + trigger_tags |
| Agent ownership registry + marketplace transfer | Smart contract ready; backend webhook not yet wired |
| Autonomous financial execution | **Not enabled.** `AUTONOMOUS_VAULT_ADDRESS` is intentionally unset. Any future signal-triggered proposal still requires the owner's signature before anything moves. |
| Cloud Scheduler `run-all-scouts` job `maef-auto-scout` | ENABLED, asia-southeast1, every 6 hours (verified live) |
| Cloud Scheduler `asaju-warmup` job | ENABLED, asia-southeast1, every 5 minutes (cold-start mitigation) |

---

## Business model

ASAJU is free on testnet. The path to a real product isn't ads or a subscription — it's a small cut of value the agent actually creates. When an agent's proposal leads to a trade the owner takes, ASAJU takes a modest performance fee on the gain (target: 12%), charged only on realised profit, from a separate trading wallet the owner explicitly funds — never from the wallet holding their agent's NFTs and history. No proposal, no trade, no fee. The agent's core identity and learning record stay free and owned by the user regardless of whether they ever opt into that wallet.

## Roadmap

1. **Personal market co-pilot** — agents watch live market data continuously and raise a high-priority proposal with reasoning when a strong signal emerges. The owner always signs; the agent never executes.
2. **Wisdom Digest** — milestone-based minting shipped; next is selective per-event digest summaries for agent chat context.
3. **Marketplace transfer handler** — react to the `AgentOwnershipTransferred` event to migrate `user_wallet` on the Firestore side.
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
│   ├── tests/                 pytest suite (181 tests)
│   ├── requirements.txt
│   └── main.py                Entry point
├── contracts/                 Solidity sources + Hardhat
│   ├── contracts/
│   │   ├── MAEFNFTV4.sol      Legacy V4 (Mantle Sepolia only)
│   │   ├── AsajuAgentV5.sol    V5: agentOwner registry, escrow breeding, marketplace transfer
│   │   └── AsajuAgentV6.sol    V6: no platform-held signing key anywhere in the contract
│   └── scripts/               deploy-v6.js, calibrate-fees.js, verify-fee-sync.js, verify-v6.js, smoke-v6.js
├── .github/workflows/         CI (backend-tests, frontend-tests)
├── docs/                      Internal design notes (gitignored)
└── README.md                  You are here
```
