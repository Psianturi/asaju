import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Brain, ChartLine, Lightning, MagnifyingGlass, Plus, Robot, ShieldCheck } from '@phosphor-icons/react'
import { AgentCard } from '@/components/AgentCard'
import { ProactiveScoutingPanel } from '@/components/ProactiveScoutingPanel'
import { NeuralFusionLab } from '@/components/NeuralFusionLab'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Agent, Niche, Event } from '@/lib/types'
import { isAgentAutoScouting } from '@/lib/utils'

interface MyAgentsViewProps {
  agents: Agent[]
  /** All event docs in the current session — used for per-agent actual video
   * counts so the AgentCard Wisdom Progress reflects documents, not counters. */
  events?: Event[]
  walletConnected: boolean
  onConnectWallet: () => void
  onSpawn: () => void
  onOpenAgent: (agent: Agent) => void
  onConfigure: (agent: Agent) => void
  onChat: (agent: Agent) => void
  onViewEvolution: (agent: Agent) => void
  onToggleAutoReplenish: (agent: Agent, enabled: boolean) => void
  onOpenProposals: (agent: Agent) => void
  onDeleteAgent: (agent: Agent) => void
  onRetrySpawn: (agent: Agent) => void
  onToggleScout: (agentId: string, enabled: boolean) => void
  onApproveEvent: (agentId: string, eventId: string) => void
  proposalCounts: Record<string, number>
  userBalance: number
  onInitiateFusion: () => void
  onCooldownBoost: (agentId: string) => void
}

type StatusFilter = 'all' | Agent['status']

const niches: Array<'all' | Niche> = ['all', 'Blockchain/DeFi', 'Trading/Investment', 'Technology', 'Health/Wellness']

