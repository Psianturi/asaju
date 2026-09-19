import { useEffect, useState } from 'react'
import {
  TrendUp,
  TrendDown,
  Sparkle,
  Rocket,
  Gift,
  GlobeHemisphereEast,
  ArrowsClockwise,
  Fire,
  Star,
  WarningCircle,
  CaretDown,
} from '@phosphor-icons/react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { cloudRunService, Airdrop, GlobalMetrics, NewListing, TrendingCoin } from '@/services/cloudRunService'
import { fmtCompactUsd, fmtPct, fmtPrice, fmtPrize, fmtTimeAgo, isFiniteNum } from '@/lib/format'

/**
 * Defensive accessor for CMC quote field.
 * v1 endpoints return `{USD: {...}}` (object), v3 returns `[{...}]` (array).
 * Backend normalizer (commit b772135) converts v1 to array; this helper
 * handles the array form with one extra safety net for any direct cache reads
 * that pre-date the fix.
 */
function getQuote<T = any>(coin: { quote?: unknown }): T | undefined {
  const q = coin.quote
  if (Array.isArray(q) && q.length > 0) return q[0] as T
  if (q && typeof q === 'object') {
    const vals = Object.values(q as Record<string, unknown>)
    if (vals.length > 0) return vals[0] as T
  }
  return undefined
}

const REFRESH_MS = 5 * 60 * 1000

