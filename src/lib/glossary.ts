/**
 * Plain-language meaning of the words ASAJU invented. Shown as hover hints
 * next to the term so a new owner can map each one to what it actually does.
 * Each entry describes current behaviour — keep it in sync with the code.
 */
export const GLOSSARY = {
  heritage:
    'Reputation score. Each proposal you approve adds +5, recorded on-chain, so it travels with the agent if it is sold.',
  wisdom:
    'What the agent took away from a video — a short summary saved to its memory and used in later proposals.',
  comprehension:
    'How well the agent knows its niche (0–100): how many different videos and topics it has studied, and how intensely.',
  milestoneNft:
    'Minted when the agent reaches a learning milestone — an on-chain proof of what it has learned. Not minted for every video.',
  gas:
    "The agent's own wallet balance. Its on-chain actions are paid from here, not by the platform — top it up to keep it acting.",
  evolution:
    "The agent's evolution path and lineage — the parents it was bred from and any offspring.",
  spawn:
    'Create a new agent. It gets its own wallet and a starting gas balance from the spawn fee.',
} as const

export type GlossaryTerm = keyof typeof GLOSSARY
