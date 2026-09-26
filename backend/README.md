# ASAJU Backend

FastAPI backend for Autonomous Sovereign Agent for Joint Understanding. Handles multi-chain agent lifecycle (BNB Testnet / Mantle Sepolia / ETH Sepolia), V5 contract integration with agent ownership registry, NFT minting, AI wisdom generation via Gemini, HITL proposal governance, and autonomous event discovery (Auto Scout).

> **Important:** The on-chain contract bytecode is still `MAEFNFTV4.sol` for chain continuity — the "ASAJU" branding lives at the application, prompt, and user-facing surface layers. The codebase rebrand is in progress; legacy comments mentioning "MAEF" are intentional until all Mantle V4 agents migrate.

---

## Running Locally

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env   # fill in real values
uvicorn main:app --reload --port 8080
```

API docs available at `http://localhost:8080/docs` when running locally.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MINTER_SERVICE_PRIVATE_KEY` | Yes | Minter service wallet (holds `MINTER_ROLE` on V5). Backup-only for Mode B — primary signer is the agent's own wallet. |
| `AGENT_PRIVATE_KEY` | Legacy | Old deployer key — kept as fallback only. |
| `LLM_API_KEY` | Yes | Google Gemini API key (wisdom, chat, proposals, scout scoring) |
| `YOUTUBE_API_KEY` | No | YouTube Data API v3 — enables Auto Scout; omit to disable |
| `CONTRACT_ADDRESS` | Yes | Active NFT contract address. **Default for new visitors = V5 on BNB Testnet (97) `0x4cCB2f96f66B4E06E5A78da25797b7386814C313`.** Legacy V4 on Mantle Sepolia (5003) `0x66fD8b5411856D42c08D9356e879a6e7dF0c9419`. ETH Sepolia (11155111) V5 `0x0fE75B47bFE360A305F5D56607d976448fF7c9e7`. |
| `RPC_URL` | No | Active chain RPC (defaults to BNB testnet `https://bsc-testnet-rpc.publicnode.com` for chain 97; fallback to Mantle Sepolia `https://rpc.sepolia.mantle.xyz` for chain 5003) |
| `CHAIN_ID` | Yes | `97` (BNB testnet default), `5003` (Mantle Sepolia legacy), or `11155111` (ETH Sepolia) |
| `GCP_PROJECT_ID` | Yes | GCP project for Firestore and Secret Manager |
| `USE_SECRET_MANAGER` | Yes | `true` = read secrets from GCP Secret Manager; `false` = read from env vars |
| `KMS_KEY_NAME` | No | Full KMS key resource name — enables KMS encryption of agent private keys in Firestore |

---

## GCP Secret Manager

In production (`USE_SECRET_MANAGER=true`), secrets are read from GCP Secret Manager. The Cloud Run service account needs `roles/secretmanager.secretAccessor` on each secret.

**Active secrets:**

| Secret Name | Purpose |
|-------------|---------|
| `MINTER_SERVICE_PRIVATE_KEY` | Admin ops: `recordExecutedProposal()`, `spawnBredAgent()`, Mode A |
| `LLM_API_KEY` | Gemini — wisdom, proposals, chat, scout scoring |
| `YOUTUBE_API_KEY` | Auto Scout event discovery |

### Common Commands

