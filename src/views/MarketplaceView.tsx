import { useState } from 'react'
import { motion } from 'framer-motion'
import { Storefront, LockKey } from '@phosphor-icons/react'
import { Card } from '@/components/ui/card'
import { MarketplaceAgentCard } from '@/components/MarketplaceAgentCard'
import { MarketplaceFilters } from '@/components/MarketplaceFilters'
import { MarketplaceAgent, Niche, RarityTier } from '@/lib/types'

interface MarketplaceFiltersState {
  generation: number[]
  niche: Niche[]
  rarityTier: RarityTier[]
  sortBy: 'price-asc' | 'price-desc' | 'level-desc' | 'generation-desc' | 'wisdom-desc' | 'rarity-desc'
}

interface MarketplaceViewProps {
  marketplaceAgents: MarketplaceAgent[]
}

export function MarketplaceView({ marketplaceAgents }: MarketplaceViewProps) {
  const [marketplaceFilters, setMarketplaceFilters] = useState<MarketplaceFiltersState>({
    generation: [],
    niche: [],
    rarityTier: [],
    sortBy: 'level-desc',
  })

  const filteredAndSortedMarketplace = () => {
    let filtered = [...(marketplaceAgents ?? [])]

    if (marketplaceFilters.generation.length > 0) {
      filtered = filtered.filter(a => marketplaceFilters.generation.includes(a.generation ?? 1))
    }

    if (marketplaceFilters.niche.length > 0) {
      filtered = filtered.filter(a => marketplaceFilters.niche.includes(a.niche))
    }

    filtered.sort((a, b) => {
      switch (marketplaceFilters.sortBy) {
        case 'price-asc':
          return a.price - b.price
        case 'price-desc':
          return b.price - a.price
        case 'level-desc':
          return b.level - a.level
        case 'wisdom-desc':
          return b.eventsAttended - a.eventsAttended
        case 'generation-desc':
          return (b.generation ?? 1) - (a.generation ?? 1)
        default:
          return 0
      }
    })

    return filtered
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6 animate-slide-up"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-secondary/20 border border-secondary/40 flex items-center justify-center">
            <Storefront className="text-secondary" weight="duotone" size={22} />
          </div>
          <div>
            <h2 className="text-xl font-bold">Agent Marketplace</h2>
            <p className="text-sm text-muted-foreground">Acquire autonomous agents — transfer ownership, wisdom carries forward</p>
          </div>
        </div>
        <div className="text-sm text-muted-foreground font-mono">
          {marketplaceAgents?.length ?? 0} listed · BNB &amp; ETH Sepolia
        </div>
      </div>

      <MarketplaceFilters
        filters={marketplaceFilters}
        onFiltersChange={setMarketplaceFilters}
        totalAgents={marketplaceAgents?.length ?? 0}
      />

      {/* Honest Fase 1 banner — direct transfer works on testnet; escrow is next. */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="flex items-start gap-3 px-4 py-3 rounded-xl border border-primary/30 bg-gradient-to-r from-primary/10 via-accent/5 to-secondary/10"
      >
        <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center flex-shrink-0">
          <LockKey size={16} weight="duotone" className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-foreground">Direct ownership transfer — live on testnet</p>
          <p className="text-xs text-muted-foreground/80 leading-snug mt-0.5">
            Owners list an agent here and transfer it on-chain to a buyer; everything the agent
            learned carries forward. Arrange payment with the seller directly — the platform does
            not hold funds yet. Escrowed, trustless payment is the next phase.
          </p>
        </div>
      </motion.div>

      {!marketplaceAgents || marketplaceAgents.length === 0 ? (
        <Card className="glass-card-hover p-12 text-center border-2 border-dashed border-secondary/30">
          <Storefront size={64} className="mx-auto mb-4 text-muted-foreground animate-float" weight="duotone" />
          <h3 className="text-base font-bold mb-2">No Agents Available</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Check back later for agents listed by other users.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredAndSortedMarketplace().map((agent) => (
            <MarketplaceAgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </motion.div>
  )
}
