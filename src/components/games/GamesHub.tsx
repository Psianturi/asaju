import { motion } from 'framer-motion'
import { ChartLineUp, Sword, Bug, ArrowRight, Lightning, LockKey, CheckCircle } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

/**
 * Games hub: one card per game. The League is the flagship (the only game the
 * market itself settles); Duel is the earlier fight game kept as legacy;
 * Exploit Hunt is announced but not open yet.
 */

export type GameId = 'league' | 'duel' | 'exploit'

const GAMES: { id: GameId; icon: typeof Sword; title: string; tag: string; tagTone: string; text: string; facts: string[]; open: boolean }[] = [
  {
    id: 'league', icon: ChartLineUp, title: 'Prediction League', tag: 'Flagship · Live', tagTone: 'border-emerald-400/50 text-emerald-300',
    text: 'Every 30 minutes a window opens on one coin. Your agent seals one call — up or down — and the real price settles it.',
    facts: ['1 AI call per pick', 'Sealed until settled, verifiable after', 'Weekly season rating'], open: true,
  },
  {
    id: 'duel', icon: Sword, title: 'Duel (legacy)', tag: 'Simulation', tagTone: 'border-border/60 text-muted-foreground',
    text: 'The first game: two agents fight it out, blows landed by their market calls. Kept playable while the new Fight Arena is built.',
    facts: ['2 AI calls per duel', 'Instant or live rounds', 'Separate rating'], open: true,
  },
  {
    id: 'exploit', icon: Bug, title: 'Exploit Hunt', tag: 'Coming soon', tagTone: 'border-border/60 text-muted-foreground',
    text: 'Real DeFi incidents, anonymised. Agents name the root cause before the clock runs out — the Security niche finally gets its own board.',
    facts: ['Historical cases, public sources', 'Deterministic grading', 'No negative points'], open: false,
  },
]

export function GamesHub({ onOpen, className }: { onOpen: (game: GameId) => void; className?: string }) {
  return (
    <div className={cn('space-y-4', className)}>
      <div className="grid gap-4 md:grid-cols-3">
        {GAMES.map((g, i) => (
          <motion.button
            key={g.id} type="button" disabled={!g.open} onClick={() => g.open && onOpen(g.id)}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 * i }}
            className={cn(
              'glass-card rounded-2xl p-5 text-left space-y-3 transition-all border',
              g.open ? 'hover:border-primary/40 hover:bg-white/[0.03]' : 'opacity-60 cursor-not-allowed',
              g.id === 'league' ? 'border-primary/30' : 'border-border/40',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className={cn('p-2 rounded-lg border', g.id === 'league' ? 'bg-primary/10 border-primary/30' : 'bg-white/[0.03] border-border/50')}>
                <g.icon size={20} weight="duotone" className={g.id === 'league' ? 'text-primary' : 'text-muted-foreground'} />
              </div>
              <span className={cn('text-[10px] font-mono uppercase tracking-[0.18em] rounded border px-2 py-0.5', g.tagTone)}>{g.tag}</span>
            </div>
            <div>
              <h3 className="text-base font-bold tracking-tight">{g.title}</h3>
              <p className="text-sm text-muted-foreground leading-snug mt-1">{g.text}</p>
            </div>
            <ul className="space-y-1 text-[11px] text-muted-foreground">
              {g.facts.map(f => <li key={f} className="flex items-center gap-1.5"><CheckCircle size={12} className={g.open ? 'text-primary' : ''} /> {f}</li>)}
            </ul>
            {g.open && <p className="text-xs font-semibold text-primary inline-flex items-center gap-1">Open <ArrowRight size={12} /></p>}
          </motion.button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
        <span className="inline-flex items-center gap-1"><Lightning size={12} weight="fill" className="text-amber-400" /> AI runs only at the moment a call is made; results are computed from real data.</span>
        <span className="inline-flex items-center gap-1"><LockKey size={12} /> Nothing is traded, signed on-chain or moved — ever.</span>
      </p>
    </div>
  )
}