export function MyAgentsView({
  agents,
  events,
  walletConnected,
  onConnectWallet,
  onSpawn,
  onOpenAgent,
  onConfigure,
  onChat,
  onViewEvolution,
  onToggleAutoReplenish,
  onOpenProposals,
  onDeleteAgent,
  onRetrySpawn,
  onToggleScout,
  onApproveEvent,
  proposalCounts,
  userBalance,
  onInitiateFusion,
  onCooldownBoost,
}: MyAgentsViewProps) {
  const [query, setQuery] = useState('')
  const [niche, setNiche] = useState<'all' | Niche>('all')
  const [status, setStatus] = useState<StatusFilter>('all')

  const filteredAgents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return agents.filter((agent) => {
      const matchesQuery = !normalizedQuery || `${agent.name} ${agent.niche}`.toLowerCase().includes(normalizedQuery)
      const matchesNiche = niche === 'all' || agent.niche === niche
      const matchesStatus = status === 'all' || agent.status === status
      return matchesQuery && matchesNiche && matchesStatus
    })
  }, [agents, niche, query, status])

  if (!walletConnected) {
    return (
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
        <Card className="glass-card p-10 sm:p-14 text-center border border-primary/25">
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-primary/20 to-secondary/20 border border-primary/35 flex items-center justify-center">
            <ShieldCheck size={32} className="text-primary" weight="duotone" />
          </div>
          <Badge variant="outline" className="mb-4 border-primary/30 text-primary">Private workspace</Badge>
          <h2 className="text-2xl font-black mb-2">Your agents live here</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed mb-6">
            Connect your wallet to create, operate, and review agents that belong to you. Public visitors can explore the proof feed on Dashboard.
          </p>
          <Button onClick={onConnectWallet} className="bg-gradient-to-r from-primary to-secondary text-white font-bold shadow-lg shadow-primary/20">
            <ShieldCheck size={16} className="mr-2" weight="duotone" />
            Connect Wallet
          </Button>
        </Card>
      </motion.div>
    )
  }

  const activeCount = agents.filter(isAgentAutoScouting).length
  const learningCount = events
    ? events.filter(e => agents.some(a => a.id === e.agentId)).length
    : agents.reduce((total, agent) => total + agent.eventsAttended, 0)
  const proposalCount = Object.values(proposalCounts).reduce((total, count) => total + count, 0)
  const actualEventsByAgent = events
    ? events.reduce<Record<string, number>>((acc, e) => {
        acc[e.agentId] = (acc[e.agentId] ?? 0) + 1
        return acc
      }, {})
    : {}

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-primary font-mono uppercase tracking-[0.18em] mb-2">
            <Robot size={14} weight="duotone" /> Private agent workspace
          </div>
          <h2 className="text-2xl sm:text-3xl font-black tracking-tight">My Agents</h2>
          <p className="text-sm text-muted-foreground mt-1">Operate your agents, inspect their learning, and act on their next proposal.</p>
        </div>
        <Button onClick={onSpawn} className="bg-gradient-to-r from-secondary to-accent text-white font-bold shadow-lg shadow-secondary/20">
          <Plus size={16} className="mr-2" weight="bold" />
          Spawn Agent
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total agents', value: agents.length, icon: Robot, color: 'text-primary' },
          { label: 'Auto-scouting', value: activeCount, icon: Lightning, color: 'text-emerald-400' },
          { label: 'Videos analyzed', value: learningCount, icon: Brain, color: 'text-accent' },
          { label: 'Pending proposals', value: proposalCount, icon: ChartLine, color: 'text-amber-400' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="glass-card-hover p-4 border border-border/30">
            <Icon size={18} className={`${color} mb-3`} weight="duotone" />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
            <p className="text-2xl font-black mt-1">{value}</p>
          </Card>
        ))}
      </div>

      <Card className="glass-card p-4 border border-border/30">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agents or niches" className="pl-9 bg-background/40" />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {niches.map((item) => (
              <Button key={item} type="button" size="sm" variant={niche === item ? 'default' : 'outline'} onClick={() => setNiche(item)} className="whitespace-nowrap text-xs">
                {item === 'all' ? 'All niches' : item}
              </Button>
            ))}
          </div>
          <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} className="h-9 rounded-md border border-border/50 bg-background/60 px-3 text-xs text-foreground">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="idle">Idle</option>
            <option value="processing">Processing</option>
            <option value="error">Needs attention</option>
          </select>
        </div>
      </Card>

      {filteredAgents.length === 0 ? (
        <Card className="glass-card p-10 text-center border border-dashed border-primary/30">
          <Robot size={34} className="mx-auto mb-3 text-muted-foreground/60" weight="duotone" />
          <h3 className="font-bold">No agents match this view</h3>
          <p className="text-xs text-muted-foreground mt-1">Clear the filters or spawn a new agent.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredAgents.map((agent, index) => (
            <motion.div key={agent.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="space-y-3">
              <AgentCard
                agent={agent}
                videosAnalyzedActual={actualEventsByAgent[agent.id]}
                onClick={() => onOpenAgent(agent)}
                onConfigure={onConfigure}
                onChat={onChat}
                onViewEvolution={onViewEvolution}
                onToggleAutoReplenish={onToggleAutoReplenish}
                pendingProposalCount={proposalCounts[agent.id] ?? 0}
                onOpenProposals={onOpenProposals}
                onDeleteAgent={onDeleteAgent}
                onRetrySpawn={onRetrySpawn}
              />
              {agent.level >= 2 && (
                <ProactiveScoutingPanel agent={agent} onToggleScout={onToggleScout} onApproveEvent={onApproveEvent} />
              )}
              <Button variant="ghost" size="sm" onClick={() => onOpenAgent(agent)} className="w-full justify-between text-xs text-muted-foreground hover:text-primary">
                Open agent workspace <ArrowRight size={14} />
              </Button>
            </motion.div>
          ))}
        </div>
      )}

      {agents.length >= 2 && (
        <NeuralFusionLab
          agents={agents}
          walletConnected={walletConnected}
          userBalance={userBalance}
          proposalCounts={proposalCounts}
          onConnectWallet={onConnectWallet}
          onInitiateFusion={onInitiateFusion}
          onConfigureAgent={onConfigure}
          onChatWithAgent={onChat}
          onViewEvolution={onViewEvolution}
          onToggleAutoReplenish={onToggleAutoReplenish}
          onOpenProposals={onOpenProposals}
          onDeleteAgent={onDeleteAgent}
          onRetrySpawn={onRetrySpawn}
          onCooldownBoost={onCooldownBoost}
        />
      )}
    </motion.div>
  )
}