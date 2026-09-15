import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Plus, Robot, ShieldCheck, FlowArrow, Lightning, Coins, Clock, FileText } from '@phosphor-icons/react'
import { Agent, Event, NFT } from '@/lib/types'
import { cloudRunService } from '@/services/cloudRunService'
import { useBlockchain } from '@/hooks/useBlockchain'
import { isAgentAutoScouting, countActualVideosAnalyzed } from '@/lib/utils'
import { NicheAvatar } from '@/components/NicheAvatar'

interface DashboardViewProps {
  agents: Agent[]
  events: Event[]
  nfts: NFT[]
  dataLoaded: boolean
  isPlatformView: boolean
  onSelectAgent: (agent: Agent) => void
  onOpenAgent: (agent: Agent) => void
  onSpawnAgent: () => void
  onConnectWallet: () => void
  onOpenMyAgents: () => void
  onOpenMarket: () => void
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
  onSelectAgent,
  onOpenAgent,
  onSpawnAgent,
  onConnectWallet,
  onOpenMyAgents,
  onOpenMarket,
  onRunAutoScout,
  onChatAgent,
}: DashboardViewProps) {
  const { isConnected, address } = useBlockchain()
  const [inbox, setInbox] = useState<InboxPayload>(EMPTY_INBOX)
  const [inboxLoading, setInboxLoading] = useState(false)

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

  // Hero question: derive the ONE thing the owner should look at next.
  const urgentAction = useMemo(() => {
    if (!isConnected) return null
    const firstProposal = inbox.pending_proposals[0]
    if (firstProposal) {
      const ownerAgent = agents.find(a => a.id === firstProposal.agent_id)
      return {
        kind: 'pending-proposal' as const,
        agent: ownerAgent,
        proposal: firstProposal,
        cta: 'Review proposal',
      }
    }
    const firstPaused = inbox.paused_agents[0]
    if (firstPaused) {
      const ownerAgent = agents.find(a => a.id === firstPaused.agent_id)
      return {
        kind: 'paused-agent' as const,
        agent: ownerAgent,
        paused: firstPaused,
        cta: 'Re-enable scout',
      }
    }
    const firstLowGas = inbox.low_gas_agents[0]
    if (firstLowGas) {
      const ownerAgent = agents.find(a => a.id === firstLowGas.agent_id)
      return {
        kind: 'low-gas' as const,
        agent: ownerAgent,
        gas: firstLowGas,
        cta: 'Top up gas',
      }
    }
    return null
  }, [inbox, agents, isConnected])

  // Compressed stats — the only KPI a glance should land on.
  const stats = useMemo(() => ({
    totalAgents: agents.length,
    autoScouting: agents.filter(isAgentAutoScouting).length,
    videosAnalyzed: isPlatformView
      ? events.length
      : countActualVideosAnalyzed(agents, events),
    pendingProposals: inbox.counts.pending_proposals,
  }), [agents, events, isPlatformView, inbox.counts.pending_proposals])

  return (
    <div className="space-y-5">
      {/* ── Hero: One question, one answer ───────────────────────────────── */}
      <section>
        {isConnected ? (
          urgentAction ? (
            <UrgentActionBanner action={urgentAction} onOpenAgent={onOpenAgent} />
          ) : (
            <HeroReadyStats agents={agents} stats={stats} />
          )
        ) : (
          <HeroConnect onConnect={onConnectWallet} agents={agents} />
        )}
      </section>

      {/* ── Compact stat strip ──────────────────────────────────────────── */}
      <section>
        {!dataLoaded ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="glass-card-hover p-4">
                <div className="h-2.5 w-16 rounded bg-muted/40 mb-2 animate-pulse" />
                <div className="h-6 w-12 rounded bg-muted/40 animate-pulse" />
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <CompactStat
              label={isPlatformView ? 'Platform agents' : 'Your agents'}
              value={stats.totalAgents}
              icon={<Robot size={16} />}
              tone="primary"
            />
            <CompactStat
              label="Auto-scouting"
              value={stats.autoScouting}
              icon={<Lightning size={16} />}
              tone="emerald"
              sublabel={stats.autoScouting > 0 ? 'monitoring' : 'idle'}
            />
            <CompactStat
              label="Videos analyzed"
              value={stats.videosAnalyzed}
              icon={<FileText size={16} />}
              tone="accent"
            />
            <CompactStat
              label="Pending proposals"
              value={stats.pendingProposals}
              icon={<Clock size={16} />}
              tone={stats.pendingProposals > 0 ? 'amber' : 'slate'}
              sublabel={stats.pendingProposals > 0 ? 'need your approval' : 'all clear'}
            />
          </div>
        )}
      </section>

      {/* ── Pending inbox body (was hidden behind bell icon) ───────────── */}
      {isConnected && inbox.counts.total > 0 && (
        <InboxBody
          inbox={inbox}
          loading={inboxLoading}
          agents={agents}
          onOpenAgent={onOpenAgent}
          onOpenMyAgents={onOpenMyAgents}
        />
      )}

      {/* ── Action row: spawn / analyze / market ──────────────────────── */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <ActionTile
          icon={<Plus size={18} weight="bold" />}
          title="Spawn an agent"
          subtitle="Trading, DeFi, or Tech niche"
          onClick={isConnected ? onSpawnAgent : onConnectWallet}
        />
        <ActionTile
          icon={<Robot size={18} weight="duotone" />}
          title="Analyze YouTube URL"
          subtitle={agents[0] ? `With ${agents[0].name}` : 'Need at least one agent'}
          onClick={() => onSelectAgent(agents[0] ?? null)}
          disabled={!isConnected || agents.length === 0}
        />
        <ActionTile
          icon={<Coins size={18} weight="duotone" />}
          title="Check market context"
          subtitle="CMC + CoinGecko live data"
          onClick={onOpenMarket}
        />
      </section>

      {/* ── Agent roster — compact list, not grid ──────────────────────── */}
      {isConnected && agents.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Your agents
            </h2>
            <button
              onClick={onOpenMyAgents}
              className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
            >
              Open workspace <FlowArrow size={12} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
    </div>
  )
}

function HeroReadyStats({ agents, stats }: { agents: Agent[]; stats: { totalAgents: number; autoScouting: number; videosAnalyzed: number; pendingProposals: number } }) {
  return (
    <Card className="glass-card-hover p-5 border border-primary/20">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-1">
        Mission control
      </p>
      <h1 className="text-xl font-bold mb-1">
        {stats.pendingProposals > 0
          ? `${stats.pendingProposals} proposal${stats.pendingProposals === 1 ? '' : 's'} need your approval`
          : stats.autoScouting > 0
            ? `${stats.autoScouting} agent${stats.autoScouting === 1 ? '' : 's'} auto-scouting`
            : 'All agents idle'}
      </h1>
      <p className="text-xs text-muted-foreground">
        {agents.length} agent{agents.length === 1 ? '' : 's'} · {stats.videosAnalyzed} videos analyzed
      </p>
    </Card>
  )
}

function HeroConnect({ onConnect, agents }: { onConnect: () => void; agents: Agent[] }) {
  return (
    <Card className="glass-card-hover p-5 border border-primary/20">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono mb-1">
        Get started
      </p>
      <h1 className="text-xl font-bold mb-1">Connect your wallet to manage your agents</h1>
      <p className="text-xs text-muted-foreground mb-3">
        Meanwhile, here's what's happening on the platform — {agents.length} example agents live.
      </p>
      <Button onClick={onConnect} className="bg-gradient-to-r from-secondary to-accent hover:opacity-90">
        <ShieldCheck size={15} className="mr-2" />
        Connect wallet
      </Button>
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
  const accent = {
    'pending-proposal': { tone: 'amber', label: 'Pending proposal' },
    'paused-agent':     { tone: 'red',   label: 'Auto Scout paused' },
    'low-gas':          { tone: 'amber', label: 'Low gas' },
  }[action.kind]

  const detail = action.kind === 'pending-proposal'
    ? `${action.proposal.title} · ${action.proposal.category}`
    : action.kind === 'paused-agent'
      ? action.paused.reason
      : `Balance: ${action.gas.agent_gas_balance?.toFixed(4) ?? '?'} MNT`

  return (
    <Card className={`glass-card-hover p-5 border-${accent.tone}-500/30 bg-${accent.tone}-500/5`}>
      <div className="flex items-start gap-4">
        {action.agent && <NicheAvatar agent={action.agent} size="lg" />}
        <div className="flex-1 min-w-0">
          <Badge variant="outline" className={`text-[10px] border-${accent.tone}-500/40 text-${accent.tone}-400 mb-2`}>
            {accent.label}
          </Badge>
          <h2 className="text-lg font-bold mb-1">{action.agent?.name ?? 'Agent'}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{detail}</p>
        </div>
        <Button
          onClick={() => action.agent && onOpenAgent(action.agent)}
          disabled={!action.agent}
          className="bg-gradient-to-r from-primary to-accent hover:opacity-90 shrink-0"
        >
          {action.cta}
        </Button>
      </div>
    </Card>
  )
}

type UrgentAction =
  | {
      kind: 'pending-proposal'
      agent?: Agent
      proposal: { proposal_id: string; agent_id: string; title: string; category: string }
      cta: string
    }
  | {
      kind: 'paused-agent'
      agent?: Agent
      paused: { agent_id: string; agent_name: string; reason: string }
      cta: string
    }
  | {
      kind: 'low-gas'
      agent?: Agent
      gas: { agent_id: string; agent_name: string; agent_gas_balance: number }
      cta: string
    }

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
    primary: 'text-primary border-primary/30',
    emerald: 'text-emerald-400 border-emerald-500/30',
    accent: 'text-accent border-accent/30',
    amber: 'text-amber-400 border-amber-500/30',
    slate: 'text-muted-foreground border-border/30',
  }[tone]
  return (
    <Card className={`p-3.5 border ${toneClass}`}>
      <div className="flex items-start justify-between mb-1.5">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
          {label}
        </p>
        {icon}
      </div>
      <p className="text-2xl font-bold font-mono">{value}</p>
      {sublabel && (
        <p className="text-[10px] text-muted-foreground/70 mt-0.5">{sublabel}</p>
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
    <Card className="glass-card-hover p-4 border border-amber-500/25 bg-amber-500/5">
      <div className="flex items-center justify-between mb-3">
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
      <div className="space-y-2">
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
      className="text-left p-4 rounded-xl border border-border/40 bg-card/40 hover:border-primary/40 hover:bg-card/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed group"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">{title}</p>
          <p className="text-[10px] text-muted-foreground">{subtitle}</p>
        </div>
      </div>
    </button>
  )
}
