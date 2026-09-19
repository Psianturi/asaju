import { useEffect, useState } from 'react'
import {
  ChartLine,
  TrendUp,
  TrendDown,
  Sparkle,
  Rocket,
  Gift,
  GlobeHemisphereEast,
  ArrowsClockwise,
  Fire,
  Star,
} from '@phosphor-icons/react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { cloudRunService, Airdrop, GlobalMetrics, NewListing, TrendingCoin } from '@/services/cloudRunService'

const REFRESH_MS = 5 * 60 * 1000

function formatPrice(usd: number | undefined): string {
  if (usd == null) return '—'
  if (usd >= 1) return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  return `$${usd.toFixed(4)}`
}

function formatBigNumber(n: number | undefined): string {
  if (n == null) return '—'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  return `$${n.toLocaleString()}`
}

interface PulseItemProps {
  coin: TrendingCoin
  index: number
}

function PulseItem({ coin, index }: PulseItemProps) {
  const quote = coin.quote?.[0]
  const change = quote?.percent_change_24h ?? 0
  const up = change >= 0
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.4 }}
      className="group flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-gradient-to-r from-white/[0.05] to-transparent p-3 hover:border-cyan-400/30 transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-[10px] font-bold ${up ? 'bg-emerald-400/15 text-emerald-300' : 'bg-rose-400/15 text-rose-300'}`}>
          {index + 1}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-sm truncate">{coin.symbol}</span>
            {coin.cmc_rank && (
              <span className="text-[9px] font-mono text-muted-foreground/60">#{coin.cmc_rank}</span>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground truncate block max-w-[140px]">{coin.name}</span>
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-bold font-mono">{formatPrice(quote?.price)}</p>
        <p className={`text-[10px] font-mono ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
          {up ? '▲' : '▼'} {Math.abs(change).toFixed(1)}%
        </p>
      </div>
    </motion.div>
  )
}

interface NewListingItemProps {
  coin: NewListing
  index: number
}

function NewListingItem({ coin, index }: NewListingItemProps) {
  const addedDate = coin.date_added ? new Date(coin.date_added).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.05 }}
      className="flex items-center gap-2 rounded-lg border border-violet-400/15 bg-violet-400/[0.04] px-2.5 py-1.5 whitespace-nowrap shrink-0"
    >
      <Rocket size={11} className="text-violet-300" weight="duotone" />
      <span className="text-xs font-bold">{coin.symbol}</span>
      <span className="text-[10px] text-muted-foreground">{addedDate}</span>
    </motion.div>
  )
}

interface AirdropItemProps {
  airdrop: Airdrop
  index: number
}

function AirdropItem({ airdrop, index }: AirdropItemProps) {
  const symbol = airdrop.coin?.symbol ?? airdrop.name?.split(' ')[0] ?? '?'
  const daysLeft = airdrop.end_date
    ? Math.max(0, Math.ceil((new Date(airdrop.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.07 }}
      className="flex items-center justify-between gap-3 rounded-xl border border-amber-400/15 bg-gradient-to-r from-amber-400/[0.06] to-transparent p-2.5"
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-7 h-7 rounded-lg bg-amber-400/15 border border-amber-400/30 flex items-center justify-center shrink-0">
          <Gift size={13} className="text-amber-300" weight="duotone" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold truncate">{symbol} Airdrop</p>
          {airdrop.total_prize ? (
            <p className="text-[10px] text-muted-foreground">
              Prize ${airdrop.total_prize.toLocaleString()}{airdrop.prize_currency ?? ''}
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground">Tap to learn more</p>
          )}
        </div>
      </div>
      {daysLeft != null && daysLeft > 0 && (
        <span className="text-[10px] font-mono font-bold text-amber-300 shrink-0">
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
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showAirdrops, setShowAirdrops] = useState(true)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const [gl, gl2, gl3, gl4] = await Promise.allSettled([
          cloudRunService.getTrendingGainersLosers('24h', 5),
          cloudRunService.getNewListings(8),
          cloudRunService.getAirdrops(4),
          cloudRunService.getGlobalMetrics(),
        ])
        if (cancelled) return
        setGainers(gl.status === 'fulfilled' ? gl.value.results ?? [] : [])
        setNewListings(gl2.status === 'fulfilled' ? gl2.value.results ?? [] : [])
        setAirdrops(gl3.status === 'fulfilled' ? gl3.value.results ?? [] : [])
        setGlobalMetrics(gl4.status === 'fulfilled' ? gl4.value.metrics ?? null : null)
        setError(false)
      } catch (err) {
        if (!cancelled) setError(true)
        console.error('Market intelligence fetch failed:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    const interval = setInterval(load, REFRESH_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  if (error) return null

  const totalMcapChange = globalMetrics?.total_market_cap_yesterday_percentage_change ?? 0
  const btcDom = globalMetrics?.btc_dominance ?? null

  return (
    <Card className="relative overflow-hidden border-cyan-400/25 bg-gradient-to-br from-cyan-400/[0.03] via-transparent to-violet-400/[0.03]">
      {/* Animated gradient bar at top */}
      <div className="h-1 bg-gradient-to-r from-cyan-400 via-amber-300 via-violet-400 to-emerald-400" />

      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <motion.div
                animate={{ rotate: [0, 8, -8, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Sparkle size={17} className="text-amber-300" weight="fill" />
              </motion.div>
              <span className="text-sm font-bold">Live market pulse</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 border border-emerald-400/30 px-1.5 py-0.5 text-[9px] font-mono text-emerald-300">
                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                LIVE
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              What the agent is watching right now — across 8 chains.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {btcDom != null && (
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">Total mcap</p>
                <div className="flex items-center gap-1.5">
                  <GlobeHemisphereEast size={13} className="text-cyan-300" weight="duotone" />
                  <span className="text-sm font-bold font-mono">{formatBigNumber(globalMetrics?.total_market_cap)}</span>
                  <span className={`text-[10px] font-mono ${totalMcapChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {totalMcapChange >= 0 ? '+' : ''}{totalMcapChange.toFixed(2)}%
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 rounded-xl bg-white/[0.04] animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Gainers section */}
            {gainers.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Fire size={13} className="text-orange-300" weight="duotone" />
                  <p className="text-[10px] uppercase tracking-wider font-mono text-orange-200/80">
                    Top movers · 24h
                  </p>
                </div>
                <div className="space-y-1.5">
                  {gainers.map((coin, i) => (
                    <PulseItem key={coin.id ?? i} coin={coin} index={i} />
                  ))}
                </div>
              </div>
            )}

            {/* New listings ticker */}
            {newListings.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Rocket size={13} className="text-violet-300" weight="duotone" />
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

            {/* Airdrops — compact, dismissible */}
            <AnimatePresence>
              {showAirdrops && airdrops.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <Star size={13} className="text-amber-300" weight="duotone" />
                      <p className="text-[10px] uppercase tracking-wider font-mono text-amber-200/80">
                        Airdrop watch · {airdrops.length} active
                      </p>
                    </div>
                    <button
                      onClick={() => setShowAirdrops(false)}
                      className="text-muted-foreground/40 hover:text-muted-foreground text-xs"
                      aria-label="Dismiss"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {airdrops.map((airdrop, i) => (
                      <AirdropItem key={airdrop.id ?? i} airdrop={airdrop} index={i} />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {gainers.length === 0 && newListings.length === 0 && airdrops.length === 0 && (
              <div className="text-center py-6 text-xs text-muted-foreground/60">
                <ArrowsClockwise size={20} className="mx-auto mb-2 animate-spin text-muted-foreground/40" />
                <p>Streaming live data from CoinMarketCap...</p>
              </div>
            )}
          </div>
        )}

        <p className="text-[10px] text-muted-foreground/60 mt-4 pt-3 border-t border-border/20 flex items-center gap-1.5">
          <span className="w-1 h-1 rounded-full bg-cyan-400" />
          Sources: CoinMarketCap (news, sentiment, listings) + CoinGecko (price, DEX) — refreshed every 5 min.
        </p>
      </div>
    </Card>
  )
}
