import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell, ClipboardText, Lightning, Pause, Coins, X, Eye, Target, ArrowUp, ArrowDown } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cloudRunService } from '@/services/cloudRunService'
import { useBlockchain } from '@/hooks/useBlockchain'
import { fmtTimeAgo, isFiniteNum } from '@/lib/format'

const STORAGE_KEY_PREFIX = 'asaju:inbox:dismissed:'
const POLL_INTERVAL_MS = 30_000

interface OwnerInbox {
  counts: {
    pending_proposals: number
    low_gas_agents: number
    paused_agents: number
    recent_mints: number
    recent_scout_runs: number
    owned_agents: number
    total: number
  }
  pending_proposals: Array<{
    proposal_id: string
    agent_id: string
    title: string
    category: string
    created_at: number | null
  }>
  low_gas_agents: Array<{
    agent_id: string
    agent_name: string
    agent_gas_balance: number
  }>
  paused_agents: Array<{
    agent_id: string
    agent_name: string
    reason: string
    paused_at: number | null
  }>
  recent_mints: Array<{
    agent_id: string
    log_id: string
    candidate_title: string | null
    candidate_url: string | null
    run_at: number | null
    score: number | null
  }>
  recent_scout_runs: Array<{
    agent_id: string
    log_id: string
    action: 'MINTED' | 'SKIPPED' | string
    reason_code: string | null
    reason_description: string | null
    candidate_title: string | null
    run_at: number | null
    score: number | null
  }>
  agent_progress: Array<{
    agent_id: string
    agent_name: string | null
    comprehension_score: number
    comprehension_next_milestone: number | null
    comprehension_progress_to_next: number
    last_scout_at: number | null
    last_event_at: number | null
    total_events: number
  }>
}

