import { describe, expect, it } from 'vitest'
import { fmtWindowSpan, formLine, isRevealed, pointsFor, seasonLabel, windowPhase } from './league'

describe('league helpers', () => {
  it('follows a window through its phases', () => {
    const w = { status: 'upcoming' as const, open_ts: 1000, resolve_ts: 2800 }
    expect(windowPhase(w, 900)).toBe('open')
    expect(windowPhase(w, 1000)).toBe('locked')
    expect(windowPhase({ ...w, status: 'sealed' }, 2799)).toBe('locked')
    expect(windowPhase({ ...w, status: 'sealed' }, 2800)).toBe('settling')
    expect(windowPhase({ ...w, status: 'resolved' }, 0)).toBe('resolved')
    expect(windowPhase({ ...w, status: 'void' }, 0)).toBe('void')
  })

  it('scores like the server', () => {
    expect(pointsFor('up', 3, 0.01)).toBe(40)   // 30 + capped bonus
    expect(pointsFor('up', 2, 0.001)).toBe(22)  // 20 + 2
    expect(pointsFor('down', 1, 0.004)).toBe(0) // wrong at c1 is free
    expect(pointsFor('down', 3, 0.004)).toBe(-4)
    expect(pointsFor('down', 2, -0.002)).toBe(24)
  })

  it('formats spans, seasons and form', () => {
    expect(fmtWindowSpan(1_800_000_000, 1_800_001_800)).toBe('08:00–08:30 UTC')
    expect(seasonLabel('2026-W43')).toBe('Week 43 · 2026')
    expect(seasonLabel('')).toBe('Season')
    expect(formLine([1, 1, 0, 1])).toBe('W W L W')
    expect(formLine(undefined)).toBe('')
  })

  it('tells sealed from revealed picks', () => {
    expect(isRevealed({ agent_id: 'a', commit: 'x', sealed: true })).toBe(false)
    expect(isRevealed({ agent_id: 'a', commit: 'x', salt: 's', direction: 'up', confidence: 2, reasoning: '', cited: [], fallback: false })).toBe(true)
  })
})
