import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Funnel, X } from '@phosphor-icons/react'
import { Niche, RarityTier } from '@/lib/types'
import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { getRarityLabel } from '@/lib/utils'

interface MarketplaceFiltersProps {
  filters: {
    generation: number[]
    niche: Niche[]
    rarityTier: RarityTier[]
    sortBy: 'price-asc' | 'price-desc' | 'level-desc' | 'generation-desc' | 'wisdom-desc' | 'rarity-desc'
  }
  onFiltersChange: (filters: {
    generation: number[]
    niche: Niche[]
    rarityTier: RarityTier[]
    sortBy: 'price-asc' | 'price-desc' | 'level-desc' | 'generation-desc' | 'wisdom-desc' | 'rarity-desc'
  }) => void
  totalAgents: number
  defaultOpen?: boolean
}

const niches: Niche[] = ['Blockchain/DeFi', 'Trading/Investment', 'Technology', 'Security']
const generations = [1, 2, 3, 4, 5]
const rarityTiers: RarityTier[] = ['common', 'rare', 'epic', 'legendary', 'mythic']

export function MarketplaceFilters({ filters, onFiltersChange, totalAgents, defaultOpen = false }: MarketplaceFiltersProps) {
  // Collapsed by default: the board, not the filter form, is what people came for.
  const [isOpen, setIsOpen] = useState(defaultOpen)

  const handleGenerationToggle = (gen: number) => {
    const newGenerations = filters.generation.includes(gen)
      ? filters.generation.filter(g => g !== gen)
      : [...filters.generation, gen]
    onFiltersChange({ ...filters, generation: newGenerations })
  }

  const handleNicheToggle = (niche: Niche) => {
    const newNiches = filters.niche.includes(niche)
      ? filters.niche.filter(n => n !== niche)
      : [...filters.niche, niche]
    onFiltersChange({ ...filters, niche: newNiches })
  }

  const handleRarityToggle = (rarity: RarityTier) => {
    const newRarities = filters.rarityTier.includes(rarity)
      ? filters.rarityTier.filter(r => r !== rarity)
      : [...filters.rarityTier, rarity]
    onFiltersChange({ ...filters, rarityTier: newRarities })
  }

  const handleClearFilters = () => {
    onFiltersChange({
      generation: [],
      niche: [],
      rarityTier: [],
      sortBy: 'level-desc'
    })
  }

  const activeFilterCount = filters.generation.length + filters.niche.length + filters.rarityTier.length

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="glass-card-hover p-4 border border-secondary/30 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-secondary/5 via-transparent to-accent/5" />
        
        <div className="relative z-10">
          <div className={`flex items-center justify-between ${isOpen ? 'mb-4' : ''}`}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-secondary/20 border border-secondary/40 flex items-center justify-center">
                <Funnel size={16} className="text-secondary" weight="duotone" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Filters &amp; sorting</h3>
                {activeFilterCount > 0 && (
                  <p className="text-xs text-muted-foreground">{activeFilterCount} active filter(s)</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {activeFilterCount > 0 && (
                <Button
                  onClick={handleClearFilters}
                  variant="ghost"
                  size="sm"
                  className="text-xs hover:bg-destructive/10 hover:text-destructive"
                >
                  <X size={14} className="mr-1" />
                  Clear All
                </Button>
              )}
              <Button
                onClick={() => setIsOpen(!isOpen)}
                variant="ghost"
                size="sm"
                className="text-xs"
              >
                {isOpen ? 'Collapse' : 'Expand'}
              </Button>
            </div>
          </div>

          <AnimatePresence>
            {isOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 pt-4 border-t border-border/50">
                  <div>
                    <Label className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <span>Rarity Tier</span>
                      {filters.rarityTier.length > 0 && (
                        <span className="text-xs text-accent bg-accent/20 px-2 py-0.5 rounded-full">
                          {filters.rarityTier.length}
                        </span>
                      )}
                    </Label>
                    <div className="space-y-2.5">
                      {rarityTiers.map((rarity) => (
                        <div key={rarity} className="flex items-center space-x-2">
                          <Checkbox
                            id={`rarity-${rarity}`}
                            checked={filters.rarityTier.includes(rarity)}
                            onCheckedChange={() => handleRarityToggle(rarity)}
                            className="border-accent/40 data-[state=checked]:bg-accent data-[state=checked]:border-accent"
                          />
                          <label
                            htmlFor={`rarity-${rarity}`}
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                          >
                            {getRarityLabel(rarity)}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <span>Generation</span>
                      {filters.generation.length > 0 && (
                        <span className="text-xs text-secondary bg-secondary/20 px-2 py-0.5 rounded-full">
                          {filters.generation.length}
                        </span>
                      )}
                    </Label>
                    <div className="space-y-2.5">
                      {generations.map((gen) => (
                        <div key={gen} className="flex items-center space-x-2">
                          <Checkbox
                            id={`gen-${gen}`}
                            checked={filters.generation.includes(gen)}
                            onCheckedChange={() => handleGenerationToggle(gen)}
                            className="border-secondary/40 data-[state=checked]:bg-secondary data-[state=checked]:border-secondary"
                          />
                          <label
                            htmlFor={`gen-${gen}`}
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex items-center gap-2"
                          >
                            Gen-{gen}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <span>Niche</span>
                      {filters.niche.length > 0 && (
                        <span className="text-xs text-secondary bg-secondary/20 px-2 py-0.5 rounded-full">
                          {filters.niche.length}
                        </span>
                      )}
                    </Label>
                    <div className="space-y-2.5">
                      {niches.map((niche) => (
                        <div key={niche} className="flex items-center space-x-2">
                          <Checkbox
                            id={`niche-${niche}`}
                            checked={filters.niche.includes(niche)}
                            onCheckedChange={() => handleNicheToggle(niche)}
                            className="border-secondary/40 data-[state=checked]:bg-secondary data-[state=checked]:border-secondary"
                          />
                          <label
                            htmlFor={`niche-${niche}`}
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                          >
                            {niche}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm font-semibold mb-3 block">Sort By</Label>
                    <Select
                      value={filters.sortBy}
                      onValueChange={(value: typeof filters.sortBy) =>
                        onFiltersChange({ ...filters, sortBy: value })
                      }
                    >
                      <SelectTrigger className="border-secondary/30 focus:border-secondary bg-background/50">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="rarity-desc">Highest Rarity</SelectItem>
                        <SelectItem value="level-desc">Highest Level</SelectItem>
                        <SelectItem value="wisdom-desc">Most Wisdom</SelectItem>
                        <SelectItem value="generation-desc">Highest Generation</SelectItem>
                        <SelectItem value="price-asc">Price: Low to High</SelectItem>
                        <SelectItem value="price-desc">Price: High to Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Card>
    </motion.div>
  )
}
