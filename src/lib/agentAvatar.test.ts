import { describe, expect, it } from 'vitest'
import { avatarDataUri, avatarParts, avatarSvg, AVATAR_VARIETY, paletteKey } from './agentAvatar'

describe('agentAvatar', () => {
  it('draws the same avatar for the same agent and seed', () => {
    expect(avatarSvg('agent-1', 'Technology', 7)).toBe(avatarSvg('agent-1', 'Technology', 7))
    expect(avatarDataUri('agent-1', 'Technology')).toBe(avatarDataUri('agent-1', 'Technology', 0))
  })

  it('gives different agents and seeds different avatars', () => {
    const svgs = new Set(Array.from({ length: 40 }, (_, i) => avatarSvg(`agent-${i}`, 'Blockchain/DeFi')))
    expect(svgs.size).toBe(40)
    expect(avatarSvg('agent-1', 'Technology', 1)).not.toBe(avatarSvg('agent-1', 'Technology', 2))
  })

  it('uses every part across many agents', () => {
    const gears = new Set<number>()
    const implants = new Set<number>()
    const skins = new Set<number>()
    for (let i = 0; i < 400; i++) {
      const p = avatarParts(`a${i}`, 'Trading/Investment')
      gears.add(p.gear)
      implants.add(p.implant)
      skins.add(p.skin)
      expect(p.accent).not.toBe(p.accent2)
    }
    expect(gears.size).toBe(6)
    expect(implants.size).toBe(6)
    expect(skins.size).toBe(6)
    expect(AVATAR_VARIETY).toBeGreaterThan(1_000_000)
  })

  it('follows the niche palette, with a general fallback', () => {
    expect(paletteKey('Trading/Investment')).toBe('trading')
    expect(paletteKey('Blockchain/DeFi')).toBe('defi')
    expect(paletteKey('Health/Wellness')).toBe('health')
    expect(paletteKey(undefined)).toBe('general')
  })

  it('produces a well-formed SVG data URI', () => {
    const svg = avatarSvg('x', 'Technology', 3)
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(svg).not.toMatch(/undefined|NaN/)
    // Every opened tag is closed, in order.
    const stack: string[] = []
    for (const [, close, name, selfClose] of svg.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
      if (close) expect(stack.pop()).toBe(name)
      else if (!selfClose) stack.push(name)
    }
    expect(stack).toEqual([])
    expect(avatarDataUri('x', 'Technology', 3)).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
  })
})