export function NotificationBell() {
  const { isConnected, address } = useBlockchain()
  const [inbox, setInbox] = useState<OwnerInbox | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async (silent = false) => {
    if (!isConnected || !address) return
    if (!silent) setLoading(true)
    try {
      const data = await cloudRunService.getOwnerInbox(address)
      setInbox(data as unknown as OwnerInbox)
    } catch (err) {
      console.error('Inbox refresh failed', err)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [address, isConnected])

  useEffect(() => {
    if (!isConnected || !address) {
      setInbox(null)
      return
    }
    void refresh(true)
    const interval = setInterval(() => void refresh(true), POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [address, isConnected, refresh])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${address}`)
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as string[]
        setDismissed(new Set(parsed))
      } catch {
        // ignore malformed stored value
      }
    }
  }, [address])

  const dismissItem = useCallback(
    (key: string) => {
      setDismissed(prev => {
        const next = new Set(prev)
        next.add(key)
        if (typeof window !== 'undefined' && address) {
          window.localStorage.setItem(
            `${STORAGE_KEY_PREFIX}${address}`,
            JSON.stringify(Array.from(next)),
          )
        }
        return next
      })
    },
    [address],
  )

  if (!isConnected) return null

  const total = inbox?.counts?.total ?? 0
  const visiblePendingProposals =
    inbox?.pending_proposals?.filter(p => !dismissed.has(`prop:${p.proposal_id}`)) ?? []
  const visiblePaused =
    inbox?.paused_agents?.filter(a => !dismissed.has(`paused:${a.agent_id}`)) ?? []
  const visibleLowGas =
    inbox?.low_gas_agents?.filter(a => !dismissed.has(`gas:${a.agent_id}`)) ?? []
  const visibleRecentMints =
    inbox?.recent_mints?.filter(m => !dismissed.has(`mint:${m.log_id}`)) ?? []
  const visibleRecentScoutRuns =
    inbox?.recent_scout_runs?.filter(r => !dismissed.has(`run:${r.log_id}`)) ?? []

  const visibleTotal =
    visiblePendingProposals.length +
    visiblePaused.length +
    visibleLowGas.length +
    visibleRecentMints.length

  const badgeCount = Math.min(99, visibleTotal)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Open inbox"
          className="relative p-2 rounded-lg hover:bg-muted/50 transition-colors"
          onClick={() => setOpen(true)}
        >
          <Bell size={20} weight="duotone" className="text-foreground" />
          <AnimatePresence>
            {badgeCount > 0 && (
              <motion.span
                key={badgeCount}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center"
              >
                {badgeCount}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </SheetTrigger>

      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="p-4 border-b border-border/40">
          <SheetTitle className="flex items-center gap-2">
            <Bell size={18} weight="duotone" />
            Inbox
          </SheetTitle>
          <SheetDescription>
            {visibleTotal} item{visibleTotal !== 1 ? 's' : ''} waiting on you
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading && !inbox && (
            <div className="text-xs text-muted-foreground text-center py-8">
              Loading…
            </div>
          )}

          {!loading && inbox && visibleTotal === 0 && (
            <div className="text-center py-12">
              <Bell size={32} className="text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">You're all caught up.</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Pending proposals, paused scouts, recent mints, and per-agent progress will appear here.
              </p>
            </div>
          )}

          {visiblePendingProposals.length > 0 && (
            <InboxSection title="Pending Proposals" icon={<ClipboardText size={14} />}>
              {visiblePendingProposals.map(p => (
                <InboxItem
                  key={p.proposal_id}
                  title={p.title || '(untitled)'}
                  subtitle={`${p.category.toUpperCase()} • ${p.agent_id.slice(0, 12)}…`}
                  accent="amber"
                  onDismiss={() => dismissItem(`prop:${p.proposal_id}`)}
                />
              ))}
            </InboxSection>
          )}

          {visiblePaused.length > 0 && (
            <InboxSection title="Auto Scout Paused" icon={<Pause size={14} />}>
              {visiblePaused.map(a => (
                <InboxItem
                  key={a.agent_id}
                  title={a.agent_name || a.agent_id}
                  subtitle={a.reason}
                  accent="red"
                  onDismiss={() => dismissItem(`paused:${a.agent_id}`)}
                />
              ))}
            </InboxSection>
          )}

          {visibleLowGas.length > 0 && (
            <InboxSection title="Low Gas Agents" icon={<Coins size={14} />}>
              {visibleLowGas.map(a => (
                <InboxItem
                  key={a.agent_id}
                  title={a.agent_name || a.agent_id}
                  subtitle={`Balance: ${a.agent_gas_balance?.toFixed(4) ?? '?'} MNT — top up to keep scouts running.`}
                  accent="amber"
                  onDismiss={() => dismissItem(`gas:${a.agent_id}`)}
                />
              ))}
            </InboxSection>
          )}

          {visibleRecentMints.length > 0 && (
            <InboxSection title="Recent Mints" icon={<Lightning size={14} />}>
              {visibleRecentMints.slice(0, 5).map(m => (
                <InboxItem
                  key={m.log_id}
                  title={m.candidate_title || '(video)'}
                  subtitle={`${m.agent_id.slice(0, 12)}… • score ${m.score ?? '?'}`}
                  accent="green"
                  href={m.candidate_url ?? undefined}
                  onDismiss={() => dismissItem(`mint:${m.log_id}`)}
                />
              ))}
            </InboxSection>
          )}

          {/* Recent scout runs — every Auto Scout tick (Minted + Skipped) so the
              owner can see what the agent did while they were away. The skipped
              rate is itself a signal: a constant low-relevance stream means the
              agent's niche keywords need tightening. */}
          {visibleRecentScoutRuns.length > 0 && (
            <InboxSection title="Recent Scout Runs" icon={<Eye size={14} />}>
              {visibleRecentScoutRuns.slice(0, 8).map(r => {
                const minted = r.action === 'MINTED'
                return (
                  <InboxItem
                    key={r.log_id}
                    title={r.candidate_title || (minted ? 'Minted (no title)' : 'Skipped run')}
                    subtitle={`${r.agent_id.slice(0, 12)}… • ${isFiniteNum(r.run_at) ? fmtTimeAgo(r.run_at as number) : '—'} • ${r.reason_description || r.reason_code || 'no reason'}`}
                    accent={minted ? 'green' : 'red'}
                    href={undefined}
                    onDismiss={() => dismissItem(`run:${r.log_id}`)}
                  />
                )
              })}
            </InboxSection>
          )}

          {/* Per-agent comprehension progress — shows *where each agent is* on
              its learning arc. Critical for the "did my agent do anything while
              I was away?" question: even with no notifications above this, the
              owner can see comprehension bar movement + last scout timestamp. */}
          {(inbox?.agent_progress ?? []).length > 0 && (
            <InboxSection title="Agent Learning Progress" icon={<Target size={14} />}>
              {inbox!.agent_progress.map(a => {
                const score = a.comprehension_score ?? 0
                const next = a.comprehension_next_milestone
                const pct = next ? Math.min(100, (score / next) * 100) : 100
                const lastScout = a.last_scout_at
                const lastEvent = a.last_event_at
                return (
                  <motion.div
                    key={a.agent_id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-2.5 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.03]"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-xs font-semibold truncate">{a.agent_name || a.agent_id}</span>
                      <span className="text-[10px] font-mono text-cyan-300 tabular-nums shrink-0">
                        {score}/100{next ? ` → ${next}` : ' ✓'}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.7 }}
                        className="h-full bg-gradient-to-r from-cyan-400 via-accent to-amber-400"
                      />
                    </div>
                    <div className="flex items-center justify-between mt-1 text-[9px] text-muted-foreground/70 font-mono">
                      <span>
                        {a.total_events ?? 0} event{(a.total_events ?? 0) === 1 ? '' : 's'}
                      </span>
                      <span>
                        last scout{' '}
                        {isFiniteNum(lastScout) ? fmtTimeAgo(lastScout as number) : 'never'}
                      </span>
                    </div>
                  </motion.div>
                )
              })}
            </InboxSection>
          )}
        </div>

        <div className="p-3 border-t border-border/40">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => void refresh(false)}
            disabled={loading}
          >
            Refresh
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function InboxSection({
  title,
  icon,
  children,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
        {icon}
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function InboxItem({
  title,
  subtitle,
  accent,
  href,
  onDismiss,
}: {
  title: string
  subtitle: string
  accent: 'green' | 'amber' | 'red'
  href?: string
  onDismiss: () => void
}) {
  const colorMap = {
    green: 'border-green-500/30 bg-green-500/5',
    amber: 'border-amber-500/30 bg-amber-500/5',
    red: 'border-red-500/30 bg-red-500/5',
  }
  return (
    <motion.div
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      className={`flex items-start gap-2 p-2.5 rounded-lg border ${colorMap[accent]} group`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-foreground truncate hover:underline"
            >
              {title}
            </a>
          ) : (
            <span className="text-xs font-semibold text-foreground truncate">{title}</span>
          )}
          <Badge variant="outline" className="text-[9px] py-0 shrink-0">
            {accent}
          </Badge>
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed mt-0.5 line-clamp-2">
          {subtitle}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-background/30 rounded"
      >
        <X size={12} className="text-muted-foreground" />
      </button>
    </motion.div>
  )
}
