# ASAJU 

ASAJU is a **testnet prototype for autonomous knowledge agents**. A user creates an agent with an independent wallet and gas reserve; the agent analyses selected YouTube content, retains a learning history, and records an on-chain attestation of that work.

The original **MAEF** contract name remains in source code and deployed contracts.

> **Live application:** [asaju.vercel.app](https://asaju.vercel.app)  
> **Current network scope:** Mantle Sepolia and Ethereum Sepolia. ASAJU does not handle real funds and is not financial advice.

## The Problem

AI users who understand the basics of blockchain learn from a fast-moving stream of technical videos, talks, and livestreams. Researcher and community-lead workflows are the initial focus, but the product is designed for any user who wants an AI agent with a persistent, inspectable learning trail. Conventional summaries are ephemeral: they have no persistent agent identity, no durable record of how knowledge accumulated, and no way to distinguish a one-off answer from an agent's continuing research.

## What ASAJU Builds

ASAJU gives a topic-focused agent a durable research workflow across supported networks. Mantle and Ethereum are current testnet deployments; neither is positioned as the product's primary blockchain.

1. **Create an agent** with an independent address, a configurable niche, personality, and testnet gas reserve.
2. **Analyse YouTube content** submitted by a user or discovered through opt-in Auto Scout.
3. **Store the learning record** in the agent's Firestore memory and write the submitted event data plus AI summary to an on-chain NFT record.
4. **Build capability over time** through event history, skill scores, cross-event wisdom reports, and strategic proposals.
5. **Keep consequential actions human-controlled**: strategic proposals require approval before they are recorded on-chain.

The product is not an NFT factory. The NFT is a verifiable record of an agent's learning action; the product is the agent's persistent knowledge workflow.

## What Is Verified On-Chain

The smart contract verifies that an authorised signer minted an NFT and records the event data supplied in that transaction: agent wallet, event title and URL, platform, summary, niche, timestamp, and evolving agent statistics.

It does **not** independently prove that a video was watched, that an event occurred, or that an AI summary is objectively correct. For that reason, this README calls the asset an **on-chain learning attestation** or **agent analysis record**. "Proof of Attendance" is the contract's historical name, not a claim of independently verified attendance.

## Current Scope and Status

| Capability | Current status | Notes |
|---|---|---|
| Agent creation and testnet funding | Implemented | Users invoke `spawnAgent()` from a compatible wallet. |
| YouTube analysis | Implemented | HTTPS URLs are restricted to `youtube.com`, `www.youtube.com`, and `youtu.be`. Transcript retrieval falls back to metadata-only analysis when no transcript is available. |
| On-chain learning attestation | Implemented | Stores submitted event data and AI summary through `mintAttendanceNFT()`. |
| Autonomous signing (Mode B) | Implemented | A spawned agent wallet can sign its own mint transaction using its own gas reserve. |
| Auto Scout | Implemented | Opt-in; Cloud Scheduler runs discovery on each agent's configured cooldown. |
| Agent chat, wisdom reports, and proposals | Implemented | Powered by stored event memory and Gemini. Proposal recording is human-in-the-loop. |
| Breeding and lineage | Implemented | Guarded backend workflow plus an on-chain breed record; parent agents must share a chain. |
| Multi-chain testnet support | Implemented | Mantle Sepolia and Ethereum Sepolia. Ethereum's spawn-to-Mode-B mint path has been verified on its deployed V4 contract. |
| Wisdom Digest minting | Direction decided, not yet implemented | Moving from one NFT per analysed video toward milestone-based minting (level-ups, wisdom-unlock thresholds) instead of minting on every video. |
| Market-aware proposals | Implemented | Proposals fetch live CoinGecko/CoinMarketCap context before generation; the raw snapshot is stored alongside the proposal for independent audit. |
| Autonomous financial execution | Not active | `AUTONOMOUS_VAULT_ADDRESS` is not configured. No production trading or real-fund execution exists. Any future signal-triggered proposal still requires the owner's signature before anything moves. |

## Live Deployments

| Component | URL / Address | Status |
|---|---|---|
| Frontend | [asaju.vercel.app](https://asaju.vercel.app) | Live testnet application |
| Backend | [Cloud Run health endpoint](https://mantle-agentic-event-21898396920.asia-southeast1.run.app/health) | Production runtime; liveness verified |
| Mantle Sepolia | [`0x66fD8b5411856D42c08D9356e879a6e7dF0c9419`](https://explorer.sepolia.mantle.xyz/address/0x66fD8b5411856D42c08D9356e879a6e7dF0c9419) | Active legacy-compatible deployment |
| Ethereum Sepolia | [`0x9FEF11E45cFD550b33F13A31E8d80BE61cda80f4`](https://sepolia.etherscan.io/address/0x9FEF11E45cFD550b33F13A31E8d80BE61cda80f4) | Active V4 deployment |

Deprecated contract addresses are intentionally omitted from this product overview. Keep migration history in deployment documentation rather than presenting it as an active user choice.

Every push to `main` deploys automatically to Cloud Run.

## Agent Lifecycle

```text
SPAWN    User creates an agent record, then calls spawnAgent() on the selected testnet.
      The contract registers the wallet and transfers its configured gas provision.

LEARN    The user submits a permitted YouTube URL, or enables Auto Scout.
      ASAJU fetches available transcript content, asks Gemini for a concise summary,
      then classifies the content category for the agent's skill profile.

ATTEST  The agent wallet self-signs the mint in Mode B when funded and registered.
      The contract stores an on-chain learning attestation; Firestore stores richer
      agent state, event history, scout logs, and proposal context.

EVOLVE  Event history raises the agent's level and unlocks cross-event reporting,
      human-reviewed strategic proposals, and Neural Fusion eligibility.

GOVERN  A human reviews a strategic proposal before the backend records its approved
      proposal hash on-chain. Autonomous financial execution is not enabled.

FUSE    Eligible agents on the same chain create an offspring record with lineage,
      inherited context, and an independently funded agent wallet.
```

---

## Agent Maturity Model

Agent levels are derived from accumulated successful mint records. They are a transparent progress signal, not a measure of AI capability or a guarantee of decision quality.

| Level | Records required | Current meaning |
|---|---:|---|
| 1 | 0 | Agent identity, YouTube analysis, and on-chain learning attestations. |
| 2 | 2 | A growing event history and skill-score profile. |
| 3 | 4 | Strategic Consult and guarded Neural Fusion eligibility. |
| 4 | 6 | Cross-event Wisdom Report and deeper lineage context. |
| 5 | 8 | Milestone for future policy-constrained execution; no autonomous financial action is active. |

---

## Operational Limits and Guardrails

- **Spawn quota:** maximum **3 directly spawned agents** per wallet per supported network. Bred offspring do not consume this quota.
- **Breeding constraints:** parent level 3+, maximum 3 breedings per parent, 24-hour cooldown, same-chain parents, and no self-breeding.
- **Mode B gas autonomy:** agents need native-token balance for autonomous signing. A low balance requires a user-funded top-up before retry.
- **Auto Scout:** disabled by default and only runs for agents whose owner opted in. Scheduler requests are OIDC-protected.
- **Content scope:** the backend accepts HTTPS YouTube URLs only. Luma, Eventbrite, and Zoom integrations were removed because they did not have end-to-end integrations.

---

### Strategic Consult — Human-in-the-Loop (HITL)

At Level 3+, Gemini can generate a proposal from an agent's stored event history. A human reviews the proposal before the service records an approval hash through the contract's `MINTER_ROLE` flow.

An approved proposal increases the agent's on-chain heritage score by 5, capped at 100. The contract records the proposal hash and approval event; proposal text, source context, and rejection feedback remain in Firestore.

This is governance-assisted recommendation, not autonomous execution. It must not be represented as investment advice or an automated trading feature.

---

### Neural Fusion (Agent Breeding)

Two eligible agents on the same chain can create an offspring. The contract persists a breed record, while the backend creates an independent wallet, lineage metadata, and a limited inherited event context in Firestore.

The backend enforces ownership, maturity, same-chain, quota, cooldown, and idempotency guardrails before creating the offspring record. The chain confirms the breeding payment and offspring key; it does not independently reproduce every backend eligibility rule. This distinction is intentional and should remain clear to users.

---

### Auto Scout

Cloud Scheduler calls an OIDC-protected endpoint for agents whose owners enabled Auto Scout. The Secretary discovery path searches YouTube by the agent's niche, filters previously seen URLs, and asks Gemini to rank a candidate. The current logic uses relevance and gas-aware thresholds before attempting an attestation.

Every decision is written as a Firestore scout log. Owners can enable or disable the feature and set the scout interval. Manual attendance does not yet use the same quality gate; that gap is one reason the proposed Wisdom Digest architecture must be designed before expanding mint volume.

---

### Skill Scores

Each agent has a fixed starting niche, but `skill_scores` tracks the categories detected from successful event summaries. The score currently rises by one for each successful mint in the detected category. It is an explainable activity count, not an AI-quality, financial-performance, or expertise score.

---

### Wisdom Reports

Agents with stored event summaries can request an off-chain Gemini cross-event report. Reports include event-grounded observations and strategic prompts; they are not minted automatically and are not financial advice.

---

### Memory Echoes (Agent Chat)

Agent chat is grounded with the event summaries and lineage context stored for that agent. The source material remains off-chain in Firestore, which allows richer context than the contract stores but also means the response is a service-generated interpretation rather than an on-chain fact.

---

## Sub-Agent Architecture

The product models four work roles. Secretary, Scribe, and Mint-Master correspond to implemented discovery, summarisation, and transaction steps. Social-Lite is an interface/conceptual role and should not be presented as a live social-network integration.

| Sub-Agent | Role |
|-----------|------|
| **Secretary** | YouTube discovery, URL resolution, and Auto Scout decision support |
| **Scribe** | Transcript retrieval and Gemini summary generation |
| **Social-Lite** | Conceptual future role for community signal analysis |
| **Mint-Master** | Gas-aware transaction coordination and NFT minting |

---

## Architecture and Trust Boundaries

```text
Browser (React + Vite)             Compatible EIP-1193 wallet
                        |                                      |
                        | dashboard and user-initiated calls   | user pays spawn / breed testnet fees
                        v                                      v
Cloud Run (FastAPI)  ---------------->  Supported testnet contracts
      |  Firestore: agent state, event history,     | agent registration, NFTs,
      |  scout logs, proposals, lineage             | event fields, stats, breed records,
      |  Gemini: summary, chat, report, scoring     | proposal hashes
      |  YouTube: discovery and transcript source   |
      |  KMS + Secret Manager: managed service keys |
      v
Cloud Scheduler (OIDC-protected Auto Scout)
```

**On-chain:** registration, NFT ownership, event fields submitted during minting, agent statistics, breed records, and proposal hashes.  
**Off-chain:** video retrieval, Gemini outputs, richer memory, agent configuration, quality decisions, lineage narrative, and service-managed key operations.

This is a managed autonomy model. ASAJU creates a distinct wallet for each agent, but the service encrypts its key with GCP KMS and decrypts it only to sign authorised operations. It is therefore inaccurate to call the model user self-custody; users do not provide their personal wallet seed phrase to ASAJU, but the service controls the agent key under its cloud IAM policy.

---

## Smart Contract — MAEFDynamicNFTV4

The contract source lives in [`contracts/contracts/MAEFNFTV4.sol`](contracts/contracts/MAEFNFTV4.sol). It handles agent registration, gas provision, learning-attestation minting, agent-level statistics, breeding records, and proposal approval records.

Deployments are compatible but not identical. Ethereum Sepolia uses the fee-configurable V4 deployment. The active Mantle Sepolia deployment predates the mutable-fee upgrade and is read through legacy immutable fee getters by the backend compatibility layer. Product copy must not imply that every active deployment supports identical administrative controls.

| Chain | Address | Deployment behavior |
|-------|---------|---------------------|
| Mantle Sepolia (5003) | [`0x66fD...c9419`](https://explorer.sepolia.mantle.xyz/address/0x66fD8b5411856D42c08D9356e879a6e7dF0c9419) | Legacy-compatible fee getters |
| Ethereum Sepolia (11155111) | [`0x9FEF...a80f4`](https://sepolia.etherscan.io/address/0x9FEF11E45cFD550b33F13A31E8d80BE61cda80f4) | Fee-configurable V4 |

Adding a new chain requires a deployment entry plus matching configuration in [`src/lib/blockchain/chains.ts`](src/lib/blockchain/chains.ts) and [`backend/core/config.py`](backend/core/config.py).

| Function | Description |
|----------|-------------|
| `spawnAgent(agentWallet)` | Registers agent, provisions `agentProvision` in gas reserve, sets `isAgentSpawned=true` |
| `spawnBredAgent(agentWallet, offspringId)` | Links offspring to BreedRecord, activates Mode B for offspring |
| `mintAttendanceNFT(...)` | Proof-of-Attendance NFT — dual-auth: `MINTER_ROLE` OR spawned agent self-signs |
| `breedAgents(p1, p2, offspringId, gen, score)` | Records breed on-chain, emits `AgentsBred` event. Both parents must be on the same chain. |
| `recordExecutedProposal(agentWallet, hash)` | HITL governance — MINTER_ROLE only, +5 Heritage Score |
| `setFees(spawnFee, agentProvision)` / `setBreedCost(cost)` | Owner-only economics calibration, atomic with an invariant so `agentProvision` can never exceed `spawnFee` |
| `getAgentStats(wallet)` | Returns full AgentStats struct |

**Key Events:**
- `NFTMinted(tokenId, agentWallet, eventTitle, agentName, agentLevel, timestamp)`
- `AgentsBred(user, offspringKey, parent1Wallet, parent2Wallet, generation, heritageScore, cost)`
- `WisdomUnlocked(agentWallet, timestamp)`
- `ProposalExecuted(agentWallet, proposalHash, proposalsApprovedTotal, heritageScoreAfter)`

**Roles:**
- Deployer `0xe52bb4B913B83A71d0d2deD47683B1154bf2560b` — `DEFAULT_ADMIN_ROLE`
- Minter Service `0xCBA7951a8b5AE81303AC5E1017e34bF50A342D22` — `MINTER_ROLE`

---

## Transaction Signing and Custody

### Mode B — Agent wallet signs

After `spawnAgent()` registers and funds the wallet, the backend decrypts the KMS-protected agent key in memory and uses it to sign `mintAttendanceNFT()`. The independent agent wallet pays the transaction gas from its provisioned testnet balance.

The regular Mode B attendance path is intentionally strict: a low-balance or unauthorised agent produces a structured failure rather than silently spending the minter service's funds. The owner can top up the agent wallet and retry.

### Mode A — Service wallet signs

The minter service wallet holds `MINTER_ROLE` and performs administrative operations such as `recordExecutedProposal()` and bred-agent activation. It can support explicit administrative minting, but it is not the normal signer for a funded Mode B agent.

### Custody statement

Agent wallets are independent from a user's connected wallet, but their keys are service-managed and KMS-protected. They are not exportable user seed phrases or non-custodial user wallets. This model is appropriate for the current testnet prototype; mainnet use requires explicit custody, authorization, recovery, and incident-response policies.

---

## Environment Variables

### Frontend — Vercel Dashboard

```
VITE_NFT_CONTRACT_ADDRESS_SEPOLIA=0x66fD8b5411856D42c08D9356e879a6e7dF0c9419
VITE_NFT_CONTRACT_ADDRESS=0x66fD8b5411856D42c08D9356e879a6e7dF0c9419
VITE_GCP_BACKEND_URL=https://mantle-agentic-event-21898396920.asia-southeast1.run.app
```

### Backend — Cloud Run

```
CONTRACT_ADDRESS=0x66fD8b5411856D42c08D9356e879a6e7dF0c9419
CHAIN_ID=5003
GCP_PROJECT_ID=agentic-event-factory
USE_SECRET_MANAGER=true
KMS_KEY_NAME=projects/agentic-event-factory/locations/asia-southeast1/keyRings/maef-keyring/cryptoKeys/agent-key
```

GCP Secret Manager secrets:
- `MINTER_SERVICE_PRIVATE_KEY` — minter wallet, holds `MINTER_ROLE`
- `LLM_API_KEY` — Gemini API key
- `YOUTUBE_API_KEY` — YouTube Data API key (enables Auto Scout)

> Always create secrets with `echo -n "VALUE" | ...` — trailing newlines break eth_account.

### Local Development

```bash
# Frontend
cp .env.example .env
# Set: VITE_GCP_BACKEND_URL=http://localhost:8080
npm install && npm run dev

# Backend
cd backend
pip install -r requirements.txt
cp .env.example .env   # fill in values
uvicorn main:app --reload --port 8080
```

---

## Grant MINTER_ROLE (after new contract deploy)

```bash
cd contracts
MINTER_WALLET=0xCBA7951a8b5AE81303AC5E1017e34bF50A342D22 \
  npx hardhat run scripts/grant-minter-role.js --network mantleSepolia
```

---

## Evidence for Review

- **Application:** [ASAJU AI](https://asaju.vercel.app)
- **Runtime liveness:** [Cloud Run health](https://mantle-agentic-event-21898396920.asia-southeast1.run.app/health)
- **Contracts:** [Mantle Sepolia explorer](https://explorer.sepolia.mantle.xyz/address/0x66fD8b5411856D42c08D9356e879a6e7dF0c9419) and [Ethereum Sepolia explorer](https://sepolia.etherscan.io/address/0x9FEF11E45cFD550b33F13A31E8d80BE61cda80f4)

## Roadmap

1. **Personal market co-pilot:** agents that continuously watch live market data and, when a significant signal emerges, raise a high-priority proposal with their reasoning — never an executed trade. The owner always signs before anything moves.
2. **Wisdom Digest:** move from one NFT per video toward milestone-based minting (level-ups, wisdom-unlock thresholds) — reduces gas cost per agent without reducing the learning record kept in Firestore.
3. **Policy-constrained execution:** any future real-fund action stays behind explicit, auditable policy limits. No autonomous treasury action is enabled today.
4. **Agent Marketplace:** let owners discover and acquire agents with a proven track record, not just an empty NFT shell.
5. **Product reliability and navigation:** ongoing hardening of wallet compatibility, metrics, and the dashboard's information architecture as the above features settle.

