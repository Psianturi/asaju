import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Brain, Lightning, GearSix, Wallet, TreeStructure, Sparkle, ChartLine, CalendarBlank, Pulse, ShieldCheck } from '@phosphor-icons/react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Agent, Event, NFT } from '@/lib/types'
import { getAgentAvatar } from '@/lib/avatarUtils'
import { cn, calculateRarityTier, getRarityStyles, getRarityLabel } from '@/lib/utils'
import { getChain } from '@/lib/blockchain/chains'

interface AgentDetailViewProps {
  agent: Agent
  events: Event[]
  nfts: NFT[]
  onBack: () => void
  onConfigure?: (agent: Agent) => void
  onChat?: (agent: Agent) => void
  onTopUpGas?: (agent: Agent) => void
  onViewEvolution?: (agent: Agent) => void
  onToggleAutoReplenish?: (agent: Agent, enabled: boolean) => void
  pendingProposalCount?: number
  onOpenProposals?: (agent: Agent) => void
  onDeleteAgent?: (agent: Agent) => void
}

/**
 * Single-agent drill-down view. Reached by clicking an AgentCard; the user
 * can come back via the back button. Sections:
 *   1. Header: avatar, identity, back, primary action
 *   2. Stat strip: level, videos analyzed, NFTs minted, gas balance
 *   3. Wisdom timeline: events the agent has analyzed (newest first)
 *   4. Quick actions: chat, configure, breed, top-up, delete
 */