```bash
PROJECT=agentic-event-factory

# List secrets
gcloud secrets list --project=$PROJECT

# Create secret (always use -n to avoid trailing newline!)
echo -n "VALUE" | gcloud secrets create SECRET_NAME \
  --project=$PROJECT --replication-policy=automatic --data-file=-

# Update secret
echo -n "NEW_VALUE" | gcloud secrets versions add SECRET_NAME \
  --project=$PROJECT --data-file=-

# Read current value
gcloud secrets versions access latest --secret=SECRET_NAME --project=$PROJECT

# Grant Cloud Run SA access
gcloud secrets add-iam-policy-binding SECRET_NAME \
  --project=$PROJECT \
  --member="serviceAccount:21898396920-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

> **Important:** Always `echo -n` (no trailing newline). A trailing `\n` causes `Non-hexadecimal digit found` in eth_account.

---

## API Endpoints

### Health

```
GET  /health                            Basic liveness check
GET  /health/blockchain                 Verifies Mantle RPC + contract connectivity
```

### Agent Management

```
POST /api/v1/agent/spawn                Spawn a new agent (name, niche, personality)
POST /api/v1/agent/breed                Neural Fusion — create offspring from 2 parents
GET  /api/v1/agent/list?wallet=...      List all agents for a wallet address
GET  /api/v1/agent/{id}                 Get single agent by ID
POST /api/v1/agent/{id}/mark-funded     Mark agent as funded after MetaMask spawnAgent() TX
PATCH /api/v1/agent/{id}/state          Update agent config (custom instructions, auto scout, etc.)
POST /api/v1/agent/{id}/chat            Chat with agent (uses Gemini + event memory)
POST /api/v1/agent/{id}/wisdom          Generate Wisdom Report (requires 5+ events)
POST /api/v1/agent/{id}/scout           Manual Auto Scout trigger
GET  /api/v1/agent/{id}/scout-logs      Get scout decision log
POST /api/v1/agent/{id}/retry-spawn     Re-trigger spawnBredAgent() for failed bred offspring
DELETE /api/v1/agent/{id}?wallet=...    Delete agent from Firestore
```

### Events

```
POST /api/v1/event/attend               Attend an event (submit URL, generates NFT)
GET  /api/v1/event/list?wallet=...      List all events for a wallet
```

### HITL Proposals

```
POST /api/v1/agent/{id}/propose         Generate a new strategic proposal (Gemini)
GET  /api/v1/agent/{id}/proposals       List pending and executed proposals
POST /api/v1/proposals/{id}/approval-challenge    Create a one-time wallet-signature challenge
POST /api/v1/proposals/{id}/approve               Execute a signed owner-approved proposal on-chain
POST /api/v1/agent/{id}/proposals/{pid}/reject    Reject proposal (mark as rejected)
POST /api/v1/agent/{id}/force-evaluate           Synchronous data→prompt→reasoning→decision pipeline.
                                                 Returns an ephemeral proposal with the same reasoning
                                                 trace. Designed for volatile-market intervention (the
                                                 owner can wake the agent outside the Auto-Scout cycle).
```

`POST /api/v1/proposals/{id}/approve` requires `{ nonce, signer_wallet, signature }`.
The connected owner wallet signs the server-issued challenge; a challenge is bound to
one proposal, expires after 10 minutes, and cannot be replayed. V5 also accepts the
**agent's own signature** (Mode B) — the agent signs the challenge with its
agent-wallet key and the backend verifies it on-chain.

### Owner Inbox Aggregator

```
GET  /api/v1/owner/inbox?user_wallet=...      Per-wallet snapshot: pending proposals,
                                               low-gas agents (incl. agent_native_symbol),
                                               paused scouts, recent mints, recent scout runs,
                                               per-agent comprehension progress
```

Used by the NotificationBell sheet (top-level + per-section lists) and the
`useScoutLogListener` hook that fires a toast when a new `MINTED` entry appears
since the last poll.

### Public (no auth)

```
GET  /api/v1/public/featured-wisdom     Top wisdom summaries for public dashboard
GET  /api/v1/public/metrics             Platform-wide stats (total agents, NFTs, events)
```

### Scheduler (OIDC-protected — Cloud Scheduler only)

```
POST /api/v1/scheduler/run-all-scouts   Run Auto Scout for all enabled agents
```

---

## Transaction Signing Architecture

### Mode B — Agent Self-Signs (True Autonomy, V5 primary)

Default for all V5 spawned agents. The agent's own wallet signs and pays for minting.

```
Agent Wallet (e.g. 0x9AE...818C)
  ├── provisioned with 50% of spawn fee from spawnAgent() call
  ├── isAgentSpawned = true on V5 contract
  ├── agentOwner[agentWallet] = user_wallet   // V5 ownership registry
  ├── private key stored encrypted in Firestore (KMS)
  └── backend decrypts key → agent self-signs mintAttendanceNFT()
      → gas paid by agent's own wallet
