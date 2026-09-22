import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Plus, Robot, ShieldCheck, FlowArrow, Lightning, Clock, FileText, GlobeHemisphereEast, Medal, Article, ArrowRight } from '@phosphor-icons/react'
import { Agent, Event, NFT } from '@/lib/types'
import { cloudRunService } from '@/services/cloudRunService'
import { isAgentAutoScouting, countActualVideosAnalyzed } from '@/lib/utils'
import { NicheAvatar } from '@/components/NicheAvatar'
import { MarketSnapshotCard } from '@/components/MarketSnapshotCard'
import { MarketIntelligenceHub } from '@/components/MarketIntelligenceHub'
import { CmcAiSummaryCard } from '@/components/CmcAiSummaryCard'
import { YouTubeSubmitDialog } from '@/components/YouTubeSubmitDialog'
import { AgentInsightsSection } from '@/components/AgentInsightsSection'
import { LiveScoutLog } from '@/components/LiveScoutLog'
import { FeaturedWisdomFeed, type WisdomFeedItem } from '@/components/FeaturedWisdomFeed'
import { RetroFuturisticBackground } from '@/components/RetroFuturisticBackground'

interface DashboardViewProps {
  agents: Agent[]
  events: Event[]
  nfts: NFT[]
  dataLoaded: boolean
  isPlatformView: boolean
  walletAddress?: string
  onSelectAgent: (agent: Agent) => void
  onOpenAgent: (agent: Agent) => void
  onSpawnAgent: () => void
  onConnectWallet: () => void
  onOpenMyAgents: () => void
  onRunAutoScout: (agentId: string) => void
  onChatAgent: (agent: Agent) => void
}

interface InboxPayload {
  counts: { pending_proposals: number; low_gas_agents: number; paused_agents: number; recent_mints: number; total: number }
  pending_proposals: Array<{ proposal_id: string; agent_id: string; title: string; category: string }>
  low_gas_agents: Array<{ agent_id: string; agent_name: string; agent_gas_balance: number }>
  paused_agents: Array<{ agent_id: string; agent_name: string; reason: string }>
  recent_mints: Array<{ agent_id: string; log_id: string; candidate_title: string | null; score: number | null; run_at: number | null }>
}

interface PublicMetrics {
  total_agents: number
  total_wisdom_nfts: number
  total_events_attended: number
  average_agent_level: number
  global_wisdom_index: number
  total_bred_agents: number
  total_proposals_approved: number
}

const EMPTY_INBOX: InboxPayload = {
  counts: { pending_proposals: 0, low_gas_agents: 0, paused_agents: 0, recent_mints: 0, total: 0 },
  pending_proposals: [],
  low_gas_agents: [],
  paused_agents: [],
  recent_mints: [],
}

