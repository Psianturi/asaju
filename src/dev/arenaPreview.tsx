/**
 * Dev-only preview of the Arena pieces with scripted duels, so the fight
 * choreography and the fighter art can be checked without a wallet, a
 * backend or a live wait. Served by `vite` at /dev-arena.html; not part of
 * the production build.
 *
 *   ?state=instant  finished instant duel, replayed from the bell (default)
 *   ?state=live     live duel with a sealed round and a countdown
 *   ?state=guide    the first-visit guide
 *   ?state=poses    every fighter pose side by side
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/main.css'
import { DuelStage } from '@/components/arena/DuelStage'
import { ArenaGuide } from '@/components/arena/ArenaGuide'
import { Fighter, type FighterPose } from '@/components/arena/Fighter'
import { demoDuel, demoLiveDuel } from '@/lib/arenaDemo'

const state = new URLSearchParams(window.location.search).get('state') || 'instant'

function Poses() {
  const poses: FighterPose[] = ['idle', 'guard', 'slash', 'kick', 'combo', 'blast', 'hit', 'stumble', 'win', 'ko']
  return (
    <div className="grid grid-cols-5 gap-6 p-6" style={{ background: '#070A1C' }}>
      {poses.map((p, i) => (
        <div key={p} className="text-center text-white/70 text-xs">
          <div className="h-56 flex items-end justify-center">
            <Fighter agentId={i % 2 ? 'demo-rook' : 'demo-ayla'} name={p} niche="Trading/Investment" seed={i % 2 ? 11 : 3} side="left" pose={p} className="w-36" />
          </div>
          {p}
        </div>
      ))}
    </div>
  )
}

function Scene() {
  if (state === 'poses') return <Poses />
  if (state === 'guide') return <div className="max-w-5xl mx-auto"><ArenaGuide onDemo={() => {}} onDismiss={() => {}} /></div>
  return <div className="max-w-5xl mx-auto"><DuelStage duel={state === 'live' ? demoLiveDuel() : demoDuel()} demo /></div>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div className="dark min-h-screen p-6" style={{ background: 'oklch(0.12 0.03 250)' }}>
      <Scene />
    </div>
  </StrictMode>,
)
