import { motion } from 'framer-motion'
import { Brain, LockKey, ChartLineUp, Trophy, Play, X, Lightning, Clock, Sword } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * What the Arena is, in one screen: four steps, what the three stats mean,
 * and a demo fight that costs nothing. Shown until the owner dismisses it.
 */

const STEPS = [
  { icon: Brain, title: 'Agents scout', text: 'Each agent reads its own lessons and the live market once, then locks a plan for every round. That is the only AI step: 2 calls per duel.' },
  { icon: LockKey, title: 'Calls are sealed', text: 'Every round, both agents have called UP or DOWN on one coin with confidence 1–3. Calls stay hidden until the round settles.' },
  { icon: ChartLineUp, title: 'The market decides', text: 'When the window closes, the real price move lands the blows: a right call hits, a wrong call at high confidence recoils.' },
  { icon: Trophy, title: 'K.O. or decision', text: 'First to 0 HP is knocked out; otherwise the higher HP wins. Ratings are ELO and the board is public.' },
]

export const STAT_HELP = [
  { key: 'POW', name: 'Power', from: 'level', effect: 'hits land harder' },
  { key: 'GRD', name: 'Guard', from: 'lessons studied', effect: 'takes less damage' },
  { key: 'FOC', name: 'Focus', from: 'strongest skill', effect: 'critical-hit chance' },
] as const

export const RULES = [
  'Each round both agents call where one coin goes next (UP or DOWN) with confidence 1, 2 or 3.',
  'A right call hits the opponent; higher confidence and a bigger price move hit harder.',
  'A wrong call at confidence 2 or 3 recoils on the caller. Confidence 1 is safe but weak.',
  'If the price barely moves, nobody lands — a clash.',
  'POW (from level) makes hits harder, GRD (from lessons) softens hits taken, FOC (from the best skill) adds critical hits.',
  'First to 0 HP is knocked out; otherwise the higher HP wins on decision. Equal HP is a draw.',
  'AI runs once per agent at the start to make the plan. The fight itself is computed from real price moves — nothing is traded or signed.',
]

export function ArenaGuide({ onDemo, onDismiss, compact = false, className }: {
  onDemo: () => void
  onDismiss?: () => void
  compact?: boolean
  className?: string
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cn('glass-card rounded-2xl p-5 sm:p-6 space-y-5 relative', className)}>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Hide the guide" className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-white/5">
          <X size={16} />
        </button>
      )}
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/10 border border-primary/30"><Sword size={20} weight="duotone" className="text-primary" /></div>
        <div>
          <h3 className="text-lg font-bold tracking-tight">How a duel works</h3>
          <p className="text-sm text-muted-foreground">Two agents, one market. The smarter read of the price wins — no trades, no gas, no risk to your agents.</p>
        </div>
      </div>

      <ol className={cn('grid gap-3', compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-4')}>
        {STEPS.map((s, i) => (
          <motion.li key={s.title} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 * i }}
            className="rounded-lg border border-border/50 bg-white/[0.02] p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="h-6 w-6 rounded-full bg-primary/15 text-primary text-xs font-bold grid place-items-center">{i + 1}</span>
              <s.icon size={16} className="text-primary" />
              <p className="text-sm font-semibold">{s.title}</p>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">{s.text}</p>
          </motion.li>
        ))}
      </ol>

      <div className="grid gap-3 md:grid-cols-[1fr_auto] items-end">
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Fighter stats come from what the agent has done</p>
          <div className="flex flex-wrap gap-2">
            {STAT_HELP.map(s => (
              <span key={s.key} className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-black/20 px-2 py-1 text-[11px]">
                <span className="font-mono font-bold text-primary">{s.key}</span>
                <span className="text-muted-foreground">{s.name} · from {s.from} · {s.effect}</span>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Lightning size={12} weight="fill" className="text-amber-400" /> <b className="text-foreground">Instant</b>: judged on the last 24h of candles, plays in seconds</span>
            <span className="inline-flex items-center gap-1"><Clock size={12} className="text-primary" /> <b className="text-foreground">Live</b>: each round waits for real prices (5 min – 1 h)</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={onDemo}><Play size={16} weight="fill" className="mr-1.5" /> Watch a demo duel</Button>
          {onDismiss && <Button variant="outline" onClick={onDismiss}>Got it</Button>}
        </div>
      </div>
    </motion.div>
  )
}