export function AgentDetailView({
  agent,
  events,
  nfts,
  onBack,
  onConfigure,
  onChat,
  onTopUpGas,
  onViewEvolution,
  onToggleAutoReplenish,
  pendingProposalCount,
  onOpenProposals,
  onDeleteAgent,
}: AgentDetailViewProps) {
  const avatar = useMemo(() => getAgentAvatar(agent.id, agent.name), [agent.id, agent.name])
  const rarityTier = calculateRarityTier(agent)
  const rarityStyles = getRarityStyles(rarityTier)
  const rarityLabel = getRarityLabel(rarityTier)
  const chain = getChain(agent.chainId ?? 0)
  const isSpecialRarity = rarityTier !== 'common'

  // Wisdom timeline = events belonging to this agent, newest first.
  const agentEvents = useMemo(() => {
    return events
      .filter(e => e.agentId === agent.id)
      .slice()
      .sort((a, b) => b.date - a.date)
  }, [events, agent.id])

  const agentNfts = useMemo(() => nfts.filter(n => n.agentId === agent.id), [nfts, agent.id])
  const gasBalance = agent.agentGasBalance ?? 0
  const gasStatus = gasBalance > 0.2 ? 'healthy' : gasBalance > 0.05 ? 'low' : 'depleted'

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-6"
    >
      {/* Back link */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={14} weight="bold" />
        Back to dashboard
      </button>

      {/* Header card */}
      <Card className={cn(
        'glass-card-hover p-6 relative overflow-hidden border-primary/20',
        isSpecialRarity && rarityStyles.borderClass,
      )}>
        {isSpecialRarity && (
          <div className={cn('absolute inset-0 rounded-lg opacity-10', rarityStyles.bgClass)} />
        )}
        <div className="relative flex flex-col sm:flex-row items-start gap-5">
          <div className={cn(
            'w-20 h-20 rounded-2xl flex items-center justify-center font-black text-2xl ring-2 flex-shrink-0',
            avatar.bgColor, avatar.ringColor, avatar.textColor,
            agent.status === 'active' && 'ring-primary',
          )}>
            {avatar.initials}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <h2 className="text-2xl font-black tracking-tight">{agent.name}</h2>
              {isSpecialRarity && (
                <Badge className={cn('text-[10px] font-bold px-2 py-0 border', rarityStyles.badgeClass)}>
                  {rarityLabel}
                </Badge>
              )}
              {agent.isGenesis && (
                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/40 text-[10px] font-bold px-1.5 py-0">
                  GENESIS
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px] border-primary/30 text-primary/80">
                Lv {agent.level}
              </Badge>
              <Badge variant="outline" className="text-[10px] border-cyan-500/30 text-cyan-400/80">
                {chain?.name ?? `Chain ${agent.chainId ?? 0}`}
              </Badge>
              {agent.generation && agent.generation > 1 && (
                <Badge variant="outline" className="text-[10px] border-violet-500/30 text-violet-400/80">
                  GEN-{agent.generation}
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">Videos Analyzed</p>
                <p className="text-xl font-bold font-mono mt-1">{agent.eventsAttended}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">NFTs Minted</p>
                <p className="text-xl font-bold font-mono mt-1">{agentNfts.length}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">Heritage</p>
                <p className="text-xl font-bold font-mono mt-1">{agent.breedingCount ?? 0}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono flex items-center gap-1">
                  <Wallet size={9} /> Gas Balance
                </p>
                <p className={cn(
                  'text-xl font-bold font-mono mt-1 flex items-center gap-2',
                  gasStatus === 'depleted' ? 'text-rose-400' : gasStatus === 'low' ? 'text-amber-400' : 'text-emerald-400',
                )}>
                  {gasBalance.toFixed(4)}
                  <span className="text-xs text-muted-foreground">{chain?.nativeSymbol ?? 'ETH'}</span>
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 flex-shrink-0 w-full sm:w-auto">
            {onViewEvolution && (
              <Button onClick={() => onViewEvolution(agent)} className="bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25">
                <Sparkle className="mr-2" weight="duotone" size={16} />
                Evolution
              </Button>
            )}
            {onChat && (
              <Button onClick={() => onChat(agent)} variant="outline" className="border-primary/30 hover:bg-primary/10">
                <Brain className="mr-2" weight="duotone" size={16} />
                Chat
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Quick actions bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {onConfigure && (
          <Button
            onClick={() => onConfigure(agent)}
            variant="outline"
            className="border-border/40 hover:border-primary/40 justify-start"
          >
            <GearSix className="mr-2" weight="duotone" size={16} />
            Configure
          </Button>
        )}
        {onTopUpGas && (
          <Button
            onClick={() => onTopUpGas(agent)}
            variant="outline"
            className="border-border/40 hover:border-amber-500/40 justify-start"
          >
            <Wallet className="mr-2" weight="duotone" size={16} />
            Top-up gas
          </Button>
        )}
        {onOpenProposals && (
          <Button
            onClick={() => onOpenProposals(agent)}
            variant="outline"
            className="border-border/40 hover:border-amber-500/40 justify-start relative"
          >
            <Lightning className="mr-2" weight="duotone" size={16} />
            Proposals
            {(pendingProposalCount ?? 0) > 0 && (
              <span className="ml-2 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-amber-500 text-[10px] font-black text-white">
                {pendingProposalCount}
              </span>
            )}
          </Button>
        )}
        {onDeleteAgent && (
          <Button
            onClick={() => {
              if (confirm(`Delete ${agent.name}? This removes the local record; on-chain NFT and history remain.`)) {
                onDeleteAgent(agent)
              }
            }}
            variant="outline"
            className="border-rose-500/20 text-rose-400/80 hover:bg-rose-500/10 justify-start"
          >
            <ShieldCheck className="mr-2" weight="duotone" size={16} />
            Delete
          </Button>
        )}
      </div>

      {/* Wisdom timeline */}
      <Card className="glass-card-hover p-6 border border-primary/20">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center">
            <ChartLine className="text-primary" weight="duotone" size={20} />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold">Wisdom timeline</h3>
            <p className="text-xs text-muted-foreground">{agentEvents.length} videos analyzed</p>
          </div>
        </div>

        {agentEvents.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground/70 text-sm">
            <Pulse size={32} className="mx-auto mb-3 opacity-50" weight="duotone" />
            No videos analyzed yet. Paste a YouTube URL on the dashboard to begin.
          </div>
        ) : (
          <div className="space-y-3 max-h-[480px] overflow-y-auto pr-2">
            {agentEvents.map((event) => (
              <div
                key={event.id}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <h4 className="font-semibold text-sm leading-tight flex-1">{event.title || 'YouTube Video'}</h4>
                  <Badge variant="outline" className="text-[10px] border-primary/30 text-primary/80 shrink-0">
                    {event.platform}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3 mb-2">
                  {event.summary}
                </p>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground/60 font-mono">
                  <span className="flex items-center gap-1">
                    <CalendarBlank size={10} />
                    {new Date(event.date).toLocaleDateString()}
                  </span>
                  <span className="capitalize">{event.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Heritage / Lineage placeholder */}
      {agent.parentIds && agent.parentIds.length > 0 && (
        <Card className="glass-card-hover p-6 border border-violet-500/20">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-violet-500/20 border border-violet-500/40 flex items-center justify-center">
              <TreeStructure className="text-violet-400" weight="duotone" size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold">Heritage</h3>
              <p className="text-xs text-muted-foreground">{agent.parentIds.length} parent agent(s)</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground/80 leading-relaxed">
            This agent was bred from {agent.parentIds.length} parent(s). Full heritage tree visualization coming soon.
          </p>
        </Card>
      )}
    </motion.div>
  )
}