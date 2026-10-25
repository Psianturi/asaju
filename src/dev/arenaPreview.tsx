/**
 * Dev-only preview of the Arena stage with scripted duels, so the fight
 * choreography and the fighter art can be checked without a wallet, a
 * backend or a live wait. Served by `vite` at /dev-arena.html; not part of
 * the production build.
 *
 *   ?state=instant  finished instant duel, replayed from the bell (default)
 *   ?state=live     live duel with a sealed round and a countdown
 *   ?state=poses    every fighter pose side by side
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/main.css'
import '@/styles/theme.css'
import '@/index.css'
import { DuelStage } from '@/components/arena/DuelStage'
import { Fighter, type FighterPose } from '@/components/arena/Fighter'
import type { ArenaDuel, ArenaRound, FightMove, RevealedPick } from '@/lib/arena'

const state = new URLSearchParams(window.location.search).get('state') || 'instant'
const now = Date.now() / 1000

type Blow = { dir: 'up' | 'down'; conf: 1 | 2 | 3; result: 'hit' | 'miss' | 'flat'; hit?: number; recoil?: number; move: FightMove; crit?: boolean; why: string }

const pick = (agent: string, b: Blow): RevealedPick => ({
  agent_id: agent, direction: b.dir, confidence: b.conf, reasoning: b.why, cited: ['Funding rates & squeezes'],
  fallback: false, commit: 'c'.repeat(64), result: b.result, hit: b.hit ?? 0, recoil: b.recoil ?? 0, move: b.move, crit: b.crit ?? false,
})

const round = (n: number, symbol: string, move: number, hpAfter: [number, number], a: Blow, b: Blow): ArenaRound => ({
  round: n, asset: symbol.toLowerCase(), symbol, open_price: 100, close_price: 100 * (1 + move), move,
  opened_at: now - 3600 * (6 - n), resolve_at: now - 3600 * (6 - n) + 1800, resolved_at: now, status: 'resolved',
  hp_after: hpAfter, picks: [pick('naruto', a), pick('coco', b)],
})

const fighters: ArenaDuel['fighters'] = [
  { agent_id: 'naruto', name: 'Naruto', niche: 'Trading/Investment', personality: 'Aggressive', style: 'striker', level: 13, lessons: 24, chain_id: 5003, avatar_seed: 0, owner: '0xfb6e', hp: 100, rating: 1000,
    stats: { power: 36, guard: 32, focus: 16 }, strategy: 'Press the squeeze early, fade any euphoric spike.' },
  { agent_id: 'coco', name: 'Coco', niche: 'Trading/Investment', personality: 'Analytical', style: 'tactician', level: 12, lessons: 23, chain_id: 5003, avatar_seed: 4, owner: '0xfb6e', hp: 100, rating: 1000,
    stats: { power: 34, guard: 31, focus: 30 }, strategy: 'Follow stablecoin flows; only commit when the tape agrees.' },
]

const instant: ArenaDuel = {
  duel_id: 'preview-instant', status: 'finished', mode: 'instant', ai_calls: 2, owner: '0xfb6e', rounds_total: 5, horizon: '30m', horizon_seconds: 1800,
  fighters: [{ ...fighters[0], hp: 62, rating_after: 1008 }, { ...fighters[1], hp: 0, rating_after: 992 }],
  rounds: [
    round(1, 'BTC', 0.0062, [100, 64], { dir: 'up', conf: 3, result: 'hit', hit: 36, move: 'kick', why: 'Funding flipped negative while spot bid held — shorts are crowded.' },
      { dir: 'down', conf: 1, result: 'miss', recoil: 0, move: 'whiff', why: 'Inflows slowing on the day.' }),
    round(2, 'ETH', -0.0041, [74, 64], { dir: 'up', conf: 2, result: 'miss', recoil: 5, move: 'stumble', why: 'Lagging BTC, expect catch-up.' },
      { dir: 'down', conf: 2, result: 'hit', hit: 21, move: 'blast', why: 'Exchange inflows rising into resistance.' }),
    round(3, 'SOL', 0.0091, [74, 18], { dir: 'up', conf: 3, result: 'hit', hit: 46, move: 'combo', crit: true, why: 'Momentum names lead when funding resets.' },
      { dir: 'up', conf: 1, result: 'flat', move: 'clash', why: 'No edge.' }),
    round(4, 'BNB', 0.0035, [62, 0], { dir: 'up', conf: 2, result: 'hit', hit: 24, move: 'slash', why: 'Risk-on day, majors follow.' },
      { dir: 'down', conf: 3, result: 'miss', recoil: 11, move: 'stumble', why: 'Fading the rally.' }),
  ],
  winner: 'naruto', result: 'ko', created_at: now - 60, updated_at: now, finished_at: now,
}

const live: ArenaDuel = {
  duel_id: 'preview-live', status: 'live', mode: 'live', ai_calls: 2, owner: '0xfb6e', rounds_total: 5, horizon: '15m', horizon_seconds: 900,
  fighters: [{ ...fighters[0], hp: 100 }, { ...fighters[1], hp: 64 }],
  rounds: [
    instant.rounds[0],
    { round: 2, asset: 'ethereum', symbol: 'ETH', open_price: 2487.12, opened_at: now - 120, resolve_at: now + 754, status: 'sealed',
      picks: [{ agent_id: 'naruto', commit: 'a'.repeat(64), sealed: true }, { agent_id: 'coco', commit: 'b'.repeat(64), sealed: true }] },
  ],
  winner: null, result: null, created_at: now - 1000, updated_at: now,
}

function Poses() {
  const poses: FighterPose[] = ['idle', 'guard', 'slash', 'kick', 'combo', 'blast', 'hit', 'stumble', 'win', 'ko']
  return (
    <div className="grid grid-cols-5 gap-6 p-6" style={{ background: '#070A1C' }}>
      {poses.map((p, i) => (
        <div key={p} className="text-center text-white/70 text-xs">
          <div className="h-56 flex items-end justify-center">
            <Fighter agentId={i % 2 ? 'coco' : 'naruto'} name={p} niche="Trading/Investment" seed={i % 2 ? 4 : 0} side="left" pose={p} className="w-36" />
          </div>
          {p}
        </div>
      ))}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="dark min-h-screen p-6" style={{ background: 'oklch(0.12 0.03 250)' }}>
      {state === 'poses' ? <Poses /> : <div className="max-w-5xl mx-auto"><DuelStage duel={state === 'live' ? live : instant} /></div>}
    </div>
  </StrictMode>,
)
