import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Brain, ChartLine, Lightning, MagnifyingGlass, Plus, Robot, ShieldCheck, Sparkle } from '@phosphor-icons/react'
import { AgentCard } from '@/components/AgentCard'
import { StatTile, type StatTone } from '@/components/StatTile'
import { NeuralFusionLab } from '@/components/NeuralFusionLab'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Agent, Niche, Event } from '@/lib/types'
import { cn, isAgentAutoScouting, countActualVideosAnalyzed } from '@/lib/utils'
import { getChain } from '@/lib/blockchain/chains'
import { avatarDataUri } from '@/lib/agentAvatar'

interface MyAgentsViewProps {
  agents: Agent[]
  /** Network the wallet is on. Agents live on one chain each; this view leads
   * with the ones on the current network and keeps the rest one tap away. */
  currentChainId?: number
  /** All event docs in the current session — used for per-agent actual video
   * counts so the cards reflect documents, not counters. */
  events?: Event[]
  walletConnected: boolean
  onConnectWallet: () => void
  onSpawn: () => void
  onOpenAgent: (agent: Agent) => void
  onConfigure: (agent: Agent) => void
  onChat: (agent: Agent) => void
  onViewEvolution: (agent: Agent) => void
  onToggleAutoReplenish: (agent: Agent, enabled: boolean) => void
  onTopUpGas?: (agent: Agent) => void
  onOpenProposals: (agent: Agent) => void
  onListMarketplace?: (agent: Agent) => void
  /** Agents of this owner listed on the escrow, by agent id. */
  listings?: Record<string, { price: number; chainId?: number }>
  onDeleteAgent: (agent: Agent) => void
  onRetrySpawn: (agent: Agent) => void
  proposalCounts: Record<string, number>
  userBalance: number
  onInitiateFusion: () => void
  onCooldownBoost: (agentId: string) => void
}

type StatusFilter = 'all' | Agent['status']
type SortKey = 'newest' | 'level' | 'videos' | 'name'

const niches: Array<'all' | Niche> = ['all', 'Blockchain/DeFi', 'Trading/Investment', 'Technology', 'Security']
const NICHE_SHORT: Record<string, string> = {
  all: 'All', 'Blockchain/DeFi': 'DeFi', 'Trading/Investment': 'Trading', Technology: 'Tech', 'Security': 'Security',
}

const pill = (on: boolean) => cn(
  'h-8 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors',
  on ? 'border-primary/50 bg-primary/15 text-primary' : 'border-border/50 text-muted-foreground hover:text-foreground hover:border-border',
)
const selectClass = 'h-9 rounded-lg border border-border/50 bg-background/60 px-3 text-xs text-foreground'

/** A row of sample knights for the empty states. */
function AvatarParade({ niche }: { niche?: string }) {
  return (
    <div className="flex justify-center -space-x-3" aria-hidden>
      {['vanguard', 'oracle', 'sentinel', 'cipher', 'warden'].map((id, i) => (
        <img
          key={id}
          src={avatarDataUri(`sample-${id}`, niche ?? niches[1 + (i % 4)])}
          alt=""
          className={cn('rounded-2xl ring-2 ring-background shadow-xl shadow-black/40', i === 2 ? 'w-20 h-20 z-10 -translate-y-1' : 'w-14 h-14 mt-3 opacity-90')}
        />
      ))}
    </div>
  )
}

