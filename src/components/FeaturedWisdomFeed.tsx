import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Robot, Brain, Star, ArrowSquareOut, Fire, MagnifyingGlass, ThumbsUp, ThumbsDown } from '@phosphor-icons/react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { NicheAvatar } from './NicheAvatar'
import type { Niche } from '@/lib/types'

export interface WisdomFeedItem {
  eventId: string
  eventTitle: string
  wisdomSummary: string
  agentName: string
  agentId: string
  niche: string
  platform: string
  chainId: number
  attendedAt: number
  txHash?: string
  tokenId?: string
  wisdomQualityScore: number
  category: string
}

interface FeaturedWisdomFeedProps {
  items: WisdomFeedItem[]
  loading: boolean
  explorerBase?: string
  /** Called when the owner rates a card's wisdom. Owner-only UX — the backend enforces wallet ownership. */
  onRateWisdom?: (agentId: string, eventId: string, rating: 'up' | 'down') => void
  /** Currently-rated eventId per agentId, for visual state. */
  ratedMap?: Record<string, 'up' | 'down' | null>
  userWallet?: string
}

const CATEGORY_CONFIG: Record<string, { label: string; className: string }> = {
  trending: {
    label: 'Trending',
    className: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  },
  quality: {
    label: 'Top Quality',
    className: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  },
  wildcard: {
    label: 'Discovery',
    className: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  },
}

function QualityBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.round(score))
  const color =
    pct >= 70 ? 'from-emerald-500 to-green-400' :
    pct >= 40 ? 'from-amber-500 to-yellow-400' :
    'from-rose-500 to-red-400'

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full bg-gradient-to-r', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground font-mono w-8 text-right">{pct}</span>
    </div>
  )
}

function WisdomCard({ item, index, onRateWisdom, ratedMap, userWallet }: {
  item: WisdomFeedItem
  index: number
  onRateWisdom?: (agentId: string, eventId: string, rating: 'up' | 'down') => void
  ratedMap?: Record<string, 'up' | 'down' | null>
  userWallet?: string
}) {
  const cat = CATEGORY_CONFIG[item.category] ?? CATEGORY_CONFIG.quality
  const date = new Date(item.attendedAt * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
  const explorerUrl = item.txHash
    ? `https://explorer.sepolia.mantle.xyz/tx/${item.txHash}`
    : null
  const currentRating = ratedMap?.[item.eventId]
  const canRate = Boolean(onRateWisdom && userWallet)

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07 }}
    >
      <Card className="glass-card-hover border border-primary/20 p-5 h-full flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <NicheAvatar
              agent={{ id: item.agentId, name: item.agentName, niche: item.niche as Niche }}
              size="sm"
              className="shrink-0"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{item.agentName}</p>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 mt-0.5 border-primary/30 text-primary/70">
                {item.niche}
              </Badge>
            </div>
          </div>
          <Badge
            variant="outline"
            className={cn('text-[10px] px-2 py-0.5 flex-shrink-0 border', cat.className)}
          >
            {cat.label}
          </Badge>
        </div>

        {/* Event title */}
        <div>
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            <Brain size={11} weight="duotone" className="text-accent" />
            {item.platform} Event
          </p>
          <h4 className="text-sm font-bold line-clamp-2 leading-snug">{item.eventTitle}</h4>
        </div>

        {/* Wisdom summary */}
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4 flex-1">
          {item.wisdomSummary || 'No wisdom summary available.'}
        </p>

        {/* Footer */}
        <div className="space-y-2 pt-2 border-t border-white/5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <div className="flex items-center gap-1">
              <Star size={10} weight="duotone" className="text-amber-400" />
              Wisdom score
            </div>
            <span>{date}</span>
          </div>
          <QualityBar score={item.wisdomQualityScore} />
          {/* Feedback: owner-only rating of this wisdom. No auth gate needed —
              backend enforces ownership; buttons hidden for non-owners. */}
          {canRate && (
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-muted-foreground font-mono">Rate wisdom:</span>
              {(['up', 'down'] as const).map(r => (
                <button
                  key={r}
                  onClick={() => onRateWisdom!(item.agentId, item.eventId, r)}
                  className={cn(
                    'w-6 h-6 rounded-lg flex items-center justify-center border transition-all',
                    currentRating === r
                      ? r === 'up'
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                        : 'bg-rose-500/20 border-rose-500/50 text-rose-400'
                      : 'border-white/10 text-muted-foreground/50 hover:border-primary/40 hover:text-primary',
                  )}
                >
                  {r === 'up' ? <ThumbsUp size={12} weight="fill" /> : <ThumbsDown size={12} weight="fill" />}
                </button>
              ))}
            </div>
          )}
          {explorerUrl && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] text-primary/60 hover:text-primary transition-colors"
            >
              <ArrowSquareOut size={10} />
              View NFT on MantleScan
              {item.tokenId && <span className="font-mono">#{item.tokenId}</span>}
            </a>
          )}
        </div>
      </Card>
    </motion.div>
  )
}

function SkeletonCard() {
  return (
    <Card className="glass-card border border-primary/10 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Skeleton className="w-8 h-8 rounded-lg" />
        <div className="space-y-1.5 flex-1">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-2 w-16" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Skeleton className="h-2 w-20" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <div className="space-y-1.5">
        <Skeleton className="h-2.5 w-full" />
        <Skeleton className="h-2.5 w-full" />
        <Skeleton className="h-2.5 w-2/3" />
      </div>
      <div className="pt-2 border-t border-white/5 space-y-2">
        <Skeleton className="h-1 w-full rounded-full" />
      </div>
    </Card>
  )
}

export function FeaturedWisdomFeed({ items, loading, explorerBase, onRateWisdom, ratedMap, userWallet }: FeaturedWisdomFeedProps) {
  const stats = {
    trending: items.filter(i => i.category === 'trending').length,
    quality: items.filter(i => i.category === 'quality').length,
    wildcard: items.filter(i => i.category === 'wildcard').length,
  }

  return (
    <div className="space-y-6">
      {/* Stats row */}
      {!loading && items.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-3 flex-wrap"
        >
          {stats.trending > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-card border border-amber-500/20 text-xs">
              <Fire size={12} className="text-amber-400" weight="duotone" />
              <span className="text-amber-400 font-semibold">{stats.trending}</span>
              <span className="text-muted-foreground">trending</span>
            </div>
          )}
          {stats.quality > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-card border border-blue-500/20 text-xs">
              <Star size={12} className="text-blue-400" weight="duotone" />
              <span className="text-blue-400 font-semibold">{stats.quality}</span>
              <span className="text-muted-foreground">top quality</span>
            </div>
          )}
          {stats.wildcard > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-card border border-purple-500/20 text-xs">
              <MagnifyingGlass size={12} className="text-purple-400" weight="duotone" />
              <span className="text-purple-400 font-semibold">{stats.wildcard}</span>
              <span className="text-muted-foreground">discovery</span>
            </div>
          )}
        </motion.div>
      )}

      {/* Cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        <AnimatePresence mode="wait">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
          ) : items.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="col-span-full text-center py-16"
            >
              <Brain size={48} className="mx-auto mb-4 text-primary/30" weight="duotone" />
              <p className="text-muted-foreground font-semibold">No wisdom yet</p>
              <p className="text-sm text-muted-foreground/60 mt-1">
                Agents are still building their knowledge — check back soon.
              </p>
            </motion.div>
          ) : (
            items.map((item, i) => (
              <WisdomCard
                key={item.eventId}
                item={item}
                index={i}
                onRateWisdom={onRateWisdom}
                ratedMap={ratedMap}
                userWallet={userWallet}
              />
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
