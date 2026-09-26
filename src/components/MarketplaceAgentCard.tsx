import { MarketplaceAgent } from '@/lib/types'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getChain } from '@/lib/blockchain/chains'
import {
  Robot, Brain, Fire, ShoppingCart, CheckCircle,
  Lightning, TrendUp, Star, Cpu,
} from '@phosphor-icons/react'
import { motion } from 'framer-motion'
import { cn, calculateRarityTier, getRarityStyles, getRarityLabel } from '@/lib/utils'

interface MarketplaceAgentCardProps {
  agent: MarketplaceAgent
}

const NICHE_ICON: Record<string, string> = {
  'Blockchain/DeFi': '⛓️',
  'Trading/Investment': '📈',
  'Technology': '💻',
  'Health/Wellness': '🧘',
}

const PERSONALITY_GRADIENT: Record<string, string> = {
  Aggressive: 'from-red-500/20 to-orange-500/20 border-red-500/40',
  Analytical: 'from-blue-500/20 to-cyan-500/20 border-blue-500/40',
  Creative: 'from-purple-500/20 to-pink-500/20 border-purple-500/40',
}

function ValueRow({
  icon,
  label,
  value,
  verified,
  highlight,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  verified?: boolean
  highlight?: boolean
}) {
  return (
    <div className={cn(
      'flex items-center justify-between py-1.5 px-2 rounded-md',
      highlight ? 'bg-primary/10' : 'bg-transparent',
    )}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
        {verified && (
          <CheckCircle size={10} className="text-emerald-400" weight="fill" />
        )}
      </div>
      <span className={cn(
        'text-xs font-semibold font-mono',
        highlight ? 'text-primary' : 'text-foreground',
      )}>
        {value}
      </span>
    </div>
  )
}

