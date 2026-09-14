import { describe, expect, it } from 'vitest'
import {
  getAgentAvatar,
  getAgentNicheAvatar,
  getNicheAvatarUrl,
  getNicheFallbackIcon,
  normalizeNiche,
} from './avatarUtils'

describe('normalizeNiche', () => {
  it('returns the exact niche when known', () => {
    expect(normalizeNiche('Trading/Investment')).toBe('Trading/Investment')
    expect(normalizeNiche('Blockchain/DeFi')).toBe('Blockchain/DeFi')
    expect(normalizeNiche('Technology')).toBe('Technology')
  })

  it('normalizes common variants', () => {
    expect(normalizeNiche('trading')).toBe('Trading/Investment')
    expect(normalizeNiche('investing')).toBe('Trading/Investment')
    expect(normalizeNiche('DeFi')).toBe('Blockchain/DeFi')
    expect(normalizeNiche('blockchain')).toBe('Blockchain/DeFi')
    expect(normalizeNiche('Tech')).toBe('Technology')
  })

  it('returns null for empty or unknown', () => {
    expect(normalizeNiche('')).toBeNull()
    expect(normalizeNiche('Health/Wellness')).toBeNull()
    expect(normalizeNiche('Other')).toBeNull()
  })
})

describe('getNicheAvatarUrl', () => {
  it('returns a deterministic URL for known niches', () => {
    const url1 = getNicheAvatarUrl('agent-a', 'Trading/Investment')
    const url2 = getNicheAvatarUrl('agent-a', 'Trading/Investment')
    expect(url1).toBe(url2)
    expect(url1).toMatch(/^\/avatars\/trading\/trader-\d+\.png$/)
  })

  it('selects variants based on hash — different ids yield different indices', () => {
    const urls = new Set(
      Array.from({ length: 20 }, (_, i) =>
        getNicheAvatarUrl(`agent-${i}`, 'Trading/Investment'),
      ),
    )
    // We expect at least 2 distinct URLs (3 variants × 20 inputs spreads broadly).
    expect(urls.size).toBeGreaterThanOrEqual(2)
  })

  it('returns the correct path per niche', () => {
    expect(getNicheAvatarUrl('agent-x', 'Trading/Investment')).toMatch(/^\/avatars\/trading\//)
    expect(getNicheAvatarUrl('agent-x', 'Blockchain/DeFi')).toMatch(/^\/avatars\/defi\//)
    expect(getNicheAvatarUrl('agent-x', 'Technology')).toMatch(/^\/avatars\/tech\//)
  })

  it('returns null for unknown niche', () => {
    expect(getNicheAvatarUrl('agent-x', 'Health/Wellness')).toBeNull()
    expect(getNicheAvatarUrl('agent-x', '')).toBeNull()
  })

  it('variant index is in range [1, NICHE_VARIANT_COUNT]', () => {
    for (const niche of ['Trading/Investment', 'Blockchain/DeFi', 'Technology'] as const) {
      for (let i = 0; i < 50; i++) {
        const url = getNicheAvatarUrl(`agent-${i}`, niche)
        expect(url).not.toBeNull()
        const match = url!.match(/-(\d+)\.png$/)
        expect(match).not.toBeNull()
        const variant = Number(match![1])
        expect(variant).toBeGreaterThanOrEqual(1)
        expect(variant).toBeLessThanOrEqual(3)
      }
    }
  })
})

describe('getNicheFallbackIcon', () => {
  it('returns a data URI for known niches', () => {
    const trading = getNicheFallbackIcon('Trading/Investment')
    expect(trading).toMatch(/^data:image\/svg\+xml;utf8,/)
    expect(decodeURIComponent(trading)).toContain('TR')
  })

  it('returns a different icon per niche', () => {
    const trading = decodeURIComponent(getNicheFallbackIcon('Trading/Investment'))
    const defi = decodeURIComponent(getNicheFallbackIcon('Blockchain/DeFi'))
    const tech = decodeURIComponent(getNicheFallbackIcon('Technology'))
    expect(trading).not.toBe(defi)
    expect(defi).not.toBe(tech)
  })

  it('falls back to a generic icon for unknown niches', () => {
    const fallback = getNicheFallbackIcon('Health/Wellness')
    expect(fallback).toMatch(/^data:image\/svg\+xml;utf8,/)
    expect(decodeURIComponent(fallback)).toContain('AI')
  })
})

describe('getAgentNicheAvatar', () => {
  it('returns niche URL with isPlaceholder=false when PNG exists', () => {
    const result = getAgentNicheAvatar('agent-1', 'Trading/Investment')
    expect(result.isPlaceholder).toBe(false)
    expect(result.src).toMatch(/^\/avatars\/trading\/trader-\d+\.png$/)
  })

  it('returns SVG data URI with isPlaceholder=true for unknown niche', () => {
    const result = getAgentNicheAvatar('agent-1', 'Health/Wellness')
    expect(result.isPlaceholder).toBe(true)
    expect(result.src).toMatch(/^data:image\/svg\+xml/)
  })

  it('is deterministic — same agent id always returns the same avatar', () => {
    const a = getAgentNicheAvatar('agent-stable', 'Blockchain/DeFi')
    const b = getAgentNicheAvatar('agent-stable', 'Blockchain/DeFi')
    expect(a.src).toBe(b.src)
    expect(a.isPlaceholder).toBe(b.isPlaceholder)
  })
})

describe('getAgentAvatar (existing initials helper, untouched)', () => {
  it('returns initials from a multi-word name', () => {
    const result = getAgentAvatar('any-id', 'Coco the Strategist')
    expect(result.initials).toBe('CT')
  })

  it('caps at two letters', () => {
    const result = getAgentAvatar('any-id', 'One Two Three Four')
    expect(result.initials).toBe('OT')
  })

  it('handles single-word name', () => {
    const result = getAgentAvatar('any-id', 'Naruto')
    expect(result.initials).toBe('N')
  })

  it('is deterministic by agent id for color selection', () => {
    const a = getAgentAvatar('same-id', 'A')
    const b = getAgentAvatar('same-id', 'B')
    expect(a.bgColor).toBe(b.bgColor)
    expect(a.textColor).toBe(b.textColor)
    expect(a.ringColor).toBe(b.ringColor)
  })
})