export function DashboardView({
  agents,
  events,
  nfts,
  dataLoaded,
  isPlatformView,
  walletAddress,
  onSelectAgent,
  onOpenAgent,
  onSpawnAgent,
  onConnectWallet,
  onOpenMyAgents,
  onRunAutoScout,
  onChatAgent,
}: DashboardViewProps) {
  const isConnected = !isPlatformView
  const address = walletAddress
  const [inbox, setInbox] = useState<InboxPayload>(EMPTY_INBOX)
  const [inboxLoading, setInboxLoading] = useState(false)
  const [publicMetrics, setPublicMetrics] = useState<PublicMetrics | null>(null)
  const [publicMetricsLoading, setPublicMetricsLoading] = useState(false)
  const [featuredWisdom, setFeaturedWisdom] = useState<WisdomFeedItem[]>([])
  const [featuredLoading, setFeaturedLoading] = useState(false)
  const [youtubeDialogOpen, setYoutubeDialogOpen] = useState(false)
  const [youtubeAgent, setYoutubeAgent] = useState<Agent | null>(null)

  useEffect(() => {
    if (!isConnected || !address) {
      setInbox(EMPTY_INBOX)
      return
    }
    let cancelled = false
    setInboxLoading(true)
    cloudRunService
      .getOwnerInbox(address)
      .then(data => { if (!cancelled) setInbox(data as InboxPayload) })
      .catch(() => { if (!cancelled) setInbox(EMPTY_INBOX) })
      .finally(() => { if (!cancelled) setInboxLoading(false) })
    return () => { cancelled = true }
  }, [address, isConnected])

  useEffect(() => {
    if (isConnected) return
    let cancelled = false
    setPublicMetricsLoading(true)
    setFeaturedLoading(true)
    cloudRunService.getPublicMetrics()
      .then(m => { if (!cancelled) setPublicMetrics(m as PublicMetrics) })
      .catch(() => { if (!cancelled) setPublicMetrics(null) })
      .finally(() => { if (!cancelled) setPublicMetricsLoading(false) })
    cloudRunService.getPublicFeaturedWisdom()
      .then(items => { if (!cancelled) setFeaturedWisdom(Array.isArray(items) ? items.slice(0, 3) : []) })
      .catch(() => { if (!cancelled) setFeaturedWisdom([]) })
      .finally(() => { if (!cancelled) setFeaturedLoading(false) })
    return () => { cancelled = true }
  }, [isConnected])

  const urgentAction = useMemo(() => {
    if (!isConnected) return null
    const firstProposal = inbox.pending_proposals[0]
    if (firstProposal) {
      const ownerAgent = agents.find(a => a.id === firstProposal.agent_id)
      return { kind: 'pending-proposal' as const, agent: ownerAgent, proposal: firstProposal, cta: 'Review proposal' }
    }
    const firstPaused = inbox.paused_agents[0]
    if (firstPaused) {
      const ownerAgent = agents.find(a => a.id === firstPaused.agent_id)
      return { kind: 'paused-agent' as const, agent: ownerAgent, paused: firstPaused, cta: 'Re-enable scout' }
    }
    const firstLowGas = inbox.low_gas_agents[0]
    if (firstLowGas) {
      const ownerAgent = agents.find(a => a.id === firstLowGas.agent_id)
      return { kind: 'low-gas' as const, agent: ownerAgent, gas: firstLowGas, cta: 'Top up gas' }
    }
    return null
  }, [inbox, agents, isConnected])

  const stats = useMemo(() => ({
    totalAgents: agents.length,
    autoScouting: agents.filter(isAgentAutoScouting).length,
    videosAnalyzed: isPlatformView ? events.length : countActualVideosAnalyzed(agents, events),
    pendingProposals: inbox.counts.pending_proposals,
  }), [agents, events, isPlatformView, inbox.counts.pending_proposals])

  const autoAgents = agents.filter((a) => a.autoScoutEnabled)

  const visitorStatsLoading = !isConnected && publicMetricsLoading && publicMetrics == null

  return (
    <div className="space-y-4">
      <RetroFuturisticBackground />
      <section>
        {isConnected ? (
          urgentAction ? (
            <UrgentActionBanner action={urgentAction} onOpenAgent={onOpenAgent} />
          ) : (
            <HeroReadyStats agents={agents} stats={stats} />
          )
        ) : (
          <HeroConnect onConnect={onConnectWallet} agents={agents} platformCount={publicMetrics?.total_agents ?? null} />
        )}

        {/* Auto-Scout enable CTA — visible when the connected owner has agents
            but none of them have Auto-Scout turned on. Without this banner,
            owners miss the toggle entirely (it lives on the agent detail
            page) and assume Auto-Scout is "broken" or "doesn't exist".
            Milestone-based minting makes this safe to enable 24/7 — gas is
            only spent at level-ups, not per video. */}
        {isConnected &&
          agents.length > 0 &&
          autoAgents.length === 0 &&
          !isPlatformView && (
            <button
              type="button"
              onClick={() => onOpenAgent(agents[0])}
              className="w-full text-left flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-emerald-500/30 bg-gradient-to-r from-emerald-500/[0.06] to-cyan-500/[0.04] hover:from-emerald-500/10 hover:to-cyan-500/[0.08] transition-colors group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="relative shrink-0 w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center">
                  <span className="relative flex items-center justify-center w-2.5 h-2.5">
                    <span className="absolute inset-0 rounded-full bg-emerald-400/40 animate-ping" />
                    <span className="relative w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground">
                    Wake your agents up — Auto-Scout is off for all of them
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                    Tap to enable on {agents[0].name}. The agent will discover YouTube videos on its own every 6 hours, minting only at level-up milestones — gas-safe by design.
                  </p>
                </div>
              </div>
              <ArrowRight size={16} weight="bold" className="text-emerald-300 shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </button>
          )}
      </section>

      <section>
        {isConnected ? (
          !dataLoaded ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="p-3">
                  <div className="h-2.5 w-16 rounded bg-muted/40 mb-2 animate-pulse" />
                  <div className="h-6 w-12 rounded bg-muted/40 animate-pulse" />
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              <CompactStat label="Your agents" value={stats.totalAgents} icon={<Robot size={14} />} tone="primary" />
              <CompactStat label="Auto-scouting" value={stats.autoScouting} icon={<Lightning size={14} />} tone="emerald" sublabel={stats.autoScouting > 0 ? 'monitoring' : 'idle'} />
              <CompactStat label="Videos analyzed" value={stats.videosAnalyzed} icon={<FileText size={14} />} tone="accent" />
              <CompactStat label="Pending proposals" value={stats.pendingProposals} icon={<Clock size={14} />} tone={stats.pendingProposals > 0 ? 'amber' : 'slate'} sublabel={stats.pendingProposals > 0 ? 'need approval' : 'all clear'} />
            </div>
          )
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            <VisitorStat label="Platform agents" value={publicMetrics?.total_agents ?? null} icon={<Robot size={14} />} loading={visitorStatsLoading} tone="primary" />
            <VisitorStat label="Videos analyzed" value={publicMetrics?.total_events_attended ?? null} icon={<FileText size={14} />} loading={visitorStatsLoading} tone="accent" />
            <VisitorStat label="Wisdom NFTs" value={publicMetrics?.total_wisdom_nfts ?? null} icon={<Medal size={14} />} loading={visitorStatsLoading} tone="emerald" />
            <VisitorStat label="Avg agent level" value={publicMetrics != null ? Math.round(publicMetrics.average_agent_level * 10) / 10 : null} icon={<GlobeHemisphereEast size={14} />} loading={visitorStatsLoading} tone="amber" decimals={1} />
          </div>
        )}
      </section>

      {!isConnected && (featuredLoading || featuredWisdom.length > 0) && (
        <section>
          <div className="flex items-center justify-between mb-2 px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Article size={13} weight="duotone" className="text-cyan-300" />
              Featured agent wisdom
            </h2>
          </div>
          <FeaturedWisdomFeed
            items={featuredWisdom}
            loading={featuredLoading}
            explorerBase="https://explorer.sepolia.mantle.xyz"
            onRateWisdom={() => onConnectWallet()}
            ratedMap={{}}
            userWallet={undefined}
          />
        </section>
      )}

      {isConnected && inbox.counts.total > 0 && (
        <InboxBody
          inbox={inbox}
          loading={inboxLoading}
          agents={agents}
          onOpenAgent={onOpenAgent}
          onOpenMyAgents={onOpenMyAgents}
        />
      )}

      <MarketIntelligenceHub />

      {/* CMC AI Market Summary — CoinMarketCap's own AI digest, the highest
          priority context the agent uses for proposals. Placed directly below
          the Sensory Feed so the eye moves: data → AI digest → proposal. */}
      <CmcAiSummaryCard />

      <AgentInsightsSection
        agents={agents}
        isConnected={isConnected}
        onConnectWallet={onConnectWallet}
        onOpenAgent={onOpenAgent}
      />

      {/* Live scout log — shows the agent's most recent attended events so the
          "what does the agent do" gap is closed. No-op when there are no events. */}
      {agents.length > 0 && agents.some((a) => (a.recentScoutLog ?? []).length > 0) && (
        <LiveScoutLog items={agents.flatMap((a) => a.recentScoutLog ?? [])} />
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        <ActionTile
          icon={<Plus size={16} weight="bold" />}
          title="Spawn an agent"
          subtitle="Trading, DeFi, or Tech niche"
          onClick={isConnected ? onSpawnAgent : onConnectWallet}
        />
        <ActionTile
          icon={<Robot size={16} weight="duotone" />}
          title="Analyze YouTube URL"
          subtitle={
            !isConnected
              ? 'Connect wallet first'
              : agents.length === 0
                ? 'Spawn an agent first'
                : agents.length === 1
                  ? `Wake ${agents[0].name} now`
                  : `Wake one of ${agents.length} agents`
          }
          onClick={() => {
            if (!isConnected) {
              onConnectWallet()
              return
            }
            if (agents.length === 0) {
              onSpawnAgent()
              return
            }
            // Open dialog with first agent as default — user can switch inside.
            setYoutubeAgent(agents[0])
            setYoutubeDialogOpen(true)
          }}
          disabled={false}
        />
      </section>

      <YouTubeSubmitDialog
        open={youtubeDialogOpen}
        onOpenChange={setYoutubeDialogOpen}
        agent={youtubeAgent}
        agents={agents}
      />

      {isConnected && agents.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2 px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Your agents
            </h2>
            <button
              onClick={onOpenMyAgents}
              className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
            >
              Open workspace <FlowArrow size={12} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {agents.slice(0, 4).map(agent => (
              <button
                key={agent.id}
                onClick={() => onOpenAgent(agent)}
                className="text-left flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-card/40 hover:border-primary/40 hover:bg-card/60 transition-colors"
              >
                <NicheAvatar agent={agent} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{agent.name}</p>
                  <p className="text-[10px] text-muted-foreground font-mono truncate">
                    {agent.niche} · Lv {agent.level}
                  </p>
                </div>
                {isAgentAutoScouting(agent) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="flex items-center gap-2 px-1 pt-1">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border/60 to-transparent" />
        <p className="text-[9px] uppercase tracking-widest text-muted-foreground/60 font-mono">Context</p>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border/60 to-transparent" />
      </div>

      <MarketSnapshotCard />
    </div>
  )
}

function HeroReadyStats({ agents, stats }: { agents: Agent[]; stats: { totalAgents: number; autoScouting: number; videosAnalyzed: number; pendingProposals: number } }) {
  const autoAgents = agents.filter((a) => a.autoScoutEnabled)
  return (
    <Card className="p-5 border border-primary/30 bg-gradient-to-br from-primary/[0.08] to-transparent shadow-lg shadow-primary/5">
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">
          Mission control
        </p>
        {autoAgents.length > 0 && (
          <button
            type="button"
            onClick={() => {
              // Open the inbox bell programmatically — fall back to scrolling
              // the bell into view so the click is never a no-op.
              const trigger = document.querySelector<HTMLButtonElement>('[aria-label="Open inbox"]')
              if (trigger) trigger.click()
            }}
            title="Open inbox to see what the agents are doing while you were away"
            className="text-[9px] px-1.5 py-0.5 border border-emerald-400/40 bg-emerald-400/15 text-emerald-300 rounded-full font-bold tracking-wide uppercase gap-1 shrink-0 hover:bg-emerald-400/25 transition-colors cursor-pointer"
          >
            <span className="relative inline-flex items-center justify-center w-1.5 h-1.5 mr-1">
              <span className="absolute inset-0 rounded-full bg-emerald-400/50 animate-ping" />
              <span className="relative w-1 h-1 rounded-full bg-emerald-400" />
            </span>
            Auto-Scout active · {autoAgents.length}
          </button>
        )}
      </div>
      <h1 className="text-2xl font-bold mb-2 text-foreground leading-tight">
        {stats.pendingProposals > 0
          ? `${stats.pendingProposals} proposal${stats.pendingProposals === 1 ? '' : 's'} need your approval`
          : stats.autoScouting > 0
            ? `${stats.autoScouting} agent${stats.autoScouting === 1 ? '' : 's'} auto-scouting`
            : 'All agents idle'}
      </h1>
      <p className="text-sm text-gray-300 leading-relaxed">
        {agents.length} agent{agents.length === 1 ? '' : 's'} · {stats.videosAnalyzed} videos analyzed
        {autoAgents.length > 0 && (
          <span className="block text-[10px] font-mono text-emerald-300/80 mt-1">
            Agent learns in the background — check the Inbox for what it did while you were away.
          </span>
        )}
      </p>
    </Card>
  )
}

function HeroConnect({ onConnect, agents, platformCount }: { onConnect: () => void; agents: Agent[]; platformCount: number | null }) {
  const count = platformCount ?? agents.length
  return (
    <Card className="relative overflow-hidden p-4 border border-primary/30 bg-gradient-to-br from-primary/[0.06] via-transparent to-accent/[0.04] shadow-xl shadow-primary/5">
      <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-1">
        Get started
      </p>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold mb-1 font-brand text-brand-gradient">See what your agent would propose right now</h1>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Connect a wallet to unlock agent watchlists, AI-grounded proposals from live CoinMarketCap data, and human-in-the-loop approvals.
          </p>
          {count > 0 ? (
            <p className="text-[11px] text-primary/80 mt-1.5 font-mono">
              {count} agent{count === 1 ? '' : 's'} live on the platform.
            </p>
          ) : (
            <p className="text-[11px] text-accent/80 mt-1.5 font-mono">
              Be the first to spawn an agent.
            </p>
          )}
        </div>
        <Button onClick={onConnect} size="sm" className="bg-gradient-to-r from-primary via-secondary to-accent hover:opacity-95 shadow-lg shadow-primary/40 text-white shrink-0 self-start sm:self-auto">
          <ShieldCheck size={14} className="mr-1.5" weight="bold" />
          Connect wallet
        </Button>
      </div>
    </Card>
  )
}

function UrgentActionBanner({
  action,
  onOpenAgent,
}: {
  action: UrgentAction
  onOpenAgent: (a: Agent) => void
}) {
  const ACCENT: Record<UrgentAction['kind'], { label: string; card: string; badge: string }> = {
    'pending-proposal': {
      label: 'Pending proposal',
      card: 'border-amber-500/30 bg-amber-500/5',
      badge: 'border-amber-500/40 text-amber-400',
    },
    'paused-agent': {
      label: 'Auto Scout paused',
      card: 'border-red-500/30 bg-red-500/5',
      badge: 'border-red-500/40 text-red-400',
    },
    'low-gas': {
      label: 'Low gas',
      card: 'border-amber-500/30 bg-amber-500/5',
      badge: 'border-amber-500/40 text-amber-400',
    },
  }
  const accent = ACCENT[action.kind]

  const detail = action.kind === 'pending-proposal'
    ? `${action.proposal.title} · ${action.proposal.category}`
    : action.kind === 'paused-agent'
      ? action.paused.reason
      : `Balance: ${action.gas.agent_gas_balance?.toFixed(4) ?? '?'} MNT`

  return (
    <Card className={`p-4 border ${accent.card}`}>
      <div className="flex items-start gap-3">
        {action.agent && <NicheAvatar agent={action.agent} size="lg" />}
        <div className="flex-1 min-w-0">
          <Badge variant="outline" className={`text-[10px] ${accent.badge} mb-1.5`}>
            {accent.label}
          </Badge>
          <h2 className="text-base font-bold mb-0.5">{action.agent?.name ?? 'Agent'}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{detail}</p>
        </div>
        <Button
          onClick={() => action.agent && onOpenAgent(action.agent)}
          disabled={!action.agent}
          size="sm"
          className="bg-gradient-to-r from-primary to-accent hover:opacity-90 shrink-0"
        >
          {action.cta}
        </Button>
      </div>
    </Card>
  )
}

type UrgentAction =
  | { kind: 'pending-proposal'; agent?: Agent; proposal: { proposal_id: string; agent_id: string; title: string; category: string }; cta: string }
  | { kind: 'paused-agent'; agent?: Agent; paused: { agent_id: string; agent_name: string; reason: string }; cta: string }
  | { kind: 'low-gas'; agent?: Agent; gas: { agent_id: string; agent_name: string; agent_gas_balance: number }; cta: string }

function CompactStat({
  label,
  value,
  icon,
  tone,
  sublabel,
}: {
  label: string
  value: number
  icon: React.ReactNode
  tone: 'primary' | 'emerald' | 'accent' | 'amber' | 'slate'
  sublabel?: string
}) {
  const toneClass = {
    primary: 'text-primary border-primary/25',
    emerald: 'text-emerald-400 border-emerald-500/25',
    accent: 'text-accent border-accent/25',
    amber: 'text-amber-400 border-amber-500/25',
    slate: 'text-muted-foreground border-border/30',
  }[tone]
  return (
    <Card className={`p-3 border ${toneClass} bg-white/[0.02]`}>
      <div className="flex items-start justify-between mb-1">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-300">
          {label}
        </p>
        {icon}
      </div>
      <p className="text-3xl font-bold font-mono tabular-nums text-foreground leading-none">{value}</p>
      {sublabel && (
        <p className="text-[10px] text-muted-foreground mt-1.5">{sublabel}</p>
      )}
    </Card>
  )
}

function VisitorStat({
  label,
  value,
  icon,
  loading,
  tone,
  decimals = 0,
}: {
  label: string
  value: number | null
  icon: React.ReactNode
  loading: boolean
  tone: 'primary' | 'emerald' | 'accent' | 'amber'
  decimals?: number
}) {
  const toneClass = {
    primary: 'text-primary border-primary/25',
    emerald: 'text-emerald-400 border-emerald-500/25',
    accent: 'text-accent border-accent/25',
    amber: 'text-amber-400 border-amber-500/25',
  }[tone]
  const display = value == null
    ? '—'
    : decimals > 0
      ? value.toFixed(decimals)
      : Math.round(value).toLocaleString('en-US')
  return (
    <Card className={`p-3 border ${toneClass} bg-white/[0.02]`}>
      <div className="flex items-start justify-between mb-1">
        <p className="text-[9px] uppercase tracking-wider font-semibold text-muted-foreground">
          {label}
        </p>
        {icon}
      </div>
      {loading ? (
        <div className="h-7 w-16 rounded bg-muted/40 animate-pulse" />
      ) : (
        <p className="text-xl font-bold font-mono tabular-nums">{display}</p>
      )}
    </Card>
  )
}

function InboxBody({
  inbox,
  loading,
  agents,
  onOpenAgent,
  onOpenMyAgents,
}: {
  inbox: InboxPayload
  loading: boolean
  agents: Agent[]
  onOpenAgent: (a: Agent) => void
  onOpenMyAgents: () => void
}) {
  const agentById = useMemo(() => {
    const m = new Map<string, Agent>()
    agents.forEach(a => m.set(a.id, a))
    return m
  }, [agents])

  return (
    <Card className="p-3.5 border border-amber-500/25 bg-amber-500/5">
      <div className="flex items-center justify-between mb-2.5">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-amber-400 font-mono">
            Needs your attention
          </p>
          <p className="text-sm font-semibold">
            {inbox.counts.total} item{inbox.counts.total === 1 ? '' : 's'} waiting on you
          </p>
        </div>
        <button
          onClick={onOpenMyAgents}
          className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
        >
          View all <FlowArrow size={12} />
        </button>
      </div>
      <div className="space-y-1.5">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <>
            {inbox.pending_proposals.slice(0, 3).map(p => (
              <InboxRow
                key={p.proposal_id}
                accent="amber"
                agent={agentById.get(p.agent_id)}
                primary={`${p.title}`}
                secondary={`${p.category} · awaiting approval`}
                onClick={() => {
                  const a = agentById.get(p.agent_id)
                  if (a) onOpenAgent(a)
                }}
              />
            ))}
            {inbox.paused_agents.slice(0, 2).map(p => (
              <InboxRow
                key={`p:${p.agent_id}`}
                accent="red"
                agent={agentById.get(p.agent_id)}
                primary={p.agent_name}
                secondary={p.reason}
                onClick={() => {
                  const a = agentById.get(p.agent_id)
                  if (a) onOpenAgent(a)
                }}
              />
            ))}
            {inbox.low_gas_agents.slice(0, 2).map(p => (
              <InboxRow
                key={`g:${p.agent_id}`}
                accent="amber"
                agent={agentById.get(p.agent_id)}
                primary={p.agent_name}
                secondary={`Balance ${p.agent_gas_balance?.toFixed(4) ?? '?'} MNT — top up to keep scouting`}
                onClick={() => {
                  const a = agentById.get(p.agent_id)
                  if (a) onOpenAgent(a)
                }}
              />
            ))}
          </>
        )}
      </div>
    </Card>
  )
}

function InboxRow({
  accent,
  agent,
  primary,
  secondary,
  onClick,
}: {
  accent: 'amber' | 'red' | 'green'
  agent: Agent | undefined
  primary: string
  secondary: string
  onClick: () => void
}) {
  const accentClass = {
    amber: 'border-amber-500/30 bg-amber-500/5 text-amber-400',
    red: 'border-red-500/30 bg-red-500/5 text-red-400',
    green: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400',
  }[accent]
  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-center gap-3 p-2 rounded-lg border ${accentClass} hover:bg-background/30 transition-colors`}
    >
      {agent ? <NicheAvatar agent={agent} size="sm" /> : <div className="w-8 h-8 rounded-lg bg-muted/40" />}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate">{primary}</p>
        <p className="text-[10px] text-muted-foreground line-clamp-1">{secondary}</p>
      </div>
      <FlowArrow size={12} className="opacity-60" />
    </button>
  )
}

function ActionTile({
  icon,
  title,
  subtitle,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="action-tile-hover text-left p-4 rounded-lg border border-primary/40 bg-primary/[0.08] hover:border-primary/70 hover:bg-primary/[0.12] hover:shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
    >
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-lg bg-gradient-to-br from-primary/30 to-secondary/30 border border-primary/50 flex items-center justify-center group-hover:scale-105 transition-transform shadow-md shadow-primary/20">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-base text-foreground leading-tight">{title}</p>
          <p className="text-xs text-gray-300 mt-0.5 leading-snug">{subtitle}</p>
        </div>
        <ArrowRight size={16} className="text-primary opacity-0 group-hover:opacity-100 transition-opacity shrink-0" weight="bold" />
      </div>
    </button>
  )
}
