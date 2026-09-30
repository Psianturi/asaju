import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Brain, YoutubeLogo, ChartLine, Lightning } from '@phosphor-icons/react'
import { Card } from '@/components/ui/card'
import { cloudRunService, type MarketSnapshot } from '@/services/cloudRunService'
import type { Agent } from '@/lib/types'
import { fmtTimeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'

interface AgentPulseProps {
  agent: Agent
  /** Live CMC snapshot. When omitted the component fetches it once itself —
   *  pass it down from a parent that already fetched to avoid duplicate calls. */
  marketSnapshot?: MarketSnapshot | null
  className?: string
}

const SIX_HOURS = 6 * 60 * 60 * 1000
const FIFTEEN_MIN = 15 * 60 * 1000

// Timestamps arrive as ms from the backend, but older rows were written in
// seconds — normalize so recency math never silently breaks.
function toMs(ts: number | undefined | null): number {
  if (!ts || ts <= 0) return 0
  return ts < 1e12 ? ts * 1000 : ts
}

type PulseState = 'thinking' | 'learning' | 'watching' | 'dormant'

/**
 * AgentPulse — a "living" view of one agent driven only by real activity:
 * its last YouTube scout (left stream) and the live CMC snapshot it reasons
 * over (right stream). The core animates energetically only when something
 * genuinely happened recently; when the agent is idle it stays calm and says
 * so, rather than faking perpetual motion.
 */
export function AgentPulse({ agent, marketSnapshot, className }: AgentPulseProps) {
  const [selfSnapshot, setSelfSnapshot] = useState<MarketSnapshot | null>(null)
  const snapshot = marketSnapshot ?? selfSnapshot

  useEffect(() => {
    if (marketSnapshot !== undefined) return
    let cancelled = false
    cloudRunService
      .getMarketSnapshot()
      .then((s) => { if (!cancelled) setSelfSnapshot(s) })
      .catch(() => { if (!cancelled) setSelfSnapshot(null) })
    return () => { cancelled = true }
  }, [marketSnapshot])

  const lastVideo = agent.recentScoutLog?.[0]
  const lastLearnedMs = useMemo(() => {
    const fromLog = (agent.recentScoutLog ?? [])
      .map((r) => toMs(r.attended_at))
      .reduce((a, b) => Math.max(a, b), 0)
    return Math.max(fromLog, toMs(agent.lastScoutAt))
  }, [agent.recentScoutLog, agent.lastScoutAt])

  const now = Date.now()
  const learningActive =
    agent.status === 'processing' ||
    agent.status === 'active' ||
    (lastLearnedMs > 0 && now - lastLearnedMs < SIX_HOURS)

  const marketFresh = !!snapshot && now - toMs(snapshot.generated_at) < FIFTEEN_MIN

  const state: PulseState =
    agent.status === 'processing' ? 'thinking'
    : learningActive ? 'learning'
    : agent.autoScoutEnabled ? 'watching'
    : 'dormant'

  const anyStreamLive = learningActive || marketFresh
  const fg = snapshot?.fear_greed
  const btcChange = snapshot?.prices?.bitcoin?.usd_24h_change

  const STATE_META: Record<PulseState, { label: string; color: string; core: string }> = {
    thinking: { label: 'Reasoning', color: 'text-secondary', core: 'from-secondary/60 to-primary/40' },
    learning: { label: 'Learning', color: 'text-emerald-400', core: 'from-emerald-400/60 to-cyan-400/40' },
    watching: { label: 'Watching the market', color: 'text-cyan-300', core: 'from-cyan-400/50 to-primary/30' },
    dormant: { label: 'Dormant', color: 'text-muted-foreground', core: 'from-muted/40 to-muted/10' },
  }
  const meta = STATE_META[state]

  return (
    <Card className={cn('p-4 border border-primary/20 bg-gradient-to-br from-primary/[0.04] to-transparent overflow-hidden', className)}>
      <div className="flex items-center gap-2 mb-3">
        <span className="relative flex items-center justify-center w-2 h-2">
          {anyStreamLive && <span className="absolute inset-0 rounded-full bg-emerald-400/40 animate-ping" />}
          <span className={cn('relative w-1.5 h-1.5 rounded-full', anyStreamLive ? 'bg-emerald-400' : 'bg-muted-foreground/50')} />
        </span>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Neural activity · {agent.name}
        </p>
        <span className={cn('ml-auto text-[10px] font-mono font-bold uppercase tracking-wide', meta.color)}>{meta.label}</span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-3">
        <Stream
          side="left"
          active={learningActive}
          color="emerald"
          icon={<YoutubeLogo size={15} weight="duotone" />}
          label="YouTube"
          value={lastVideo?.title ?? (lastLearnedMs > 0 ? 'Knowledge stream' : 'No videos yet')}
          sub={lastLearnedMs > 0 ? fmtTimeAgo(lastLearnedMs) : 'idle'}
        />

        <Core state={state} coreClass={meta.core} />

        <Stream
          side="right"
          active={marketFresh}
          color="cyan"
          icon={<ChartLine size={15} weight="duotone" />}
          label="CoinMarketCap"
          value={
            fg
              ? `Fear & Greed ${fg.value} · ${fg.value_classification}`
              : marketFresh ? 'Live market feed' : 'Market feed offline'
          }
          sub={
            typeof btcChange === 'number'
              ? `BTC ${btcChange >= 0 ? '+' : ''}${btcChange.toFixed(1)}% 24h`
              : snapshot ? fmtTimeAgo(toMs(snapshot.generated_at)) : '—'
          }
        />
      </div>

      <div className="mt-3 pt-2.5 border-t border-border/30 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Lightning size={11} weight="fill" className={agent.autoScoutEnabled ? 'text-emerald-400' : 'text-muted-foreground/50'} />
        <span className="leading-snug">
          {state === 'dormant'
            ? 'Enable Auto-Scout to let this agent learn and read the market on its own.'
            : learningActive
              ? `Consuming knowledge — last learned ${lastLearnedMs > 0 ? fmtTimeAgo(lastLearnedMs) : 'recently'}.`
              : `Idle — last learned ${lastLearnedMs > 0 ? fmtTimeAgo(lastLearnedMs) : 'never'}. Auto-Scout ${agent.autoScoutEnabled ? 'on' : 'off'}.`}
        </span>
      </div>
    </Card>
  )
}

function Core({ state, coreClass }: { state: PulseState; coreClass: string }) {
  const energetic = state === 'thinking' || state === 'learning'
  return (
    <div className="relative w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center shrink-0">
      <motion.div
        className={cn('absolute inset-0 rounded-full bg-gradient-to-br blur-md', coreClass)}
        animate={energetic ? { scale: [1, 1.15, 1], opacity: [0.5, 0.85, 0.5] } : { scale: 1, opacity: 0.3 }}
        transition={energetic ? { duration: 2.2, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.6 }}
      />
      <motion.div
        className={cn('absolute inset-2 rounded-full border', energetic ? 'border-emerald-400/40' : 'border-border/40')}
        animate={energetic ? { rotate: 360 } : { rotate: 0 }}
        transition={energetic ? { duration: 8, repeat: Infinity, ease: 'linear' } : { duration: 0 }}
        style={{ borderStyle: 'dashed' }}
      />
      <motion.div
        animate={energetic ? { scale: [1, 1.08, 1] } : { scale: 1 }}
        transition={energetic ? { duration: 2.2, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.4 }}
      >
        <Brain size={26} weight="duotone" className={cn(energetic ? 'text-emerald-300' : 'text-muted-foreground')} />
      </motion.div>
    </div>
  )
}

function Stream({
  side, active, color, icon, label, value, sub,
}: {
  side: 'left' | 'right'
  active: boolean
  color: 'emerald' | 'cyan'
  icon: React.ReactNode
  label: string
  value: string
  sub: string
}) {
  const colorClass = color === 'emerald'
    ? { text: 'text-emerald-400', dot: 'bg-emerald-400', border: 'border-emerald-400/25', bg: 'bg-emerald-400/[0.04]' }
    : { text: 'text-cyan-300', dot: 'bg-cyan-400', border: 'border-cyan-400/25', bg: 'bg-cyan-400/[0.04]' }

  return (
    <div className={cn('relative rounded-lg border px-2.5 py-2 min-w-0', colorClass.border, colorClass.bg, side === 'right' && 'text-right')}>
      <div className={cn('flex items-center gap-1.5 mb-1', side === 'right' && 'flex-row-reverse')}>
        <span className={colorClass.text}>{icon}</span>
        <span className={cn('text-[9px] font-semibold uppercase tracking-wider', colorClass.text)}>{label}</span>
        {active && (
          <span className={cn('flex gap-0.5', side === 'right' && 'flex-row-reverse')}>
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className={cn('w-1 h-1 rounded-full', colorClass.dot)}
                animate={{ opacity: [0.2, 1, 0.2] }}
                transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2, ease: 'easeInOut' }}
              />
            ))}
          </span>
        )}
      </div>
      <p className="text-[11px] font-semibold text-foreground truncate leading-tight" title={value}>{value}</p>
      <p className="text-[9px] font-mono text-muted-foreground/70 mt-0.5 truncate">{sub}</p>
    </div>
  )
}
