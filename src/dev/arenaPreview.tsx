/**
 * Dev-only preview of the Arena stage with a scripted duel, so the fight
 * choreography and the fighter art can be checked without a wallet, a
 * backend or a 15-minute wait. Served by `vite` at /dev-arena.html; it is
 * not part of the production build.
 *
 *   ?state=live   sealed round with a countdown (default)
 *   ?state=ko     finished duel: replays the final round and the K.O.
 *   ?state=poses  every fighter pose side by side
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/main.css'
import '@/styles/theme.css'
import '@/index.css'
import { DuelStage } from '@/components/arena/DuelStage'
import { Fighter, type FighterPose } from '@/components/arena/Fighter'
import type { ArenaDuel, ArenaRound, RevealedPick } from '@/lib/arena'

const state = new URLSearchParams(window.location.search).get('state') || 'live'
const now = Date.now() / 1000

const pick = (agent: string, direction: 'up' | 'down', confidence: 1 | 2 | 3, result: 'hit' | 'miss', hit: number, recoil: number, reasoning: string): RevealedPick => ({
  agent_id: agent, direction, confidence, reasoning, cited: ['Funding rates & squeezes'], fallback: false, commit: 'c'.repeat(64), result, hit, recoil,
})

const resolved = (round: number, hpAfter: [number, number], move: number): ArenaRound => ({
  round, asset: 'bitcoin', symbol: 'BTC', open_price: 68123.4, close_price: 68123.4 * (1 + move), move, opened_at: now - 3000, resolve_at: now - 2100,
  resolved_at: now - 2000, status: 'resolved', hp_after: hpAfter,
  picks: [
    pick('naruto', 'up', 3, move > 0 ? 'hit' : 'miss', move > 0 ? 40 : 0, move > 0 ? 0 : 12, 'Funding flipped negative while spot bid held — shorts are crowded, squeeze risk up.'),
    pick('coco', 'down', 2, move > 0 ? 'miss' : 'hit', move > 0 ? 0 : 28, move > 0 ? 6 : 0, 'Stablecoin inflows slowed on the day; expecting a fade into the close.'),
  ],
})

const base: ArenaDuel = {
  duel_id: 'preview-duel', status: 'live', owner: '0xfb6e', rounds_total: 5, horizon: '15m', horizon_seconds: 900,
  fighters: [
    { agent_id: 'naruto', name: 'Naruto', niche: 'Trading/Investment', personality: 'Aggressive', level: 13, lessons: 24, chain_id: 5003, avatar_seed: 0, owner: '0xfb6e', hp: 100, rating: 1032 },
    { agent_id: 'coco', name: 'Coco', niche: 'Blockchain/DeFi', personality: 'Analytical', level: 12, lessons: 23, chain_id: 5003, avatar_seed: 4, owner: '0xfb6e', hp: 54, rating: 991 },
  ],
  rounds: [], winner: null, result: null, created_at: now - 4000, updated_at: now,
}

const duel: ArenaDuel = state === 'ko'
  ? {
      ...base, status: 'finished', winner: 'naruto', result: 'ko', finished_at: now,
      fighters: [{ ...base.fighters[0], hp: 88, rating_before: 1032, rating_after: 1047 }, { ...base.fighters[1], hp: 0, rating_before: 991, rating_after: 976 }],
      rounds: [resolved(1, [100, 54], 0.0121), resolved(2, [88, 8], -0.004), resolved(3, [88, 0], 0.0088)],
    }
  : {
      ...base,
      rounds: [
        resolved(1, [100, 54], 0.0121),
        { round: 2, asset: 'ethereum', symbol: 'ETH', open_price: 2487.12, opened_at: now - 120, resolve_at: now + 754, status: 'sealed',
          picks: [{ agent_id: 'naruto', commit: 'a'.repeat(64), sealed: true }, { agent_id: 'coco', commit: 'b'.repeat(64), sealed: true }] },
      ],
    }

function Poses() {
  const poses: FighterPose[] = ['idle', 'guard', 'attack', 'hit', 'win', 'ko']
  return (
    <div className="grid grid-cols-3 gap-6 p-6" style={{ background: '#070A1C' }}>
      {poses.map((p, i) => (
        <div key={p} className="text-center text-white/70 text-xs">
          <div className="h-64 flex items-end justify-center">
            <Fighter agentId={i % 2 ? 'coco' : 'naruto'} name={p} niche={i % 2 ? 'Blockchain/DeFi' : 'Trading/Investment'} seed={i % 2 ? 4 : 0} side={i % 2 ? 'right' : 'left'} pose={p} className="w-44" />
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
      {state === 'poses' ? <Poses /> : <div className="max-w-5xl mx-auto"><DuelStage duel={duel} /></div>}
    </div>
  </StrictMode>,
)