```

**Required:** Agent must be registered via `spawnAgent(agentWallet)` on V5 (costs user the full spawn fee via MetaMask). Sets `isAgentSpawned[agentWallet] = true` + `agentOwner[agentWallet] = user_wallet` on-chain. V5 also lets the **owner** co-sign on behalf of the agent via `recordExecutedProposal`'s auth check.

### Mode A — Minter Service Signs (V5 fallback)

```
Minter Service Wallet (0xCBA7951...)
  ├── holds MINTER_ROLE on V5 contract
  ├── used for: explicit Mode A opt-in, emergency recovery, owner approval
  └── NOT the primary gas payer for regular minting
```

Mode B automatically falls back to Mode A if the agent wallet lacks funds or `MINTER_ROLE`. Keep the minter wallet topped up with ~2 native units.

### spawnBredAgent — Critical Note (V5 escrow-based)

`spawnBredAgent(offspringWallet, offspringId)` is **non-payable** in V5 — it pulls the spawn fee from the escrow that was prepaid in `breedAgents()`. Requires the exact `bytes32` that the user's frontend passed to `breedAgents()`. This value is extracted from the `AgentsBred` event's `offspringKey` field via `verify_breed_tx()` — **never use a backend-generated string**. The `offspringKey` hex is decoded as raw bytes: `bytes.fromhex(offspring_key_hex)`.

If `spawnBredAgent` fails, the offspring agent stores `breed_tx_hash` in Firestore. Use `POST /{id}/retry-spawn` to recover without the user re-paying.

### Re-spawning legacy (V3/V4) Agents on V5

V5 supports agents originally spawned on V4 directly — the `agentOwner` registry is independent of contract version. V3-era agents (`0x460b...` on Mantle mainnet) are not registered on V4/V5. To enable Mode B:
1. Go to V5 contract on MantleScan → Write Contract → `spawnAgent(agentWallet)` + 1 MNT
2. Sets `isAgentSpawned[agentWallet] = true` AND `agentOwner[agentWallet] = msg.sender` → Mode B works

---

## Agent Private Key Storage

| Key | Stored In | Used For |
|-----|-----------|----------|
| `MINTER_SERVICE_PRIVATE_KEY` | GCP Secret Manager | Admin ops: `recordExecutedProposal()`, `spawnBredAgent()`, Mode A |
| Per-agent `private_key_enc` | Firestore (per-agent doc) | Mode B self-signing — decrypted at runtime via KMS |

KMS key: `projects/agentic-event-factory/locations/asia-southeast1/keyRings/maef-keyring/cryptoKeys/agent-key` (keyring name retained from MAEF era for continuity)

---

## Firestore Collections

| Collection | Documents | Purpose |
|------------|-----------|---------|
| `agents` | One per agent | Agent state, config, private key, breed metadata |
| `agent_events` | One per event attended | Wisdom summaries, NFT data, inherited events |
| `scout_logs` | One per scout run | Decision log, scoring, outcome |
| `proposals` | One per HITL proposal | Proposal text, hash, status, execution TX |

---

## Deploying to Cloud Run

```bash
gcloud run deploy mantle-agentic-event \
  --source ./backend \
  --region=asia-southeast1 \
  --project=agentic-event-factory \
  --allow-unauthenticated
```

Update a single environment variable:

```bash
gcloud run services update mantle-agentic-event \
  --region=asia-southeast1 \
  --project=agentic-event-factory \
  --update-env-vars KEY=VALUE
```

Cloud Run service URL: `https://mantle-agentic-event-21898396920.asia-southeast1.run.app`  
Cloud Run SA: `21898396920-compute@developer.gserviceaccount.com`
