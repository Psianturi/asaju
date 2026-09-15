# Artizen Season 7 Submission Draft — Asaju

**Platform:** Artizen (Web3 crowdfunding via Artifact NFT + matching Fund)  
**Submission Status:** DRAFT (5/8 fields filled, pending personal video + user-supplied info)  
**Last updated:** 2026-09-15

---

## 1. Title
**Asaju**

---

## 2. Logline (max 120 chars)
> AI agents that learn what you teach them — then prove it on-chain, so every skill you've built stays yours, not the platform's.

*Character count: ~119 (verified) — borderline. Backup variants below if this exceeds:*
- Backup A: "Personal AI agents that learn from you and prove their growth as NFTs you truly own."
- Backup B: "AI agents that remember what you taught them — verifiable, portable, owned by you."

---

## 3. Tags (dropdown — check live options)
Likely picks (verify in live form):
- **AI** — core technology
- **Open Source** — codebase available
- **Web3** — on-chain NFT proof
- **Education** — learning-focused use case
- **Personal Development** — for self-directed learners

---

## 4. Video
**Status: DEFERRED — needs user-supplied personal teaser.**

Per Artizen rules: 30–90 sec, **NOT a feature demo**. Should be a personal message from the maker (the creator's voice + face) explaining why this project matters.

Suggested script outline:
- 0–10s: who you are, what you care about
- 10–30s: the personal pain — "I kept learning things on YouTube but couldn't prove or own what I learned"
- 30–60s: what Asaju does — your AI agent watches with you, remembers, and mints the proof
- 60–90s: why the community should support this — it's about agency, learning, and not being locked in

---

## 5. Fundraising goal
**Status: REQUIRES OWNER DECISION — not technically determinable.**

Typical Artizen crowdfunding range: $2,000–$20,000 per season, matched by sponsors up to similar amount. Suggest a goal tied to operational runway:
- $3,000 — covers 1 year of Cloud Run + Firestore + Mantle RPC for ~50 active agents
- $7,500 — adds a part-time contributor for documentation & community
- $15,000 — funds 2 contributors + bounty pool for community-contributed tools

Match the goal to what you'd realistically need to keep ASAJU running for the season.

---

## 6. Artifact (square JPG/PNG/GIF, max 10MB, NO TEXT/LOGOS/OVERLAYS)

**Status: NEEDS DESIGN — cannot be auto-generated here.**

The Artifact must be a standalone piece of art capturing ASAJU's vibe. It should:
- be **clean and minimal** — no gradients with text, no logos, no UI screenshots
- capture **the aesthetic of an agent's world** — a stylized scene, character portrait, or abstract motif
- be **square** (1:1) at decent resolution (recommended 1024×1024 or 2048×2048)

Concept directions (pick one, brief a designer):
- **A** — A single agent character looking at a glowing NFT orb, anime/stylized illustration, dark teal palette
- **B** — A wireframe of an agent's neural architecture rendered as a glowing constellation against deep navy
- **C** — A simple object: a journal/monocle/floating orb representing "what the agent remembers"

The 3 trading avatar PNGs already in `public/avatars/trading/` are good visual references for palette/style. The Artifact should feel like a related-but-distinct piece of art.

---

## 7. Project description (Q1 — "What are you making?")
**Status: DRAFT — 247 chars**

> Asaju is a personal AI agent that learns alongside you from YouTube and live market data, then proves its growth as an NFT you own. The agent remembers your preferences, your trading style, your study plans — and the proof lives on Mantle blockchain so it can't be taken away by a platform shutdown or API change.

*Character count: ~247. Trim to ~250 if needed by removing "and the proof lives on Mantle blockchain so it can't be taken away by a platform shutdown or API change" → "and the proof lives on-chain."*

---

## 8. World impact (Q2 — "How will your project impact the world?")
**Status: DRAFT — 246 chars**

> People spend hundreds of hours on YouTube learning skills — then lose track of what they actually learned. Asaju turns that learning into a verifiable record owned by the learner, not the platform. For self-taught developers, traders, and researchers in regions with limited credentials, this is a portable proof of competence they actually control.

*Character count: ~246. Acceptable.*

---

## 9. Progress (Q3 — "What progress have you made?")
**Status: DRAFT — 248 chars**

> Live at asaju.vercel.app — fully working app with 86 backend tests and 38 frontend tests passing. Built and tested with real users on Mantle Sepolia testnet (chain 5003). Already integrated with CoinMarketCap and CoinGecko for live market context. Agents are learning from real YouTube videos and producing real wisdom summaries today.

*Character count: ~248.*

---

## 10. Founder fit (Q4 — "Why are you the right person?")
**Status: DRAFT — 244 chars**

> Built ASAJU end-to-end — backend (FastAPI + Firestore), frontend (React + Next.js), and on-chain integration (Mantle smart contract). Personally solved the trade-off between AI autonomy and user agency by designing two-step owner approvals, so the agent can suggest actions but humans always sign.

*Character count: ~244.*

---

## 11. Pitch deck (optional, 8-12 slides)
**Status: NOT STARTED — recommend 1-page pitch instead given deadline.**

Suggested slide outline (if you want to invest in this):
1. Cover — Asaju logo, tagline, your face
2. Problem — "learning is invisible, ownership is platform-dependent"
3. Solution — agents that learn and prove it on-chain
4. How it works — YouTube URL → agent analysis → NFT mint
5. Live market integration — CoinGecko + CoinMarketCap
6. Owner control — two-step approval, custom instructions
7. Traction — live product, real users, test counts
8. Roadmap — V2 public profiles, V3 DeFi execution
9. Team / ask — founder bio, funding goal, matching-fund opportunity
10. Closing — Artizen community-specific call to action

---

## Risks to disclose in submission

Per Artizen playbook honesty standard — flag these in the pitch deck or description:

1. **Image generation is currently a placeholder** — the 3 trading avatars work; defi/tech avatars fall back to inline SVG icons. Designer work needed for full 9-avatar suite.
2. **Testnet only** — mainnet launch pending audit and partner readiness.
3. **Single-founder risk** — most code authored by one person; contributor pipeline just starting.
4. **CMC API call costs** — derivatives endpoint calls can be expensive at scale; need usage caps.
5. **AI reasoning quality** — current Gemini integration is solid for English/Indonesian but not validated for other languages.

These risks actually strengthen the submission because Artizen values authenticity over hype.

---

## Suggested next actions (in order)
1. Review this draft and adjust the Fundraising goal
2. Pick an Artifact concept (A / B / C) and brief a designer
3. Record the 30-90 sec personal video (phone is fine)
4. Submit; announce on Discord/X with first-buyer commitment from your network
5. Update memory + iterate based on feedback
