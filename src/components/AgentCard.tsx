import { startTransition, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { Agent } from '@/lib/types'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ArrowRight, ChatCircle, Check, Copy, Crown, DotsThreeVertical, Dna, GearSix, Lightbulb, Lightning, MagnifyingGlass,
  ShoppingCart, Sparkle, Trash, TreeStructure, Warning, Wallet,
} from '@phosphor-icons/react'
import { cn, calculateRarityTier, getRarityStyles, getRarityLabel, isAgentAutoScouting, WISDOM_UNLOCK_THRESHOLD } from '@/lib/utils'
import { ChainBadge } from './ChainBadge'
import { DEFAULT_CHAIN_ID, autoReplenish, getChain, supportsMarketplace } from '@/lib/blockchain/chains'
import { NicheAvatar } from './NicheAvatar'
import { useGasStatus } from '@/hooks/useGasStatus'
import { monitoringService } from '@/services/monitoringService'

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

const STATUS = {
  idle: { dot: 'bg-slate-400', label: 'Idle' },
  active: { dot: 'bg-emerald-400', label: 'Active' },
  processing: { dot: 'bg-amber-400 animate-pulse', label: 'Working' },
  error: { dot: 'bg-rose-500', label: 'Needs attention' },
} as const

type Tone = 'warn' | 'danger' | 'ok' | 'info' | 'muted'
const TONES: Record<Tone, string> = {
  warn: 'border-amber-500/35 bg-amber-500/10 text-amber-300',
  danger: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  ok: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300',
  info: 'border-primary/30 bg-primary/10 text-primary',
  muted: 'border-border/60 bg-white/[0.03] text-muted-foreground',
}

function Chip({ tone, icon, children, onClick }: { tone: Tone; icon?: ReactNode; children: ReactNode; onClick?: () => void }) {
  const className = cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold', TONES[tone])
  if (!onClick) return <span className={className}>{icon}{children}</span>
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick() }} className={cn(className, 'hover:brightness-125 transition')}>
      {icon}{children}
    </button>
  )
}

function Stat({ label, short, value, unit, tone }: { label: string; short?: string; value: ReactNode; unit?: string; tone?: 'warn' | 'danger' }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-2 min-w-0">
      <p className="text-[9.5px] uppercase tracking-wider text-muted-foreground font-semibold truncate" title={label}>
        {short ? <><span className="sm:hidden">{short}</span><span className="hidden sm:inline">{label}</span></> : label}
      </p>
      <p className={cn('mt-0.5 text-sm font-bold font-mono tabular-nums truncate',
        tone === 'danger' ? 'text-rose-300' : tone === 'warn' ? 'text-amber-300' : 'text-foreground')}>
        {value}{unit && <span className="ml-1 text-[10px] font-medium text-muted-foreground">{unit}</span>}
      </p>
    </div>
  )
}

/**
 * One agent in My Agents: who it is, what needs the owner, how far it has
 * grown, and the next step. Everything deeper lives in the agent workspace.
 */
