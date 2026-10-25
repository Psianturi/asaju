/**
 * A scripted duel for first-time visitors and the dev preview: shows the whole
 * flow (plans → rounds → K.O.) without a wallet, a backend or an AI call.
 * Demo ids start with "demo-" so the UI never polls or settles them.
 */
import type { ArenaDuel, ArenaRound, FightMove, RevealedPick } from '@/lib/arena'

export const isDemoDuel = (d: Pick<ArenaDuel, 'duel_id'> | null | undefined) => !!d && d.duel_id.startsWith('demo-')

type Blow = { dir: 'up' | 'down'; conf: 1 | 2 | 3; result: 'hit' | 'miss' | 'flat'; hit?: number; recoil?: number; move: FightMove; crit?: boolean; why: string; from?: string }

const pick = (agent: string, b: Blow): RevealedPick => ({
  agent_id: agent, direction: b.dir, confidence: b.conf, reasoning: b.why, cited: [b.from ?? 'Funding rates & squeezes'],
  fallback: false, commit: 'c'.repeat(64), result: b.result, hit: b.hit ?? 0, recoil: b.recoil ?? 0, move: b.move, crit: b.crit ?? false,
})

export function demoDuel(now = Date.now() / 1000): ArenaDuel {
  const round = (n: number, symbol: string, open: number, move: number, hpAfter: [number, number], a: Blow, b: Blow): ArenaRound => ({
    round: n, asset: symbol.toLowerCase(), symbol, open_price: open, close_price: open * (1 + move), move,
    opened_at: now - 1800 * (6 - n), resolve_at: now - 1800 * (5 - n), resolved_at: now - 1800 * (5 - n), status: 'resolved',
    hp_after: hpAfter, picks: [pick('demo-ayla', a), pick('demo-rook', b)],
  })
  return {
    duel_id: 'demo-sample', status: 'finished', mode: 'instant', ai_calls: 2, owner: '0xdemo', rounds_total: 5, horizon: '30m', horizon_seconds: 1800,
    fighters: [
      { agent_id: 'demo-ayla', name: 'Ayla', niche: 'Trading/Investment', personality: 'Aggressive', style: 'striker', level: 9, lessons: 17, chain_id: 5003, avatar_seed: 3, owner: '0xdemo',
        hp: 62, rating: 1000, rating_before: 1000, rating_after: 1008, stats: { power: 28, guard: 25, focus: 18 }, strategy: 'Press the squeeze early, fade any euphoric spike.' },
      { agent_id: 'demo-rook', name: 'Rook', niche: 'Blockchain/DeFi', personality: 'Analytical', style: 'tactician', level: 7, lessons: 12, chain_id: 5003, avatar_seed: 11, owner: '0xdemo',
        hp: 0, rating: 1000, rating_before: 1000, rating_after: 992, stats: { power: 24, guard: 20, focus: 30 }, strategy: 'Follow stablecoin flows; only commit when the tape agrees.' },
    ],
    rounds: [
      round(1, 'BTC', 68123.4, 0.0062, [100, 64],
        { dir: 'up', conf: 3, result: 'hit', hit: 36, move: 'kick', why: 'Funding flipped negative while spot bid held — shorts are crowded.', from: 'Funding rates & squeezes' },
        { dir: 'down', conf: 1, result: 'miss', recoil: 0, move: 'whiff', why: 'Exchange inflows slowing on the day.', from: 'Stablecoin flows' }),
      round(2, 'ETH', 2487.12, -0.0041, [74, 64],
        { dir: 'up', conf: 2, result: 'miss', recoil: 5, move: 'stumble', why: 'Lagging BTC, expecting catch-up.' },
        { dir: 'down', conf: 2, result: 'hit', hit: 21, move: 'blast', why: 'Inflows rising into resistance.', from: 'Stablecoin flows' }),
      round(3, 'SOL', 182.4, 0.0091, [74, 18],
        { dir: 'up', conf: 3, result: 'hit', hit: 46, move: 'combo', crit: true, why: 'Momentum names lead when funding resets.' },
        { dir: 'up', conf: 1, result: 'flat', move: 'clash', why: 'No edge here.' }),
      round(4, 'BNB', 742.3, 0.0035, [62, 0],
        { dir: 'up', conf: 2, result: 'hit', hit: 24, move: 'slash', why: 'Risk-on day, majors follow.' },
        { dir: 'down', conf: 3, result: 'miss', recoil: 11, move: 'stumble', why: 'Fading the rally.' }),
    ],
    winner: 'demo-ayla', result: 'ko', created_at: now - 9000, updated_at: now - 1800, finished_at: now - 1800,
  }
}

/** A live duel mid-way, for the preview. */
export function demoLiveDuel(now = Date.now() / 1000): ArenaDuel {
  const d = demoDuel(now)
  return {
    ...d, duel_id: 'demo-live', status: 'live', mode: 'live', horizon: '15m', horizon_seconds: 900,
    fighters: [{ ...d.fighters[0], hp: 100, rating_after: undefined }, { ...d.fighters[1], hp: 64, rating_after: undefined }],
    rounds: [
      d.rounds[0],
      { round: 2, asset: 'ethereum', symbol: 'ETH', open_price: 2487.12, opened_at: now - 120, resolve_at: now + 754, status: 'sealed',
        picks: [{ agent_id: 'demo-ayla', commit: 'a'.repeat(64), sealed: true }, { agent_id: 'demo-rook', commit: 'b'.repeat(64), sealed: true }] },
    ],
    winner: null, result: null, finished_at: undefined,
  }
}
