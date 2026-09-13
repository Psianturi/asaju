import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { CheckCircle, XCircle, ArrowSquareOut, Clock, Lightning, Info } from '@phosphor-icons/react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { ScoutLogEntry } from '@/lib/types'
import { useState } from 'react'

interface ScoutDecisionTableProps {
  logs: ScoutLogEntry[]
  loading: boolean
}

const REASON_CODE_LABELS: Record<string, { label: string; color: string }> = {
  MINTED:            { label: 'Minted',          color: 'text-green-400 bg-green-500/10 border-green-500/30' },
  LOW_SCORE:         { label: 'Low score',        color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  NO_NEW_EVENTS:     { label: 'No new events',    color: 'text-slate-400 bg-slate-500/10 border-slate-500/30' },
  DUPLICATE_TOPIC:   { label: 'Duplicate topic',  color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
  RPC_UNAVAILABLE:   { label: 'RPC error',        color: 'text-red-400 bg-red-500/10 border-red-500/30' },
  LLM_UNAVAILABLE:   { label: 'LLM error',        color: 'text-red-400 bg-red-500/10 border-red-500/30' },
  YOUTUBE_API_LIMIT: { label: 'YouTube quota',    color: 'text-orange-400 bg-orange-500/10 border-orange-500/30' },
  LOW_GAS:           { label: 'Low gas',          color: 'text-red-400 bg-red-500/10 border-red-500/30' },
  MINT_CAP_REACHED:  { label: 'Mint cap',         color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  AGENT_NOT_AUTHORIZED: { label: 'Not authorized', color: 'text-red-400 bg-red-500/10 border-red-500/30' },
}

function ScoreBar({ score, threshold }: { score: number | null; threshold: number | null }) {
  if (score === null) return <span className="text-xs text-muted-foreground/50">—</span>
  const pct = Math.min(100, Math.round(score))
  const passed = threshold !== null ? score >= threshold : true
  const color = passed
    ? 'from-green-500 to-emerald-400'
    : 'from-amber-500 to-yellow-400'

  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full bg-gradient-to-r', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono tabular-nums text-muted-foreground w-6 text-right">{pct}</span>
      {threshold !== null && (
        <span className="text-[10px] text-muted-foreground/50 font-mono">/{threshold}</span>
      )}
    </div>
  )
}

function LogRow({ entry, index }: { entry: ScoutLogEntry; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const isMinted = entry.action === 'MINTED'
  const rCode = REASON_CODE_LABELS[entry.reasonCode] ?? { label: entry.reasonCode, color: 'text-muted-foreground bg-muted/20 border-border' }
  const date = new Date(entry.runAt * 1000)
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className={cn(
        'rounded-lg border transition-all duration-200',
        isMinted
          ? 'bg-green-500/5 border-green-500/20'
          : 'bg-card/30 border-border/40 hover:border-border/60'
      )}
    >
      <div
        className="flex items-center gap-3 p-3 cursor-pointer"
        onClick={() => entry.reasonDescription && setExpanded(e => !e)}
      >
        {/* Action icon */}
        <div className="shrink-0">
          {isMinted
            ? <CheckCircle size={16} className="text-green-400" weight="fill" />
            : <XCircle size={16} className="text-muted-foreground/60" weight="fill" />
          }
        </div>

        {/* Candidate title */}
        <div className="flex-1 min-w-0">
          {entry.candidateTitle ? (
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-semibold truncate">{entry.candidateTitle}</p>
              {entry.candidateUrl && (
                <a
                  href={entry.candidateUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="shrink-0 text-primary/50 hover:text-primary transition-colors"
                >
                  <ArrowSquareOut size={11} />
                </a>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/50 italic">No candidate evaluated</p>
          )}
          <div className="flex items-center gap-2 mt-1">
            <Clock size={10} className="text-muted-foreground/40 shrink-0" />
            <span className="text-[10px] text-muted-foreground/50 font-mono">{dateStr} {timeStr}</span>
          </div>
        </div>

        {/* Score bar */}
        <div className="shrink-0 hidden sm:block">
          <ScoreBar score={entry.score} threshold={entry.thresholdApplied} />
        </div>

        {/* Gas balance */}
        {entry.agentGasBalance !== null && (
          <div className="shrink-0 hidden md:flex items-center gap-1 text-[10px] text-muted-foreground/60 font-mono">
            <Lightning size={10} weight="fill" />
            {entry.agentGasBalance.toFixed(3)}
          </div>
        )}

        {/* Reason badge */}
        <Badge
          variant="outline"
          className={cn('text-[10px] px-1.5 py-0 shrink-0 border font-semibold', rCode.color)}
        >
          {rCode.label}
        </Badge>

        {/* Expand hint */}
        {entry.reasonDescription && (
          <Info size={12} className="text-muted-foreground/30 shrink-0" />
        )}
      </div>

      {/* Expanded reason */}
      <AnimatePresence>
        {expanded && entry.reasonDescription && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="px-3 pb-3"
          >
            <p className="text-[11px] text-muted-foreground leading-relaxed border-t border-border/30 pt-2">
              {entry.reasonDescription}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border/30">
      <Skeleton className="w-4 h-4 rounded-full" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-2.5 w-3/4" />
        <Skeleton className="h-2 w-1/3" />
      </div>
      <Skeleton className="h-1.5 w-16 rounded-full" />
      <Skeleton className="h-4 w-16 rounded-full" />
    </div>
  )
}

export function ScoutDecisionTable({ logs, loading }: ScoutDecisionTableProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    )
  }

  if (logs.length === 0) {
    return (
      <div className="text-center py-6">
        <Clock size={32} className="mx-auto mb-2 text-muted-foreground/30" weight="duotone" />
        <p className="text-xs text-muted-foreground/60">No scout decisions yet</p>
        <p className="text-[11px] text-muted-foreground/40 mt-0.5">
          Decisions will appear here after the first Auto Scout run
        </p>
      </div>
    )
  }

  const minted = logs.filter(l => l.action === 'MINTED').length
  const skipped = logs.filter(l => l.action === 'SKIPPED').length

  return (
    <div className="space-y-3">
      {/* Summary stats */}
      <div className="flex items-center gap-3 text-[11px]">
        <div className="flex items-center gap-1.5 text-green-400">
          <CheckCircle size={11} weight="fill" />
          <span className="font-semibold">{minted}</span>
          <span className="text-muted-foreground">minted</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground/60">
          <XCircle size={11} weight="fill" />
          <span className="font-semibold">{skipped}</span>
          <span>skipped</span>
        </div>
        <div className="ml-auto text-muted-foreground/40">
          {logs.length} decision{logs.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Log rows */}
      <div className="space-y-1.5">
        {logs.map((entry, i) => (
          <LogRow key={entry.logId} entry={entry} index={i} />
        ))}
      </div>
    </div>
  )
}
