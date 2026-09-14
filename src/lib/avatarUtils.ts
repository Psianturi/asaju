/**
 * Deterministic agent avatar utilities.
 *
 * Generates a consistent color + initials avatar from an agent's ID.
 * No external files, no random — same agent ID always produces the same look.
 * Used by AgentCard and MarketplaceAgentCard.
 *
 * Per-niche avatars (Trading/Investment, Blockchain/DeFi, Technology) live in
 * /public/avatars/{niche}/ and are selected deterministically by hashing the
 * agent id. When the static files are missing we fall back to a niche-themed
 * inline SVG icon so the UI is never blank.
 */

const NICHE_PATHS: Record<string, string> = {
  'Trading/Investment': '/avatars/trading',
  'Blockchain/DeFi': '/avatars/defi',
  Technology: '/avatars/tech',
}

/** Number of generated variants per niche. Keep in sync with files on disk. */
const NICHE_VARIANT_COUNT: Record<string, number> = {
  'Trading/Investment': 3,
  'Blockchain/DeFi': 3,
  Technology: 3,
}

export type Niche = keyof typeof NICHE_PATHS

/** Hash a string to a 32-bit unsigned integer (djb2). */
function hashString(s: string): number {
  let h = 5381
  for (let i = 0; s && i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i)
  }
  return h >>> 0
}

/** Normalize a niche string to one of the keys we render avatars for. */
export function normalizeNiche(niche: string): Niche | null {
  if (!niche) return null
  if (niche in NICHE_PATHS) return niche as Niche
  const lower = niche.toLowerCase()
  if (lower.includes('trading') || lower.includes('invest')) return 'Trading/Investment'
  if (lower.includes('defi') || lower.includes('blockchain')) return 'Blockchain/DeFi'
  if (lower.includes('tech')) return 'Technology'
  return null
}

/**
 * Deterministic per-niche avatar selection. Returns the public URL for the
 * matching variant (e.g. `/avatars/trading/trader-2.png`), or null when the
 * niche has no avatar set so callers can fall back to the SVG placeholder.
 */
export function getNicheAvatarUrl(agentId: string, niche: string): string | null {
  const normalized = normalizeNiche(niche)
  if (!normalized) return null
  const base = NICHE_PATHS[normalized]
  const count = NICHE_VARIANT_COUNT[normalized] ?? 0
  if (count === 0) return null
  const idx = (hashString(agentId) % count) + 1
  const variant = normalized === 'Trading/Investment'
    ? `trader-${idx}.png`
    : normalized === 'Blockchain/DeFi'
      ? `defi-${idx}.png`
      : `tech-${idx}.png`
  return `${base}/${variant}`
}

/**
 * Self-contained niche icon returned as an inline SVG data URI. Used as a
 * no-flicker fallback when the static PNG is not yet generated. Encoded as
 * URI so it works in <img src="..."> and as background-image equally.
 */
export function getNicheFallbackIcon(niche: string): string {
  const normalized = normalizeNiche(niche)
  const palette: Record<Niche, { bg: string; accent: string; label: string }> = {
    'Trading/Investment': { bg: '#0f1d2e', accent: '#22d3ee', label: 'TR' },
    'Blockchain/DeFi':    { bg: '#1b1033', accent: '#a78bfa', label: 'D'  },
    Technology:           { bg: '#2a1238', accent: '#f472b6', label: 'T'  },
  }
  const theme = normalized ? palette[normalized] : { bg: '#0b1020', accent: '#94a3b8', label: 'AI' }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${theme.bg}"/><text x="32" y="42" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="28" font-weight="700" fill="${theme.accent}">${theme.label}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/**
 * Pick the best avatar source for an agent: niche avatar if it exists, else
 * the niche SVG fallback. Components use this so they don't have to handle
 * "image not generated yet" — they always render something.
 */
export function getAgentNicheAvatar(agentId: string, niche: string): {
  src: string
  isPlaceholder: boolean
} {
  const nicheUrl = getNicheAvatarUrl(agentId, niche)
  if (nicheUrl) return { src: nicheUrl, isPlaceholder: false }
  return { src: getNicheFallbackIcon(niche), isPlaceholder: true }
}

/**
 * Get a deterministic avatar for an agent.
 * Returns Tailwind-compatible inline style colors (bg + text) and initials.
 */
export function getAgentAvatar(agentId: string, name: string): {
  initials: string
  bgColor: string
  textColor: string
  ringColor: string
} {
  const colors: { bg: string; text: string; ring: string }[] = [
    { bg: 'bg-cyan-500/20',    text: 'text-cyan-400',    ring: 'ring-cyan-500/30' },
    { bg: 'bg-violet-500/20',  text: 'text-violet-400',  ring: 'ring-violet-500/30' },
    { bg: 'bg-amber-500/20',   text: 'text-amber-400',   ring: 'ring-amber-500/30' },
    { bg: 'bg-emerald-500/20', text: 'text-emerald-400', ring: 'ring-emerald-500/30' },
    { bg: 'bg-sky-500/20',     text: 'text-sky-400',     ring: 'ring-sky-500/30' },
    { bg: 'bg-rose-500/20',    text: 'text-rose-400',    ring: 'ring-rose-500/30' },
    { bg: 'bg-indigo-500/20',  text: 'text-indigo-400',  ring: 'ring-indigo-500/30' },
    { bg: 'bg-teal-500/20',    text: 'text-teal-400',    ring: 'ring-teal-500/30' },
  ]

  const idx = hashString(agentId) % colors.length
  const color = colors[idx]

  // Initials: first letter of each word, max 2, uppercase
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase()

  return { initials, bgColor: color.bg, textColor: color.text, ringColor: color.ring }
}