export function MyAgentsView({
  agents,
  currentChainId,
  events,
  walletConnected,
  onConnectWallet,
  onSpawn,
  onOpenAgent,
  onConfigure,
  onChat,
  onViewEvolution,
  onToggleAutoReplenish,
  onTopUpGas,
  onOpenProposals,
  onListMarketplace,
  listings,
  onDeleteAgent,
  onRetrySpawn,
  proposalCounts,
  userBalance,
  onInitiateFusion,
  onCooldownBoost,
}: MyAgentsViewProps) {
  const [query, setQuery] = useState('')
  const [niche, setNiche] = useState<'all' | Niche>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [sort, setSort] = useState<SortKey>('newest')
  // null = follow the default: this network when it has agents, else all.
  const [networkScope, setNetworkScope] = useState<'current' | 'all' | null>(null)

  const onCurrentNetwork = useMemo(
    () => agents.filter((a) => currentChainId != null && (a.chainId ?? 5003) === currentChainId),
    [agents, currentChainId],
  )
  const effectiveScope = networkScope ?? (onCurrentNetwork.length > 0 ? 'current' : 'all')
  const currentChain = currentChainId != null ? getChain(currentChainId) : undefined

  const actualEventsByAgent = useMemo(
    () => (events ?? []).reduce<Record<string, number>>((acc, e) => {
      acc[e.agentId] = (acc[e.agentId] ?? 0) + 1
      return acc
    }, {}),
    [events],
  )
  const filteredAgents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const videosOf = (a: Agent) => actualEventsByAgent[a.id] ?? a.eventsAttended
    const pool = effectiveScope === 'current' ? onCurrentNetwork : agents
    const list = pool.filter((agent) => {
      const matchesQuery = !normalizedQuery || `${agent.name} ${agent.niche}`.toLowerCase().includes(normalizedQuery)
      const matchesNiche = niche === 'all' || agent.niche === niche
      const matchesStatus = status === 'all' || agent.status === status
      return matchesQuery && matchesNiche && matchesStatus
    })
    const by: Record<SortKey, (a: Agent, b: Agent) => number> = {
      newest: (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
      level: (a, b) => b.level - a.level || videosOf(b) - videosOf(a),
      videos: (a, b) => videosOf(b) - videosOf(a),
      name: (a, b) => a.name.localeCompare(b.name),
    }
    return [...list].sort(by[sort])
  }, [agents, onCurrentNetwork, effectiveScope, niche, query, status, sort, actualEventsByAgent])

  if (!walletConnected) {
    return (
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
        <Card className="glass-card p-10 sm:p-14 text-center border border-primary/25">
          <AvatarParade />
          <Badge variant="outline" className="mt-6 mb-4 border-primary/30 text-primary">Private workspace</Badge>
          <h2 className="text-2xl font-black mb-2">Your agents live here</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed mb-6">
            Connect your wallet to create, operate, and review agents that belong to you. Public visitors can explore the proof feed on Dashboard.
          </p>
          <Button onClick={onConnectWallet} className="self-center bg-gradient-to-r from-primary to-secondary text-white font-bold shadow-lg shadow-primary/20">
            <ShieldCheck size={16} className="mr-2" weight="duotone" />
            Connect Wallet
          </Button>
        </Card>
      </motion.div>
    )
  }

  const activeCount = agents.filter(isAgentAutoScouting).length
  const learningCount = events
    ? countActualVideosAnalyzed(agents, events)
    : agents.reduce((total, agent) => total + agent.eventsAttended, 0)
  const proposalCount = Object.values(proposalCounts).reduce((total, count) => total + count, 0)
  const stats = [
    { label: 'Agents', value: agents.length, icon: Robot, tone: 'primary' },
    { label: 'Auto-scouting', value: activeCount, icon: Lightning, tone: 'emerald' },
    { label: 'Videos learned', value: learningCount, icon: Brain, tone: 'accent' },
    { label: 'Proposals waiting', value: proposalCount, icon: ChartLine, tone: 'amber' },
  ] satisfies { label: string; value: number; icon: typeof Robot; tone: StatTone }[]

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-primary font-mono uppercase tracking-[0.18em] mb-2">
            <Robot size={14} weight="duotone" /> Private agent workspace
          </div>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight">My Agents</h2>
          <p className="text-sm text-muted-foreground mt-1">Train them, check what needs you, and open any agent to go deeper.</p>
        </div>
        <Button onClick={onSpawn} className="bg-gradient-to-r from-secondary to-accent text-white font-bold shadow-lg shadow-secondary/20 self-start sm:self-auto">
          <Plus size={16} className="mr-2" weight="bold" />
          Spawn Agent
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map(({ label, value, icon: Icon, tone }) => (
          <StatTile key={label} label={label} value={value} tone={tone} icon={<Icon size={20} weight="duotone" />} />
        ))}
      </div>

      {agents.length === 0 ? (
        <Card className="glass-card p-10 sm:p-14 text-center border border-dashed border-primary/30">
          <AvatarParade />
          <h3 className="mt-6 text-xl font-black">Spawn your first agent</h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            Pick a niche and a personality. Your agent gets its own wallet and avatar, learns from YouTube, and proposes moves you sign.
          </p>
          <Button onClick={onSpawn} className="mt-6 self-center bg-gradient-to-r from-secondary to-accent text-white font-bold shadow-lg shadow-secondary/20">
            <Sparkle size={16} className="mr-2" weight="fill" />Spawn Agent
          </Button>
        </Card>
      ) : (
        <>
          {/* Toolbar */}
          <div className="flex flex-col xl:flex-row gap-3 xl:items-center">
            <div className="relative xl:w-72">
              <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agents" aria-label="Search agents" className="pl-9 h-9 bg-background/40" />
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1 xl:pb-0 -mx-1 px-1" role="group" aria-label="Niche">
              {niches.map((item) => (
                <button key={item} type="button" onClick={() => setNiche(item)} aria-pressed={niche === item} className={pill(niche === item)} title={item === 'all' ? 'All niches' : item}>
                  {NICHE_SHORT[item]}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 xl:ml-auto">
              {currentChain && (
                <div className="flex items-center gap-1 rounded-full border border-border/50 p-0.5" role="group" aria-label="Network">
                  <button type="button" onClick={() => setNetworkScope('current')} aria-pressed={effectiveScope === 'current'} className={cn(pill(effectiveScope === 'current'), 'h-7 border-transparent')}>
                    {currentChain.shortName} · {onCurrentNetwork.length}
                  </button>
                  <button type="button" onClick={() => setNetworkScope('all')} aria-pressed={effectiveScope === 'all'} className={cn(pill(effectiveScope === 'all'), 'h-7 border-transparent')}>
                    All · {agents.length}
                  </button>
                </div>
              )}
              <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} aria-label="Status" className={selectClass}>
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="idle">Idle</option>
                <option value="processing">Working</option>
                <option value="error">Needs attention</option>
              </select>
              <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label="Sort" className={selectClass}>
                <option value="newest">Newest first</option>
                <option value="level">Highest level</option>
                <option value="videos">Most videos</option>
                <option value="name">Name A–Z</option>
              </select>
            </div>
          </div>

          {filteredAgents.length === 0 ? (
            <Card className="glass-card p-10 text-center border border-dashed border-primary/30">
              <Robot size={34} className="mx-auto mb-3 text-muted-foreground/60" weight="duotone" />
              <h3 className="font-bold">No agents match this view</h3>
              <p className="text-xs text-muted-foreground mt-1">
                {effectiveScope === 'current' && agents.length > onCurrentNetwork.length
                  ? `${agents.length - onCurrentNetwork.length} of your agents live on other networks.`
                  : 'Clear the search or filters to see them again.'}
              </p>
              {effectiveScope === 'current' && agents.length > onCurrentNetwork.length && (
                <Button size="sm" variant="outline" className="mt-3 self-center w-fit mx-auto" onClick={() => setNetworkScope('all')}>
                  Show all networks
                </Button>
              )}
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredAgents.map((agent, index) => (
                <motion.div key={agent.id} className="h-full" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 8) * 0.04, duration: 0.25 }}>
                  <AgentCard
                    agent={agent}
                    videosAnalyzedActual={actualEventsByAgent[agent.id]}
                    onClick={() => onOpenAgent(agent)}
                    onConfigure={onConfigure}
                    onChat={onChat}
                    onViewEvolution={onViewEvolution}
                    onToggleAutoReplenish={onToggleAutoReplenish}
                    onTopUpGas={onTopUpGas}
                    pendingProposalCount={proposalCounts[agent.id] ?? 0}
                    onOpenProposals={onOpenProposals}
                    onListMarketplace={onListMarketplace}
                    forSalePrice={listings?.[agent.id]?.price}
                    onDeleteAgent={onDeleteAgent}
                    onRetrySpawn={onRetrySpawn}
                  />
                </motion.div>
              ))}
            </div>
          )}
        </>
      )}

      {agents.length >= 2 && (
        <NeuralFusionLab
          agents={agents}
          walletConnected={walletConnected}
          userBalance={userBalance}
          onConnectWallet={onConnectWallet}
          onInitiateFusion={onInitiateFusion}
          onCooldownBoost={onCooldownBoost}
        />
      )}
    </motion.div>
  )
}
