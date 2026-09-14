import { startTransition, useState } from 'react'
import { Agent } from '@/lib/types'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Robot, Lightning, TrendUp, Brain, UserCircle, PencilSimple, ChatCircle, Coins, GearSix, CurrencyCircleDollar, TreeStructure, Wallet, ShoppingCart, Crown, Signature, Dna, Lightbulb, Trash, Warning, Copy, Check, ShieldWarning, Gauge } from '@phosphor-icons/react'
import { motion } from 'framer-motion'
import { cn, calculateRarityTier, getRarityStyles, getRarityLabel, WISDOM_UNLOCK_THRESHOLD } from '@/lib/utils'
import { GasStatusBadge } from './GasStatusBadge'
import { ChainBadge } from './ChainBadge'
import { DEFAULT_CHAIN_ID, getChain } from '@/lib/blockchain/chains'
import { getAgentAvatar } from '@/lib/avatarUtils'
import { NicheAvatar } from './NicheAvatar'

interface AgentCardProps {
  agent: Agent
  /** Actual count of event documents for this agent — preferred over the
   * agent.eventsAttended counter because the counter can drift (e.g. offspring
   * inherit the count without having actual documents). Falls back to the
   * counter when not supplied. */
  videosAnalyzedActual?: number
  onClick?: () => void
  onConfigure?: (agent: Agent) => void
  onChat?: (agent: Agent) => void
  onViewEvolution?: (agent: Agent) => void
  onTopUpGas?: (agent: Agent) => void
  onListMarketplace?: (agent: Agent) => void
  onToggleAutoReplenish?: (agent: Agent, enabled: boolean) => void
  pendingProposalCount?: number
  onOpenProposals?: (agent: Agent) => void
  onDeleteAgent?: (agent: Agent) => void
  onRetrySpawn?: (agent: Agent) => void
}

const statusColors = {
  idle: 'bg-muted/50 text-muted-foreground border-muted',
  active: 'bg-primary/20 text-primary border-primary animate-glow-pulse',
  processing: 'bg-secondary/20 text-secondary border-secondary animate-glow-pulse-purple',
  error: 'bg-destructive/20 text-destructive border-destructive'
}

const personalityIcons = {
  Aggressive: Lightning,
  Analytical: TrendUp,
  Creative: Brain
}

const subAgentIcons = {
  secretary: UserCircle,
  scribe: PencilSimple,
  'social-lite': ChatCircle,
  'mint-master': Coins
}

const subAgentLabels = {
  secretary: 'Secretary',
  scribe: 'Scribe',
  'social-lite': 'Social-Lite',
  'mint-master': 'Mint-Master'
}