function PulseItem({ coin, index }: { coin: TrendingCoin; index: number }) {
  const quote = getQuote(coin)
  const hasPrice = isFiniteNum(quote?.price)
  const hasChange = isFiniteNum(quote?.percent_change_24h)
  if (!hasPrice && !hasChange) return null
  const change = hasChange ? (quote!.percent_change_24h as number) : null
  const up = change != null && change >= 0
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      className="group flex items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] px-3 py-2 transition-colors"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className={`w-6 h-6 shrink-0 rounded-md flex items-center justify-center text-[10px] font-bold font-mono ${up ? 'bg-emerald-400/15 text-emerald-300' : change != null ? 'bg-rose-400/15 text-rose-300' : 'bg-muted/30 text-muted-foreground'}`}>
          {index + 1}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-sm leading-none">{coin.symbol}</span>
            {coin.cmc_rank && (
              <span className="text-[9px] font-mono text-muted-foreground/60">#{coin.cmc_rank}</span>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground truncate block max-w-[140px]">{coin.name}</span>
        </div>
      </div>
      <div className="text-right shrink-0 font-mono tabular-nums">
        <p className="text-sm font-semibold">{fmtPrice(quote?.price)}</p>
        {change != null ? (
          <p className={`text-[10px] ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
            {up ? '▲' : '▼'} {Math.abs(change).toFixed(1)}%
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground/50">—</p>
        )}
      </div>
    </motion.div>
  )
}

function NewListingItem({ coin, index }: { coin: NewListing; index: number }) {
  const addedDate = coin.date_added
    ? new Date(coin.date_added).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : ''
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.04 }}
      className="flex items-center gap-2 rounded-md border border-violet-400/15 bg-violet-400/[0.04] px-2.5 py-1 whitespace-nowrap shrink-0"
    >
      <Rocket size={11} className="text-violet-300" weight="duotone" />
      <span className="text-xs font-semibold">{coin.symbol}</span>
      <span className="text-[10px] text-muted-foreground tabular-nums">{addedDate}</span>
    </motion.div>
  )
}

function AirdropItem({ airdrop, index }: { airdrop: Airdrop; index: number }) {
  const symbol = airdrop.coin?.symbol ?? airdrop.name?.split(' ')[0] ?? '?'
  const daysLeft = airdrop.end_date
    ? Math.max(0, Math.ceil((new Date(airdrop.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="flex items-center justify-between gap-3 rounded-lg border border-amber-400/15 bg-gradient-to-r from-amber-400/[0.06] to-transparent px-2.5 py-2"
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-6 h-6 rounded-md bg-amber-400/15 border border-amber-400/30 flex items-center justify-center shrink-0">
          <Gift size={12} className="text-amber-300" weight="duotone" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold truncate leading-tight">{symbol} Airdrop</p>
          <p className="text-[10px] text-muted-foreground tabular-nums">
            {airdrop.total_prize != null && isFiniteNum(airdrop.total_prize)
              ? `Prize ${fmtPrize(airdrop.total_prize, airdrop.prize_currency ?? '')}`
              : 'Tap to learn more'}
          </p>
        </div>
      </div>
      {daysLeft != null && daysLeft > 0 && (
        <span className="text-[10px] font-mono font-semibold text-amber-300 shrink-0 tabular-nums">
          {daysLeft}d left
        </span>
      )}
    </motion.div>
  )
}

export function MarketIntelligencePanel() {
  const [gainers, setGainers] = useState<TrendingCoin[]>([])
  const [newListings, setNewListings] = useState<NewListing[]>([])
  const [airdrops, setAirdrops] = useState<Airdrop[]>([])
  const [globalMetrics, setGlobalMetrics] = useState<GlobalMetrics | null>(null)
  const [failedSources, setFailedSources] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showAirdrops, setShowAirdrops] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [showAllMovers, setShowAllMovers] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const settled = await Promise.allSettled([
          cloudRunService.getTrendingGainersLosers('24h', 5),
          cloudRunService.getNewListings(8),
          cloudRunService.getAirdrops(4),
          cloudRunService.getGlobalMetrics(),
        ])
        if (cancelled) return
        const [gl, gl2, gl3, gl4] = settled
        let failures = 0
        settled.forEach((r, i) => {
          if (r.status === 'rejected') {
            failures += 1
            console.warn(`[MarketPulse] source ${i} failed:`, r.reason)
          }
        })
        setFailedSources(failures)
        setGainers(gl.status === 'fulfilled' ? gl.value.results ?? [] : [])
        setNewListings(gl2.status === 'fulfilled' ? gl2.value.results ?? [] : [])
        setAirdrops(gl3.status === 'fulfilled' ? gl3.value.results ?? [] : [])
        setGlobalMetrics(gl4.status === 'fulfilled' ? gl4.value.metrics ?? null : null)
        setLastUpdated(Date.now())
      } catch (err) {
        if (!cancelled) setFailedSources(4)
        console.error('Market intelligence fetch failed:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const interval = setInterval(load, REFRESH_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  const totalMcapChange = isFiniteNum(globalMetrics?.total_market_cap_yesterday_percentage_change)
    ? (globalMetrics!.total_market_cap_yesterday_percentage_change as number)
    : null
  const visibleGainers = showAllMovers ? gainers : gainers.slice(0, 3)
  const partial = failedSources > 0 && failedSources < 4
  const down = failedSources >= 4

  return (
    <Card className="relative overflow-hidden border-cyan-400/30 bg-slate-950/60 backdrop-blur-md shadow-2xl shadow-black/40">
      <div className="h-[3px] bg-gradient-to-r from-cyan-400 via-violet-400 to-emerald-400" />

      <div className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <Sparkle size={15} className="text-amber-300" weight="fill" />
              <span className="text-sm font-bold">Live market pulse</span>
              <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-mono border ${
                down
                  ? 'bg-red-400/10 border-red-400/30 text-red-300'
                  : partial
                    ? 'bg-amber-400/10 border-amber-400/30 text-amber-300'
                    : 'bg-emerald-400/15 border-emerald-400/30 text-emerald-300'
              }`}>
                <span className={`w-1 h-1 rounded-full ${down ? 'bg-red-400' : partial ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'}`} />
                {down ? 'OFFLINE' : partial ? 'PARTIAL' : 'LIVE'}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              What the agent watches right now.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {globalMetrics?.total_market_cap != null && (
              <div className="text-right">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground font-mono">Total mcap</p>
                <div className="flex items-center gap-1.5">
                  <GlobeHemisphereEast size={12} className="text-cyan-300" weight="duotone" />
                  <span className="text-sm font-bold font-mono tabular-nums">{fmtCompactUsd(globalMetrics.total_market_cap)}</span>
                  {totalMcapChange != null && (
                    <span className={`text-[10px] font-mono tabular-nums ${totalMcapChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {fmtPct(totalMcapChange, 2)}
                    </span>
                  )}
                </div>
              </div>
            )}
            {lastUpdated && (
              <p className="text-[9px] font-mono text-muted-foreground/60 tabular-nums">
                Updated {fmtTimeAgo(lastUpdated)}
              </p>
            )}
          </div>
        </div>

        {partial && !down && (
          <div className="flex items-center gap-1.5 mb-3 rounded-md border border-amber-400/20 bg-amber-400/[0.06] px-2 py-1">
            <WarningCircle size={11} className="text-amber-300" weight="fill" />
            <p className="text-[10px] text-amber-200/90">Some live data unavailable — showing cached values.</p>
          </div>
        )}

        {down ? (
          <div className="rounded-lg border border-red-400/20 bg-red-400/[0.05] p-3 text-center">
            <p className="text-xs text-red-200/80">Live market data temporarily unavailable.</p>
          </div>
        ) : loading ? (
          <div className="space-y-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-9 rounded-lg bg-white/[0.04] animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {gainers.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <Fire size={12} className="text-orange-300" weight="duotone" />
                    <p className="text-[10px] uppercase tracking-wider font-mono text-orange-200/80">
                      Top movers · 24h
                    </p>
                  </div>
                  {gainers.length > 3 && (
                    <button
                      onClick={() => setShowAllMovers(v => !v)}
                      className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                    >
                      {showAllMovers ? 'Show less' : `Show ${gainers.length - 3} more`}
                      <CaretDown size={10} className={`transition-transform ${showAllMovers ? 'rotate-180' : ''}`} />
                    </button>
                  )}
                </div>
                <div className="space-y-1">
                  {visibleGainers.map((coin, i) => (
                    <PulseItem key={coin.id ?? i} coin={coin} index={i} />
                  ))}
                </div>
              </div>
            )}

            {newListings.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Rocket size={12} className="text-violet-300" weight="duotone" />
                  <p className="text-[10px] uppercase tracking-wider font-mono text-violet-200/80">
                    Just listed
                  </p>
                </div>
                <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
                  {newListings.map((coin, i) => (
                    <NewListingItem key={coin.id ?? i} coin={coin} index={i} />
                  ))}
                </div>
              </div>
            )}

            {airdrops.length > 0 && (
              <div>
                <button
                  onClick={() => setShowAirdrops(v => !v)}
                  className="w-full flex items-center justify-between mb-1.5 group"
                >
                  <div className="flex items-center gap-1.5">
                    <Star size={12} className="text-amber-300" weight="duotone" />
                    <p className="text-[10px] uppercase tracking-wider font-mono text-amber-200/80">
                      Airdrop watch · {airdrops.length} active
                    </p>
                  </div>
                  <CaretDown size={11} className={`text-muted-foreground group-hover:text-foreground transition-transform ${showAirdrops ? 'rotate-180' : ''}`} />
                </button>
                <AnimatePresence>
                  {showAirdrops && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.25 }}
                      className="space-y-1"
                    >
                      {airdrops.map((airdrop, i) => (
                        <AirdropItem key={airdrop.id ?? i} airdrop={airdrop} index={i} />
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {gainers.length === 0 && newListings.length === 0 && airdrops.length === 0 && (
              <div className="text-center py-5 text-xs text-muted-foreground/60">
                <ArrowsClockwise size={18} className="mx-auto mb-1.5 animate-spin text-muted-foreground/40" />
                <p>Streaming live data from CoinMarketCap...</p>
              </div>
            )}
          </div>
        )}

        <p className="text-[9px] text-muted-foreground/60 mt-3 pt-2.5 border-t border-border/20 flex items-center gap-1.5">
          <span className="w-1 h-1 rounded-full bg-cyan-400" />
          CoinMarketCap (listings, sentiment) + CoinGecko (price, DEX) · refreshes every 5 min.
        </p>
      </div>
    </Card>
  )
}
