import { describe, expect, it } from 'vitest'
import { fighterLook, fmtCountdown, fmtMove, hpBefore, resultLine, strikeSteps, type ArenaDuel, type ArenaRound } from './arena'

const round = (over: Partial<ArenaRound>): ArenaRound => ({
  round: 1, asset: 'bitcoin', symbol: 'BTC', open_price: 100, opened_at: 0, resolve_at: 900, status: 'resolved', ...over,
})

describe('arena helpers', () => {
  it('replays a settled round as blows in pick order', () => {
    const r = round({
      picks: [
        { agent_id: 'a', direction: 'up', confidence: 3, reasoning: '', cited: [], fallback: false, commit: 'x', result: 'hit', hit: 40, recoil: 0 },
        { agent_id: 'b', direction: 'down', confidence: 2, reasoning: '', cited: [], fallback: false, commit: 'y', result: 'miss', hit: 0, recoil: 6 },
      ],
    })
    expect(strikeSteps(r)).toEqual([
      { actor: 0, target: 1, kind: 'hit', amount: 40 },
      { actor: 1, target: 1, kind: 'recoil', amount: 6 },
    ])
    expect(strikeSteps(round({ status: 'sealed', picks: [{ agent_id: 'a', commit: 'x', sealed: true }, { agent_id: 'b', commit: 'y', sealed: true }] }))).toEqual([])
  })

  it('knows the HP going into each round', () => {
    const duel = { rounds: [round({ hp_after: [100, 54] }), round({ round: 2, hp_after: [70, 54] }), round({ round: 3, status: 'sealed' })] }
    expect(hpBefore(duel, 0)).toEqual([100, 100])
    expect(hpBefore(duel, 1)).toEqual([100, 54])
    expect(hpBefore(duel, 2)).toEqual([70, 54])
  })

  it('formats countdowns and moves', () => {
    expect(fmtCountdown(754)).toBe('12:34')
    expect(fmtCountdown(-3)).toBe('0:00')
    expect(fmtCountdown(3723)).toBe('1:02:03')
    expect(fmtMove(0.0123)).toBe('+1.23%')
    expect(fmtMove(-0.0004)).toBe('-0.040%')
  })

  it('names the result', () => {
    const base = { fighters: [{ agent_id: 'a', name: 'Atlas' }, { agent_id: 'b', name: 'Brisa' }] } as unknown as ArenaDuel
    expect(resultLine({ ...base, status: 'finished', result: 'ko', winner: 'a' })).toBe('Atlas wins by K.O.')
    expect(resultLine({ ...base, status: 'finished', result: 'draw', winner: null })).toBe('Draw')
    expect(resultLine({ ...base, status: 'live', result: null, winner: null })).toBe('Live')
  })

  it('gives a fighter the same look as its avatar, every time', () => {
    const a = fighterLook('agent-1', 'Trading/Investment', 3)
    expect(fighterLook('agent-1', 'Trading/Investment', 3)).toEqual(a)
    expect(a.accent).not.toBe(a.accent2)
    expect(fighterLook('agent-2', 'Security').palette).toBe('security')
  })
})