export function AgentCard({ agent, videosAnalyzedActual, onClick, onConfigure, onChat, onViewEvolution, onTopUpGas, onListMarketplace, onToggleAutoReplenish, pendingProposalCount, onOpenProposals, onDeleteAgent, onRetrySpawn }: AgentCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [walletCopied, setWalletCopied] = useState(false)
  const videosAnalyzed = videosAnalyzedActual ?? agent.eventsAttended ?? 0

  const chainId = agent.chainId ?? DEFAULT_CHAIN_ID
  const currency = getChain(chainId)?.nativeSymbol ?? 'token'
  const walletBalance = agent.agentGasBalance ?? agent.nativeBalance ?? 0
  // Same source as the "Live status" badge (shared, cached poll), so the card
  // and the workspace agree on whether gas is low.
  const { gasStatus } = useGasStatus(agent.walletAddress, chainId)
  const gasIsLow = gasStatus ? monitoringService.isGasLow(gasStatus.status) : walletBalance < autoReplenish(chainId).threshold
  const gasEmpty = walletBalance === 0

  const rarityTier = calculateRarityTier(agent)
  const rarityStyles = getRarityStyles(rarityTier)
  const isSpecialRarity = rarityTier !== 'common'
  const status = STATUS[agent.status] ?? STATUS.idle
  const pending = agent.level >= 3 ? pendingProposalCount ?? 0 : 0
  const activating = agent.ownershipStatus === 'bred' && !agent.spawnedOnV4

  // One progress line: comprehension toward the next milestone mint when the
  // backend reports it, otherwise the wisdom unlock.
  const hasComprehension = agent.comprehensionScore !== undefined
  const progress = hasComprehension
    ? Math.min(100, agent.comprehensionScore ?? 0)
    : Math.min(100, (videosAnalyzed / WISDOM_UNLOCK_THRESHOLD) * 100)
  const progressLabel = hasComprehension
    ? agent.comprehensionNextMilestone != null ? `${agent.comprehensionProgressToNext} pts to next mint` : `${agent.comprehensionScore}/100`
    : agent.wisdomUnlocked ? 'Wisdom unlocked' : `${videosAnalyzed}/${WISDOM_UNLOCK_THRESHOLD} videos`

  const open = () => onClick?.()
  const run = (fn: () => void) => (e: MouseEvent) => { e.stopPropagation(); startTransition(fn) }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open() }
  }
  const copyWallet = async (e: MouseEvent) => {
    e.stopPropagation()
    await navigator.clipboard.writeText(agent.walletAddress)
    setWalletCopied(true)
    setTimeout(() => setWalletCopied(false), 1500)
  }

  const canSell = onListMarketplace && agent.ownershipStatus === 'original-creator' && supportsMarketplace(chainId)
  const hasMenu = (onOpenProposals && agent.level >= 3) || onViewEvolution || canSell || onTopUpGas || onToggleAutoReplenish || onDeleteAgent

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`Open ${agent.name}`}
      onClick={open}
      onKeyDown={onKeyDown}
      className={cn(
        'glass-card group relative h-full overflow-hidden p-0 gap-0 cursor-pointer border border-border/40',
        'transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
        isSpecialRarity && rarityStyles.borderClass,
      )}
    >
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-primary/[0.09] via-secondary/[0.04] to-transparent" />

      <div className="relative flex h-full flex-col gap-4 p-4 sm:p-5">
        {/* Identity */}
        <div className="flex items-start gap-3.5">
          <div className="relative shrink-0">
            <NicheAvatar agent={agent} size="lg" showRing={false} className="ring-1 ring-white/10 shadow-lg shadow-black/40 transition-transform duration-300 group-hover:scale-[1.04]" />
            <span title={status.label} className={cn('absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full ring-2 ring-[#0B1124]', status.dot)} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="font-bold text-base leading-tight truncate max-w-full">{agent.name}</h3>
              <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold font-mono text-primary">Lv {agent.level}</span>
              {isSpecialRarity && (
                <Badge className={cn('text-[10px] font-bold px-1.5 py-0 border-0', rarityStyles.badgeClass)}>{getRarityLabel(rarityTier)}</Badge>
              )}
              {agent.isGenesis && <Crown size={14} weight="fill" className="text-amber-400" aria-label="Genesis agent" />}
              {(agent.generation ?? 1) > 1 && (
                <span className="rounded-md border border-violet-500/30 px-1.5 py-0.5 text-[10px] font-mono text-violet-300">GEN-{agent.generation}</span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground truncate">{agent.niche} · {agent.personality}</p>
            <div className="mt-1.5 flex items-center gap-2 min-w-0">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" onClick={copyWallet} className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors">
                      {agent.walletAddress.slice(0, 6)}…{agent.walletAddress.slice(-4)}
                      {walletCopied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent><p className="font-mono text-xs">{walletCopied ? 'Copied' : 'Copy the agent wallet (for top-ups)'}</p></TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <ChainBadge chainId={chainId} />
            </div>
          </div>

          {hasMenu && (
            // Menu clicks bubble through the React tree (even from the portal), so stop them here.
            <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 -mr-1.5 -mt-1 text-muted-foreground hover:text-foreground" aria-label={`More actions for ${agent.name}`}>
                    <DotsThreeVertical size={18} weight="bold" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {onOpenProposals && agent.level >= 3 && (
                    <DropdownMenuItem onSelect={() => startTransition(() => onOpenProposals(agent))}>
                      <Lightbulb size={15} weight="duotone" className="text-amber-400" />Strategic consult
                      {pending > 0 && <span className="ml-auto rounded-full bg-amber-500/20 px-1.5 text-[10px] font-bold text-amber-300">{pending}</span>}
                    </DropdownMenuItem>
                  )}
                  {onViewEvolution && (
                    <DropdownMenuItem onSelect={() => startTransition(() => onViewEvolution(agent))}>
                      <TreeStructure size={15} weight="duotone" className="text-secondary" />Evolution path
                    </DropdownMenuItem>
                  )}
                  {canSell && (
                    <DropdownMenuItem onSelect={() => startTransition(() => onListMarketplace!(agent))}>
                      <ShoppingCart size={15} weight="duotone" className="text-accent" />Sell / transfer
                    </DropdownMenuItem>
                  )}
                  {onTopUpGas && (
                    <DropdownMenuItem onSelect={() => onTopUpGas(agent)}>
                      <Wallet size={15} weight="duotone" />Top up gas
                    </DropdownMenuItem>
                  )}
                  {onToggleAutoReplenish && (
                    <DropdownMenuCheckboxItem
                      checked={agent.autoReplenishGas || false}
                      onCheckedChange={(checked) => onToggleAutoReplenish(agent, checked === true)}
                    >
                      Auto-replenish gas
                    </DropdownMenuCheckboxItem>
                  )}
                  {onDeleteAgent && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-rose-300 focus:text-rose-200 focus:bg-rose-500/10">
                        <Trash size={15} weight="duotone" />Remove agent
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {/* What needs the owner, or what is going well. */}
        <div className="flex flex-wrap gap-1.5 min-h-[22px]">
          {gasIsLow && (
            <Chip tone={gasEmpty ? 'danger' : 'warn'} icon={<Warning size={11} weight="fill" />} onClick={onTopUpGas ? () => onTopUpGas(agent) : undefined}>
              {gasEmpty ? 'Needs gas' : 'Low gas'}{onTopUpGas && ' · Top up'}
            </Chip>
          )}
          {pending > 0 && onOpenProposals && (
            <Chip tone="warn" icon={<Lightbulb size={11} weight="fill" />} onClick={() => startTransition(() => onOpenProposals(agent))}>
              {pending} proposal{pending === 1 ? '' : 's'} to review
            </Chip>
          )}
          {activating && (
            <Chip tone="warn" icon={<GearSix size={11} weight="duotone" />} onClick={onRetrySpawn ? () => onRetrySpawn(agent) : undefined}>
              Activating on-chain{onRetrySpawn && ' · Retry'}
            </Chip>
          )}
          {isAgentAutoScouting(agent) && <Chip tone="ok" icon={<MagnifyingGlass size={11} weight="bold" />}>Auto-Scout on</Chip>}
          {agent.autoReplenishGas && <Chip tone="info" icon={<Lightning size={11} weight="fill" />}>Self-funding</Chip>}
          {agent.wisdomUnlocked && <Chip tone="warn" icon={<Sparkle size={11} weight="fill" />}>Wisdom unlocked</Chip>}
          {agent.ownershipStatus === 'bred' && !activating && <Chip tone="muted" icon={<Dna size={11} weight="duotone" />}>Fusion</Chip>}
          {agent.ownershipStatus === 'marketplace-acquired' && <Chip tone="muted" icon={<ShoppingCart size={11} weight="duotone" />}>Acquired</Chip>}
        </div>

        {/* Numbers */}
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Videos" value={videosAnalyzed} />
          <Stat label="Comprehension" short="Compr." value={hasComprehension ? agent.comprehensionScore : '—'} unit={hasComprehension ? '/100' : undefined} />
          <Stat label="Wallet" value={walletBalance.toFixed(3)} unit={currency} tone={gasIsLow ? (gasEmpty ? 'danger' : 'warn') : undefined} />
        </div>

        {/* Growth */}
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">{hasComprehension ? 'Toward next milestone NFT' : 'Wisdom progress'}</span>
            <span className="font-mono text-foreground/80">{progressLabel}</span>
          </div>
          <div className="relative h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className={cn('h-full rounded-full transition-[width] duration-700',
                agent.wisdomUnlocked && !hasComprehension ? 'bg-gradient-to-r from-amber-400 to-orange-500' : 'bg-gradient-to-r from-primary via-accent to-secondary')}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Next step */}
        {confirmDelete ? (
          <div className="mt-auto flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5" onClick={(e) => e.stopPropagation()}>
            <Warning size={14} weight="fill" className="shrink-0 text-rose-400" />
            <span className="flex-1 text-[11px] font-semibold text-rose-200">Remove {agent.name} from your agents?</span>
            <Button size="sm" onClick={run(() => onDeleteAgent?.(agent))} className="h-7 px-2.5 text-[11px] bg-rose-500 hover:bg-rose-500/85 text-white font-bold">Remove</Button>
            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setConfirmDelete(false) }} className="h-7 px-2 text-[11px]">Cancel</Button>
          </div>
        ) : (
          <div className="mt-auto flex items-center gap-2">
            <Button size="sm" onClick={run(open)} className="flex-1 bg-gradient-to-r from-primary to-secondary text-white font-semibold shadow-md shadow-primary/20 hover:opacity-95">
              Open workspace<ArrowRight size={14} weight="bold" className="ml-1.5 transition-transform group-hover:translate-x-0.5" />
            </Button>
            {onChat && (
              <Button size="icon" variant="outline" onClick={run(() => onChat(agent))} aria-label={`Chat with ${agent.name}`} title="Chat" className="h-8 w-8 border-border/50 hover:border-accent/50 hover:text-accent">
                <ChatCircle size={16} weight="duotone" />
              </Button>
            )}
            {onConfigure && (
              <Button size="icon" variant="outline" onClick={run(() => onConfigure(agent))} aria-label={`Configure ${agent.name}`} title="Configure & avatar" className="h-8 w-8 border-border/50 hover:border-primary/50 hover:text-primary">
                <GearSix size={16} weight="duotone" />
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