export function AgentCard({ agent, videosAnalyzedActual, onClick, onConfigure, onChat, onViewEvolution, onTopUpGas, onListMarketplace, onToggleAutoReplenish, pendingProposalCount, onOpenProposals, onDeleteAgent, onRetrySpawn }: AgentCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [walletCopied, setWalletCopied] = useState(false)
  const videosAnalyzed = videosAnalyzedActual ?? agent.eventsAttended ?? 0

  const copyWalletAddress = async () => {
    await navigator.clipboard.writeText(agent.walletAddress)
    setWalletCopied(true)
    setTimeout(() => setWalletCopied(false), 1500)
  }
  const PersonalityIcon = personalityIcons[agent.personality]
  const progress = Math.min((videosAnalyzed / WISDOM_UNLOCK_THRESHOLD) * 100, 100)
  const avatar = getAgentAvatar(agent.id, agent.name)

  const rarityTier = calculateRarityTier(agent)
  const rarityStyles = getRarityStyles(rarityTier)
  const rarityLabel = getRarityLabel(rarityTier)
  const isSpecialRarity = rarityTier !== 'common'

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      whileHover={{ scale: 1.02 }}
      className="cursor-pointer"
    >
      <Card className={cn(
        'glass-card-hover p-6 relative overflow-hidden group transition-all duration-300',
        agent.status === 'active' && 'neon-border-cyan',
        agent.status === 'processing' && 'neon-border-purple',
        isSpecialRarity && rarityStyles.borderClass,
        isSpecialRarity && rarityStyles.glowClass
      )}>
        {isSpecialRarity && (
          <>
            <div className={cn(
              "absolute inset-0 rounded-lg opacity-20",
              rarityStyles.bgClass
            )} />
            <div className="absolute top-2 right-2 z-20">
              <motion.div
                animate={{
                  scale: [1, 1.05, 1],
                  opacity: [0.8, 1, 0.8]
                }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              >
                <Badge className={cn(
                  "text-[10px] font-bold px-2.5 py-0.5 shadow-2xl border-none relative overflow-hidden",
                  rarityStyles.badgeClass
                )}>
                  <motion.div
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                    animate={{
                      x: ['-100%', '200%']
                    }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  />
                  <span className="relative z-10 flex items-center gap-1">
                    {rarityLabel}
                    {agent.generation && agent.generation > 1 && ` GEN-${agent.generation}`}
                  </span>
                </Badge>
              </motion.div>
            </div>
          </>
        )}
        <div className="absolute top-0 right-0 w-40 h-40 bg-primary/10 rounded-full blur-3xl -mr-20 -mt-20 group-hover:bg-primary/15 transition-all duration-500" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-secondary/10 rounded-full blur-3xl -ml-16 -mb-16 group-hover:bg-secondary/15 transition-all duration-500" />
        
        <div className="relative z-10">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3" onClick={onClick}>
              <div className="relative">
                <NicheAvatar agent={agent} size="md" />
                {agent.status === 'active' && (
                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-primary rounded-full animate-pulse ring-2 ring-background" />
                )}
                {agent.isGenesis && (
                  <div className="absolute -bottom-1 -right-1">
                    <Crown size={14} className="text-amber-500" weight="fill" />
                  </div>
                )}
              </div>
              <div>
                <h3 className="font-bold text-lg tracking-tight flex items-center gap-2">
                  {agent.name}
                  {agent.isGenesis && (
                    <Badge className="bg-amber-500/20 text-amber-500 text-[10px] font-bold border-amber-500/30 px-1.5 py-0">
                      GENESIS
                    </Badge>
                  )}
                </h3>
                <div className="flex items-center gap-1.5">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={(e) => { e.stopPropagation(); copyWalletAddress() }}
                          className="flex items-center gap-1 text-xs text-muted-foreground font-mono hover:text-foreground transition-colors"
                        >
                          {agent.walletAddress.slice(0, 6)}...{agent.walletAddress.slice(-4)}
                          {walletCopied ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="font-mono text-xs">{walletCopied ? 'Copied!' : `${agent.walletAddress} — click to copy for top-up`}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <ChainBadge chainId={(agent as any).chainId ?? DEFAULT_CHAIN_ID} />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {agent.level >= 3 && (pendingProposalCount ?? 0) > 0 && (
                <motion.div
                  animate={{ scale: [1, 1.08, 1] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <Badge
                    className="bg-amber-500/20 text-amber-400 border-amber-500/40 text-[10px] font-bold px-1.5 py-0 cursor-pointer"
                    onClick={(e) => { e.stopPropagation(); onOpenProposals?.(agent) }}
                  >
                    <Lightbulb size={9} weight="fill" className="mr-0.5" />
                    {pendingProposalCount}
                  </Badge>
                </motion.div>
              )}
              <Badge className={cn('text-xs font-mono', statusColors[agent.status])}>
                {agent.status.toUpperCase()}
              </Badge>
            </div>
          </div>

          {agent.ownershipStatus && (
            <div className="mb-4 p-2.5 rounded-lg bg-accent/10 border border-accent/30" onClick={onClick}>
              <div className="flex items-center gap-2">
                {agent.ownershipStatus === 'original-creator' ? (
                  <>
                    <Crown className="text-accent" weight="fill" size={16} />
                    <span className="text-xs font-semibold text-accent uppercase tracking-wider">Original Creator</span>
                  </>
                ) : agent.ownershipStatus === 'bred' ? (
                  <>
                    <Dna className="text-secondary" weight="duotone" size={16} />
                    <span className="text-xs font-semibold text-secondary uppercase tracking-wider">Neural Fusion Offspring</span>
                  </>
                ) : (
                  <>
                    <ShoppingCart className="text-secondary" weight="fill" size={16} />
                    <span className="text-xs font-semibold text-secondary uppercase tracking-wider">Acquired via Marketplace</span>
                  </>
                )}
              </div>
            </div>
          )}

          {agent.ownershipStatus === 'bred' && (
            <div className="mb-4 rounded-lg border overflow-hidden"
              style={agent.spawnedOnV4
                ? { background: 'rgba(16,185,129,0.08)', borderColor: 'rgba(16,185,129,0.3)' }
                : { background: 'rgba(234,179,8,0.08)', borderColor: 'rgba(234,179,8,0.3)' }
              }
            >
              <div className="flex items-center gap-2 p-2">
                {agent.spawnedOnV4 ? (
                  <>
                    <Lightning size={13} className="text-emerald-400" weight="fill" />
                    <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Sovereign Mode Active</span>
                  </>
                ) : (
                  <>
                    <motion.div animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }}>
                      <GearSix size={13} className="text-yellow-400" weight="duotone" />
                    </motion.div>
                    <span className="text-xs font-semibold text-yellow-400 uppercase tracking-wider flex-1">Activating on V4...</span>
                    {onRetrySpawn && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onRetrySpawn(agent) }}
                        className="text-[10px] font-bold text-yellow-400 hover:text-yellow-300 underline underline-offset-2 transition-colors"
                      >
                        Retry
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 mb-5" onClick={onClick}>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Niche</p>
              <p className="text-sm font-semibold">{agent.niche}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Personality</p>
              <div className="flex items-center gap-1.5">
                <PersonalityIcon size={16} className="text-primary" weight="duotone" />
                <p className="text-sm font-semibold">{agent.personality}</p>
              </div>
            </div>
          </div>

          <div className="mb-5 space-y-3">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="p-3 rounded-lg bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/20 cursor-help">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <CurrencyCircleDollar size={18} className="text-primary" weight="duotone" />
                  <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Native Balance</span>
                </div>
                <span className="text-sm font-bold font-mono text-primary">{agent.mantleBalance?.toFixed(3) || '0.000'} {getChain(agent.chainId ?? DEFAULT_CHAIN_ID)?.nativeSymbol ?? 'MNT'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Gas Used:</span>
                <span className="text-xs font-mono text-muted-foreground">{agent.gasSpent?.toLocaleString() || '0'} units</span>
              </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs bg-card border-primary/30">
                  <p className="text-xs text-muted-foreground">
                    Self-funded via gas provisioning. Each agent starts with <span className="font-bold text-primary">0.5 MNT</span> reserved for autonomous operations.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <div className="p-3 rounded-lg bg-gradient-to-r from-secondary/10 to-accent/10 border border-secondary/30">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Wallet size={18} className="text-secondary" weight="duotone" />
                  <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Agentic Smart Account</span>
                </div>
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">Agent Gas Balance:</span>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-sm font-bold font-mono text-secondary cursor-help">{(agent.agentGasBalance ?? 0).toFixed(4)} MNT</span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs bg-card border-primary/30">
                      <p className="text-xs text-muted-foreground">Self-funded via Gas Provisioning</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>

              {/* Real-time gas status from backend monitoring */}
              <div className="mb-3 flex items-center justify-between px-2 py-1.5 rounded-md bg-background/30 border border-border/30">
                <span className="text-xs text-muted-foreground">Live Status:</span>
                <GasStatusBadge agentWallet={agent.walletAddress} chainId={agent.chainId} showLabel={true} />
              </div>
              
              {(agent.agentGasBalance ?? 0) > 0 && (agent.agentGasBalance ?? 0) < 0.08 && (
                <div className="mb-3 flex items-center gap-2 px-2.5 py-2 rounded-md bg-amber-500/10 border border-amber-500/30">
                  <Warning size={13} className="text-amber-400 flex-shrink-0" weight="fill" />
                  <span className="text-[10px] text-amber-400 font-semibold leading-tight">
                    Low gas — top up to keep agent operational
                  </span>
                </div>
              )}

              {onToggleAutoReplenish && (
                <div className="mb-3 p-2.5 rounded-md bg-background/50 border border-border/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-2 cursor-help">
                              <Lightning size={14} className={agent.autoReplenishGas ? 'text-green-500' : 'text-muted-foreground'} weight="fill" />
                              <span className="text-xs font-semibold">Auto-Replenish</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs bg-card border-primary/30">
                            <p className="text-xs text-muted-foreground">
                              Automatically deducts <span className="font-bold text-primary">0.1 MNT</span> from User Wallet when Agent Gas falls below <span className="font-bold text-destructive">0.05 MNT</span>
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <Switch
                      checked={agent.autoReplenishGas || false}
                      onCheckedChange={(checked) => {
                        if (onToggleAutoReplenish) {
                          onToggleAutoReplenish(agent, checked)
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="data-[state=checked]:bg-green-500"
                    />
                  </div>
                  {agent.autoReplenishGas && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-2 pt-2 border-t border-border/30"
                    >
                      <div className="flex items-center gap-2 text-[10px] text-green-500">
                        <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                        <span className="font-semibold uppercase tracking-wide">Self-Sustaining Mode Active</span>
                      </div>
                    </motion.div>
                  )}

                  {agent.autoScoutEnabled === false && agent.autoScoutDisabledReason && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="mt-2 pt-2 border-t border-border/30"
                          >
                            <div className="flex items-center gap-2 text-[10px] text-amber-400 cursor-help">
                              <ShieldWarning size={12} weight="fill" />
                              <span className="font-semibold uppercase tracking-wide">Auto Scout paused</span>
                            </div>
                          </motion.div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs bg-card border-amber-500/30">
                          <p className="text-xs text-foreground">{agent.autoScoutDisabledReason}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}

                  {(() => {
                    const cap = agent.dailyMintCap ?? 3
                    const used = agent.mintCount24h ?? 0
                    const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0
                    const remaining = Math.max(0, cap - used)
                    if (!agent.autoScoutEnabled) return null
                    return (
                      <div className="mt-2 pt-2 border-t border-border/30">
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                          <div className="flex items-center gap-1">
                            <Gauge size={11} />
                            <span className="font-semibold uppercase tracking-wide">Daily mints</span>
                          </div>
                          <span className={remaining === 0 ? 'text-amber-400 font-bold' : 'text-foreground'}>
                            {used}/{cap}
                          </span>
                        </div>
                        <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${
                              remaining === 0
                                ? 'bg-amber-500'
                                : pct >= 66
                                ? 'bg-amber-400'
                                : 'bg-green-500'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}
              
              {onTopUpGas && (
                <Button
                  onClick={(e) => {
                    e.stopPropagation()
                    onTopUpGas(agent)
                  }}
                  size="sm"
                  className="w-full h-7 bg-gradient-to-r from-secondary/20 to-accent/20 hover:from-secondary/30 hover:to-accent/30 border border-secondary/40 hover:border-secondary/60 text-secondary font-semibold text-xs transition-all"
                >
                  <Lightning className="mr-1" weight="fill" size={14} />
                  Top-Up Gas
                </Button>
              )}
            </div>
          </div>

          <div className="mb-5" onClick={onClick}>
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-muted-foreground font-medium">Wisdom Progress</span>
              <span className="font-mono font-bold text-primary">
                {agent.wisdomUnlocked
                  ? `${videosAnalyzed} videos · unlocked`
                  : `${videosAnalyzed}/${WISDOM_UNLOCK_THRESHOLD}`}
              </span>
            </div>
            <div className="relative h-2.5 bg-muted/50 rounded-full overflow-hidden border border-border/50">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.8, delay: 0.2 }}
                className={cn(
                  'h-full rounded-full',
                  agent.wisdomUnlocked 
                    ? 'bg-gradient-to-r from-yellow-400 via-amber-500 to-orange-500 animate-glow-pulse-gold' 
                    : 'bg-gradient-to-r from-primary via-accent to-secondary'
                )}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 mb-5" onClick={onClick}>
            <div className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20">
              <span className="text-muted-foreground">Level</span>
              <span className="font-bold text-primary">{agent.level}</span>
            </div>
            {agent.wisdomUnlocked && (
              <Badge className="bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold animate-glow-pulse-gold border-0">
                ✨ Wisdom Unlocked
              </Badge>
            )}
            {(agent.autonomousSignatures ?? 0) > 0 && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-green-500/10 border border-green-500/30 cursor-help">
                      <Signature size={13} className="text-green-400" weight="duotone" />
                      <span className="text-xs font-bold text-green-400 font-mono">{agent.autonomousSignatures}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="bg-card border-green-500/30">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-bold text-green-400">{agent.autonomousSignatures}</span> autonomous on-chain signature{(agent.autonomousSignatures ?? 0) !== 1 ? 's' : ''} — Mode B
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {agent.wisdomHeritageScore !== undefined && (agent.generation ?? 1) >= 2 && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-secondary/10 border border-secondary/30 cursor-help">
                      <Dna size={13} className="text-secondary" weight="duotone" />
                      <span className="text-xs font-bold text-secondary font-mono">{agent.wisdomHeritageScore}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="bg-card border-secondary/30">
                    <p className="text-xs text-muted-foreground">
                      Wisdom Heritage Score: <span className="font-bold text-secondary">{agent.wisdomHeritageScore}/100</span>
                      {agent.parentNames && (
                        <span className="block mt-0.5 text-muted-foreground/70">
                          Born from {agent.parentNames.parent_1} × {agent.parentNames.parent_2}
                        </span>
                      )}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>

          {agent.skillScores && Object.keys(agent.skillScores).length > 0 && (
            <div className="mb-5" onClick={onClick}>
              <div className="flex items-center gap-1.5 mb-2">
                <Brain size={13} className="text-accent" weight="duotone" />
                <span className="text-xs text-muted-foreground font-medium">Skills earned from videos analyzed</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(agent.skillScores)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 4)
                  .map(([category, score]) => (
                    <span
                      key={category}
                      className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded-full bg-accent/10 border border-accent/25 text-accent"
                    >
                      {category}
                      <span className="font-bold">{score}</span>
                    </span>
                  ))}
              </div>
            </div>
          )}

          {agent.lineageBiography && (agent.generation ?? 1) >= 2 && (
            <div className="mt-3 p-3 rounded-lg bg-secondary/5 border border-secondary/20" onClick={onClick}>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2 font-semibold flex items-center gap-1.5">
                <Dna size={12} className="text-secondary" weight="duotone" />
                Lineage Biography
              </p>
              <p className="text-xs text-muted-foreground/80 leading-relaxed italic whitespace-pre-line">
                {agent.lineageBiography}
              </p>
            </div>
          )}

          <div className="pt-5 border-t border-border/30 mb-5" onClick={onClick}>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3 font-semibold">Sub-Agent Status</p>
            <TooltipProvider>
              <div className="grid grid-cols-4 gap-3">
                {agent.subAgents.map((subAgent) => {
                  const Icon = subAgentIcons[subAgent.type]
                  return (
                    <Tooltip key={subAgent.type}>
                      <TooltipTrigger asChild>
                        <div className="flex flex-col items-center gap-2 p-2 rounded-lg bg-muted/20 border border-border/30 hover:border-primary/40 transition-all group/sub">
                          <div className="relative">
                            <Icon 
                              size={20} 
                              className={cn(
                                'transition-colors',
                                subAgent.status === 'active' ? 'text-primary' :
                                subAgent.status === 'processing' ? 'text-secondary' :
                                subAgent.status === 'error' ? 'text-destructive' :
                                'text-muted-foreground'
                              )}
                              weight={subAgent.status === 'idle' ? 'regular' : 'duotone'}
                            />
                            <div 
                              className={cn(
                                'absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-background',
                                subAgent.status === 'active' ? 'bg-green-500 animate-pulse' :
                                subAgent.status === 'processing' ? 'bg-yellow-500 animate-pulse' :
                                subAgent.status === 'error' ? 'bg-red-500' :
                                'bg-gray-500'
                              )}
                            />
                          </div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="glass-card border-primary/30">
                        <div className="space-y-1">
                          <p className="font-semibold text-xs">{subAgentLabels[subAgent.type]}</p>
                          <p className="text-xs text-muted-foreground">{subAgent.description}</p>
                          <p className={cn(
                            'text-xs font-mono font-bold',
                            subAgent.status === 'active' ? 'text-green-500' :
                            subAgent.status === 'processing' ? 'text-yellow-500' :
                            subAgent.status === 'error' ? 'text-red-500' :
                            'text-gray-500'
                          )}>
                            {subAgent.status.toUpperCase()}
                          </p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            </TooltipProvider>
          </div>

          <div className="space-y-2">
            {onOpenProposals && agent.level >= 3 && (
              <Button
                onClick={(e) => {
                  e.stopPropagation()
                  startTransition(() => onOpenProposals(agent))
                }}
                variant="outline"
                size="sm"
                className={cn(
                  'w-full transition-all font-semibold',
                  (pendingProposalCount ?? 0) > 0
                    ? 'border-amber-500/50 text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/70 animate-glow-pulse-gold'
                    : 'border-amber-500/20 text-amber-400/70 hover:bg-amber-500/10 hover:border-amber-500/40'
                )}
              >
                <Lightbulb className="mr-1.5" weight="duotone" size={16} />
                Strategic Consult
                {(pendingProposalCount ?? 0) > 0 && (
                  <Badge className="ml-auto bg-amber-500/30 text-amber-400 border-0 text-[10px] px-1.5 py-0">
                    {pendingProposalCount}
                  </Badge>
                )}
              </Button>
            )}
            {onViewEvolution && (
              <Button
                onClick={(e) => {
                  e.stopPropagation()
                  startTransition(() => onViewEvolution(agent))
                }}
                variant="outline"
                size="sm"
                className="w-full border-secondary/30 hover:bg-secondary/10 hover:border-secondary/50 transition-all"
              >
                <TreeStructure className="mr-1.5" weight="duotone" size={16} />
                Evolution Path
              </Button>
            )}
            {onListMarketplace && agent.ownershipStatus === 'original-creator' && (
              <Button
                onClick={(e) => {
                  e.stopPropagation()
                  startTransition(() => onListMarketplace(agent))
                }}
                variant="outline"
                size="sm"
                className="w-full border-accent/30 hover:bg-accent/10 hover:border-accent/50 transition-all text-accent"
              >
                <ShoppingCart className="mr-1.5" weight="duotone" size={16} />
                List on Marketplace
              </Button>
            )}
            <div className="grid grid-cols-2 gap-2">
              {onChat && (
                <Button
                  onClick={(e) => {
                    e.stopPropagation()
                    startTransition(() => onChat(agent))
                  }}
                  variant="outline"
                  size="sm"
                  className="border-accent/30 hover:bg-accent/10 hover:border-accent/50 transition-all"
                >
                  <ChatCircle className="mr-1.5" weight="duotone" size={16} />
                  Chat
                </Button>
              )}
              {onConfigure && (
                <Button
                  onClick={(e) => {
                    e.stopPropagation()
                    startTransition(() => onConfigure(agent))
                  }}
                  variant="outline"
                  size="sm"
                  className="border-primary/30 hover:bg-primary/10 hover:border-primary/50 transition-all"
                >
                  <GearSix className="mr-1.5" weight="duotone" size={16} />
                  Config
                </Button>
              )}
            </div>

            {onDeleteAgent && (
              confirmDelete ? (
                <div className="flex gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/30">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <Warning size={13} className="text-destructive flex-shrink-0" weight="fill" />
                    <span className="text-[10px] text-destructive font-semibold">Remove from dashboard?</span>
                  </div>
                  <Button
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); onDeleteAgent(agent) }}
                    className="h-6 px-2 text-[10px] bg-destructive hover:bg-destructive/80 text-white font-bold flex-shrink-0"
                  >
                    Delete
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(false) }}
                    className="h-6 px-2 text-[10px] flex-shrink-0"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(true) }}
                  variant="ghost"
                  size="sm"
                  className="w-full h-7 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-all text-[10px]"
                >
                  <Trash size={12} className="mr-1" weight="duotone" />
                  Remove Agent
                </Button>
              )
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  )
}
