import { useCallback, useEffect, useState } from 'react'
import { CheckCircle, Globe, ListBullets } from '@phosphor-icons/react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScoutDecisionTable } from '@/components/ScoutDecisionTable'
import { cloudRunService } from '@/services/cloudRunService'
import { scoutOutcome } from '@/lib/utils'
import type { Agent, ScoutLogEntry } from '@/lib/types'

/**
 * What Auto-Scout has done for this agent: its last autonomous mint and the
 * full decision log (mint or skip, with scores). Switching it on or off lives
 * in AutoScoutCard, under the owner's signed mandate.
 */
export function ScoutActivityCard({ agent }: { agent: Agent }) {
  const [logs, setLogs] = useState<ScoutLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showLog, setShowLog] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    cloudRunService.getAgentScoutLogs(agent.id)
      .then(setLogs)
      .catch(() => setLogs([]))
      .finally(() => setLoading(false))
  }, [agent.id])

  useEffect(() => { load() }, [load])

  // Must be a real mint, not merely an attended video.
  const lastMint = logs.find(l => scoutOutcome(l) === 'minted')

  return (
    <Card className="glass-card p-4 border border-border/30 gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Scout activity</p>
        {loading && <span className="text-[11px] text-muted-foreground animate-pulse">loading…</span>}
      </div>

      {lastMint ? (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <Globe size={14} className="shrink-0 text-rose-400" weight="duotone" />
            <p className="flex-1 text-xs font-semibold line-clamp-1" title={lastMint.candidateTitle ?? ''}>{lastMint.candidateTitle ?? 'Video'}</p>
            {lastMint.candidateUrl && (
              <a href={lastMint.candidateUrl} target="_blank" rel="noopener noreferrer" aria-label="Open the video">
                <CheckCircle size={14} weight="fill" className="text-emerald-400" />
              </a>
            )}
          </div>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span>{new Date(lastMint.runAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            <span>Score {lastMint.score}/{lastMint.thresholdApplied}</span>
            <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-emerald-300 border-emerald-500/30 bg-emerald-500/10">Minted</Badge>
          </div>
        </div>
      ) : !loading && (
        <p className="text-xs text-muted-foreground">No autonomous mint yet. Next runs search for: {agent.customAgenda || agent.niche}</p>
      )}

      <div className="border-t border-border/30 pt-2">
        <button type="button" onClick={() => setShowLog(v => !v)} aria-expanded={showLog}
          className="flex w-full items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <ListBullets size={13} weight="duotone" />
          <span className="font-semibold">Decision log</span>
          {logs.length > 0 && <Badge variant="outline" className="ml-1 px-1.5 py-0 text-[10px]">{logs.length}</Badge>}
          <span className="ml-auto text-muted-foreground/60">{showLog ? '▲' : '▼'}</span>
        </button>
        {showLog && (
          <div className="mt-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground/70">Every Auto-Scout decision, mint or skip, is recorded here.</p>
              <button type="button" onClick={load} className="text-[10px] text-primary/70 hover:text-primary">Refresh</button>
            </div>
            <ScoutDecisionTable logs={logs} loading={loading} />
          </div>
        )}
      </div>
    </Card>
  )
}