export function MarketplaceAgentCard({ agent }: MarketplaceAgentCardProps) {
  const rarityTier = calculateRarityTier(agent as any)
  const rarityStyles = getRarityStyles(rarityTier)
  const rarityLabel = getRarityLabel(rarityTier)
  const isSpecialRarity = rarityTier !== 'common'

  const walletBalance = agent.agentGasBalance ?? 0
  const heritageScore = agent.wisdomHeritageScore ?? 0
  const autoSigs = agent.autonomousSignatures ?? 0
  // Marketplace agent listings can be on Mantle, BNB, or ETH Sepolia — show the
  // agent's actual native currency, not MNT by default. Fall back to 5003
  // (Mantle) for legacy marketplace agents without chainId.
  const marketplaceCurrency = getChain(agent.chainId ?? 5003)?.nativeSymbol ?? 'token'

  return (
    <motion.div
      whileHover={{ scale: 1.02, y: -4 }}
      transition={{ duration: 0.2 }}
      className="relative"
    >
      {isSpecialRarity && (
        <div className={cn(
          'absolute inset-0 rounded-xl blur-lg -z-10',
          rarityStyles.bgClass,
          rarityStyles.glowClass,
        )} />
      )}

      <Card className={cn(
        'glass-card-hover p-5 border-2 relative overflow-hidden group',
        PERSONALITY_GRADIENT[agent.personality],
        isSpecialRarity && rarityStyles.borderClass,
      )}>
        {isSpecialRarity && (
          <div className={cn(
            'absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent to-transparent animate-shimmer',
            rarityStyles.bgClass,
          )} />
        )}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

        <div className="relative z-10 space-y-4">

          {/* ── Header ─────────────────────────────────────── */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary/30 to-secondary/30 border-2 border-primary/40 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                <Robot size={24} className="text-primary" weight="duotone" />
              </div>
              <div>
                <h3 className="font-bold text-base text-foreground group-hover:text-primary transition-colors leading-tight">
                  {agent.name}
                </h3>
                <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                  <span>{NICHE_ICON[agent.niche]}</span>
                  <span>{agent.niche}</span>
                  {agent.generation && agent.generation > 1 && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 ml-1 border-primary/30 text-primary/70">
                      GEN-{agent.generation}
                    </Badge>
                  )}
                </p>
              </div>
            </div>

            <div className="flex flex-col items-end gap-1">
              {isSpecialRarity ? (
                <motion.div
                  animate={{ rotate: [0, 8, -8, 0], scale: [1, 1.08, 1] }}
                  transition={{ duration: 2.5, repeat: Infinity }}
                  className={cn(
                    'px-2.5 py-1 rounded-full text-[10px] font-bold shadow-md flex items-center gap-1',
                    rarityStyles.badgeClass,
                  )}
                >
                  <Star size={9} weight="fill" />
                  {rarityLabel}
                </motion.div>
              ) : (
                <Badge variant="outline" className="text-[10px] px-2 py-0">Common</Badge>
              )}
              <Badge variant="outline" className="text-[10px] px-2 py-0 border-primary/30 text-primary/70 font-mono">
                {agent.personality}
              </Badge>
            </div>
          </div>

          {/* ── What You're Acquiring ───────────────────────── */}
          <div className="rounded-lg border border-border/40 bg-muted/20 overflow-hidden">
            <div className="px-2 py-1.5 border-b border-border/30 bg-muted/30">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                On-Chain Assets Included
              </p>
            </div>
            <div className="p-1.5 space-y-0.5">
              <ValueRow
                icon={<Fire size={11} className="text-orange-400" weight="fill" />}
                label="Wallet Balance"
                value={`${walletBalance.toFixed(3)} ${marketplaceCurrency}`}
                verified
                highlight
              />
              <ValueRow
                icon={<Cpu size={11} className="text-sky-400" weight="duotone" />}
                label="Gas Activity"
                value={`${(agent.gasSpent ?? 0).toFixed(3)} MNT spent`}
              />
            </div>
          </div>

          {/* ── Cognitive Track Record ──────────────────────── */}
          <div className="rounded-lg border border-border/40 bg-muted/20 overflow-hidden">
            <div className="px-2 py-1.5 border-b border-border/30 bg-muted/30">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Cognitive Track Record
              </p>
            </div>
            <div className="p-1.5 space-y-0.5">
              <ValueRow
                icon={<TrendUp size={11} className="text-emerald-400" weight="bold" />}
                label="Events × Level"
                value={`${agent.eventsAttended} events · Lvl ${agent.level}`}
              />
              {heritageScore > 0 && (
                <ValueRow
                  icon={<Star size={11} className="text-amber-400" weight="fill" />}
                  label="Heritage Score"
                  value={`${heritageScore} pts`}
                  highlight={heritageScore >= 50}
                />
              )}
              {autoSigs > 0 && (
                <ValueRow
                  icon={<Lightning size={11} className="text-violet-400" weight="fill" />}
                  label="Autonomous Executions"
                  value={`${autoSigs}×`}
                  highlight={autoSigs >= 5}
                />
              )}
              {agent.wisdomUnlocked && (
                <ValueRow
                  icon={<Brain size={11} className="text-amber-400" weight="fill" />}
                  label="Wisdom Memory"
                  value="Unlocked ✨"
                  highlight
                />
              )}
            </div>
          </div>

          {/* ── Price + Buy ─────────────────────────────────── */}
          <div className="pt-3 border-t border-border/50 space-y-3">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Listed Price</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold bg-gradient-to-r from-green-400 to-emerald-500 bg-clip-text text-transparent">
                    {agent.price.toFixed(1)}
                  </span>
                  <span className="text-sm font-semibold text-emerald-400">{marketplaceCurrency}</span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground">Wallet incl.</p>
                <p className="text-sm font-bold text-orange-400 font-mono">{walletBalance.toFixed(3)} {marketplaceCurrency}</p>
              </div>
            </div>

            {/* Marketplace is not yet on-chain (see "Coming Soon" banner above) —
                buying is disabled rather than completing a fake purchase. */}
            <Button
              disabled
              className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold opacity-50 cursor-not-allowed"
            >
              <ShoppingCart className="mr-2" weight="bold" size={18} />
              Coming Soon
            </Button>

            <p className="text-[10px] text-muted-foreground/50 text-center font-mono">
              Seller: {agent.seller} · Listed {Math.floor((Date.now() - agent.listedAt) / 86400000)}d ago
            </p>
          </div>

        </div>
      </Card>
    </motion.div>
  )
}
