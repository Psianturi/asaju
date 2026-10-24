import { useState } from 'react'
import { motion } from 'framer-motion'
import { Storefront, LockKey, Tag } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { MarketplaceAgentCard } from '@/components/MarketplaceAgentCard'
import { MarketplaceFilters } from '@/components/MarketplaceFilters'
import { MarketplaceAgent, Niche, RarityTier } from '@/lib/types'
import { calculateRarityTier } from '@/lib/utils'

// Higher index = rarer; used to sort by rarity.
const RARITY_ORDER: RarityTier[] = ['common', 'rare', 'epic', 'legendary', 'mythic']

interface MarketplaceFiltersState {
  generation: number[]
  niche: Niche[]
  rarityTier: RarityTier[]
  sortBy: 'price-asc' | 'price-desc' | 'level-desc' | 'generation-desc' | 'wisdom-desc' | 'rarity-desc'
}

const DEFAULT_FILTERS: MarketplaceFiltersState = {
  generation: [],
  niche: [],
  rarityTier: [],
  sortBy: 'level-desc',
}

interface MarketplaceViewProps {
  marketplaceAgents: MarketplaceAgent[]
  /** Refresh the board, e.g. after a purchase settles. */
  onListingsChanged?: () => void
  /** Take the owner to where their agents can be listed. */
  onSellAgent?: () => void
}

export function MarketplaceView({ marketplaceAgents, onListingsChanged, onSellAgent }: MarketplaceViewProps) {
  const [marketplaceFilters, setMarketplaceFilters] = useState<MarketplaceFiltersState>(DEFAULT_FILTERS)

  const filteredAndSortedMarketplace = () => {
    let filtered = [...(marketplaceAgents ?? [])]

    if (marketplaceFilters.generation.length > 0) {
      filtered = filtered.filter(a => marketplaceFilters.generation.includes(a.generation ?? 1))
    }

    if (marketplaceFilters.niche.length > 0) {
      filtered = filtered.filter(a => marketplaceFilters.niche.includes(a.niche))
    }

    // The rarity checkboxes and sort existed in the UI but were never applied.
    if (marketplaceFilters.rarityTier.length > 0) {
      filtered = filtered.filter(a => marketplaceFilters.rarityTier.includes(calculateRarityTier(a)))
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
        case 'rarity-desc':
          return RARITY_ORDER.indexOf(calculateRarityTier(b)) - RARITY_ORDER.indexOf(calculateRarityTier(a))
        default:
          return 0
      }
    })

    return filtered
  }

  const listedCount = marketplaceAgents?.length ?? 0
  const visibleAgents = filteredAndSortedMarketplace()

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6 animate-slide-up"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-secondary/20 border border-secondary/40 flex items-center justify-center">
            <Storefront className="text-secondary" weight="duotone" size={22} />
          </div>
          <div>
            <h2 className="text-xl font-bold">Agent Marketplace</h2>
            <p className="text-sm text-muted-foreground">Buy an agent and everything it has learned moves with it</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground font-mono">
            {listedCount} listed · BNB, ETH Sepolia &amp; Robinhood
          </span>
          {onSellAgent && (
            <Button size="sm" variant="outline" onClick={onSellAgent} className="border-secondary/40 hover:bg-secondary/10">
              <Tag size={14} className="mr-1.5" weight="duotone" />
              Sell an agent
            </Button>
          )}
        </div>
      </div>

      {/* Filters only earn their space once there is something to filter. */}
      {listedCount > 0 && (
        <MarketplaceFilters
          filters={marketplaceFilters}
          onFiltersChange={setMarketplaceFilters}
          totalAgents={listedCount}
        />
      )}

      {/* Escrow is live: the banner says what a buyer can rely on, testnet included. */}
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
          <p className="text-sm font-bold text-foreground">Escrow marketplace — live on testnet</p>
          <p className="text-xs text-muted-foreground/80 leading-snug mt-0.5">
            Listings live in an on-chain escrow. Paying and taking ownership happen in one
            transaction, so neither side has to trust the other; everything the agent learned
            carries forward. Testnet funds only.
          </p>
        </div>
      </motion.div>

      {listedCount === 0 ? (
        <Card className="glass-card-hover p-12 text-center border-2 border-dashed border-secondary/30">
          <Storefront size={56} className="mx-auto mb-4 text-muted-foreground" weight="duotone" />
          <h3 className="text-base font-bold mb-2">No agents listed yet</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Be the first: list one of your agents on BNB Testnet, Ethereum Sepolia or Robinhood Chain.
            Agents on Mantle Sepolia can't be sold yet.
          </p>
          {onSellAgent && (
            <Button onClick={onSellAgent} className="mt-5 self-center w-fit mx-auto bg-gradient-to-r from-primary to-accent hover:opacity-90">
              <Tag size={16} className="mr-2" weight="duotone" />
              Sell one of your agents
            </Button>
          )}
        </Card>
      ) : visibleAgents.length === 0 ? (
        <Card className="p-10 text-center border border-dashed border-border/40">
          <h3 className="text-sm font-bold mb-1">No agents match these filters</h3>
          <p className="text-xs text-muted-foreground mb-4">{listedCount} listed in total.</p>
          <Button size="sm" variant="outline" className="self-center w-fit mx-auto" onClick={() => setMarketplaceFilters(DEFAULT_FILTERS)}>
            Clear filters
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {visibleAgents.map((agent) => (
            <MarketplaceAgentCard key={agent.id} agent={agent} onPurchased={onListingsChanged} />
          ))}
        </div>
      )}
    </motion.div>
  )
}
