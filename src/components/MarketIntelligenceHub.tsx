import { useEffect, useMemo, useState } from 'react'
import {
  TrendUp,
  TrendDown,
  Sparkle,
  Rocket,
  Gift,
  GlobeHemisphereEast,
  ArrowsClockwise,
  Fire,
  WarningCircle,
  CaretDown,
} from '@phosphor-icons/react'
import { motion, AnimatePresence } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { cloudRunService, Airdrop, GlobalMetrics, NewListing, TrendingCoin } from '@/services/cloudRunService'
import { fmtCompactUsd, fmtPct, fmtPrice, fmtPrize, fmtTimeAgo, isFiniteNum } from '@/lib/format'

const REFRESH_MS = 5 * 60 * 1000
const MOVERS_VISIBLE = 6

type TabKey = 'hot' | 'gainers' | 'losers' | 'listings' | 'airdrops'

interface HubState {
  hot: TrendingCoin[]
  gainers: TrendingCoin[]
  losers: TrendingCoin[]
  listings: NewListing[]
  airdrops: Airdrop[]
  metrics: GlobalMetrics | null
  loading: boolean
  failedSources: number
  lastUpdated: number | null
}

const TABS: Array<{ key: TabKey; label: string; hint: string }> = [
  { key: 'hot', label: 'Hot', hint: 'Most visited right now' },
  { key: 'gainers', label: 'Gainers', hint: 'Top movers up 24h' },
  { key: 'losers', label: 'Losers', hint: 'Deepest drops 24h' },
  { key: 'listings', label: 'Listings', hint: 'Just added on CMC' },
  { key: 'airdrops', label: 'Airdrops', hint: 'Active campaigns' },
]

function MoverRow({ coin, index }: { coin: TrendingCoin; index: number }) {
  const quote = Array.isArray(coin.quote) ? coin.quote[0] : undefined
  const hasPrice = isFiniteNum(quote?.price)
  const change = isFiniteNum(quote?.percent_change_24h) ? (quote!.percent_change_24h as number) : null
  if (!hasPrice && change == null) return null
  const up = change != null && change >= 0
  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.2), duration: 0.25 }}
      className="group grid grid-cols-[24px_1fr_auto_auto] items-center gap-3 px-3 py-1.5 rounded-md hover:bg-white/[0.04] transition-colors border-b border-white/[0.04] last:border-0"
    >
      <span className="text-[10px] font-mono tabular-nums text-muted-foreground/60">{index + 1}</span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 font-semibold text-sm">
          <span className="truncate">{coin.symbol}</span>
          {coin.cmc_rank && (
            <span className="text-[9px] font-mono text-muted-foreground/50 shrink-0">#{coin.cmc_rank}</span>
          )}
        </div>
        <span className="text-[10px] text-muted-foreground truncate block leading-tight">{coin.name}</span>
      </div>
      <div className="text-sm font-mono tabular-nums text-right">{fmtPrice(quote?.price)}</div>
      {change != null ? (
        <span className={`text-[11px] font-mono tabular-nums w-16 text-right ${up ? 'text-emerald-400 text-terminal-glow-up' : 'text-rose-400 text-terminal-glow-down'}`}>
          {up ? '+' : ''}{change.toFixed(1)}%
        </span>
      ) : (
        <span className="text-[11px] text-muted-foreground/40 w-16 text-right">—</span>
      )}
    </motion.div>
  )
}

function ListingChip({ coin, index }: { coin: NewListing; index: number }) {
  const addedDate = coin.date_added
    ? new Date(coin.date_added).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : ''
  const quote = Array.isArray(coin.quote) ? coin.quote[0] : undefined
  const change = isFiniteNum(quote?.percent_change_24h) ? (quote!.percent_change_24h as number) : null
  const up = change != null && change >= 0
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.04 }}
      className="flex items-center justify-between gap-3 px-3 py-2 rounded-md hover:bg-white/[0.04] border-b border-white/[0.04] last:border-0"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Rocket size={12} className="text-violet-300 shrink-0" weight="duotone" />
        <span className="font-semibold text-sm">{coin.symbol}</span>
        <span className="text-[10px] text-muted-foreground truncate max-w-[120px] hidden sm:inline">{coin.name}</span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {change != null && (
          <span className={`text-[11px] font-mono tabular-nums ${up ? 'text-emerald-400 text-terminal-glow-up' : 'text-rose-400 text-terminal-glow-down'}`}>
            {up ? '+' : ''}{change.toFixed(1)}%
          </span>
        )}
        <span className="text-[10px] text-muted-foreground/70 font-mono tabular-nums">{addedDate}</span>
      </div>
    </motion.div>
  )
}

function AirdropRow({ airdrop, index }: { airdrop: Airdrop; index: number }) {
  const symbol = airdrop.coin?.symbol ?? airdrop.name?.split(' ')[0] ?? '?'
  const daysLeft = airdrop.end_date
    ? Math.max(0, Math.ceil((new Date(airdrop.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="flex items-center justify-between gap-3 px-3 py-2 rounded-md hover:bg-white/[0.04] border-b border-white/[0.04] last:border-0"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Gift size={13} className="text-amber-300 shrink-0" weight="duotone" />
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate">{symbol}</p>
          <p className="text-[10px] text-muted-foreground tabular-nums truncate max-w-[180px]">
            {isFiniteNum(airdrop.total_prize) ? fmtPrize(airdrop.total_prize, airdrop.prize_currency ?? '') : 'Learn more →'}
          </p>
        </div>
      </div>
      {daysLeft != null && daysLeft > 0 && (
        <span className="text-[10px] font-mono font-semibold text-amber-300 tabular-nums shrink-0">
          {daysLeft}d
        </span>
      )}
    </motion.div>
  )
}

export function MarketIntelligenceHub() {
  const [state, setState] = useState<HubState>({
    hot: [],
    gainers: [],
    losers: [],
    listings: [],
    airdrops: [],
    metrics: null,
    loading: true,
    failedSources: 0,
    lastUpdated: null,
  })
  const [tab, setTab] = useState<TabKey>('hot')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const settled = await Promise.allSettled([
        cloudRunService.getMostVisited(8),
        cloudRunService.getTrendingGainersLosers('24h', 8, 'desc'),
        cloudRunService.getTrendingGainersLosers('24h', 8, 'asc'),
        cloudRunService.getNewListings(6),
        cloudRunService.getAirdrops(4),
        cloudRunService.getGlobalMetrics(),
      ])
      if (cancelled) return
      const [h, g, l, n, a, m] = settled
      const failures = settled.filter(r => r.status === 'rejected').length
      settled.forEach((r, i) => {
        if (r.status === 'rejected') console.warn(`[MarketHub] source ${i} failed:`, r.reason)
      })
      setState(prev => ({
        ...prev,
        loading: false,
        failedSources: failures,
        hot: h.status === 'fulfilled' ? h.value.results ?? [] : [],
        gainers: g.status === 'fulfilled' ? g.value.results ?? [] : [],
        losers: l.status === 'fulfilled' ? l.value.results ?? [] : [],
        listings: n.status === 'fulfilled' ? n.value.results ?? [] : [],
        airdrops: a.status === 'fulfilled' ? a.value.results ?? [] : [],
        metrics: m.status === 'fulfilled' ? m.value.metrics ?? null : null,
        lastUpdated: Date.now(),
      }))
    }
    load()
    const iv = setInterval(load, REFRESH_MS)
    return () => { cancelled = true; clearInterval(iv) }
  }, [])

  const current: Array<TrendingCoin | NewListing | Airdrop> = useMemo(() => {
    switch (tab) {
      case 'hot': return state.hot
      case 'gainers': return state.gainers
      case 'losers': return state.losers
      case 'listings': return state.listings
      case 'airdrops': return state.airdrops
    }
  }, [tab, state])

  const visible = expanded ? current : current.slice(0, MOVERS_VISIBLE)
  const partial = state.failedSources > 0 && state.failedSources < 6
  const down = state.failedSources >= 6

  const mcapChange = isFiniteNum(state.metrics?.total_market_cap_yesterday_percentage_change)
    ? (state.metrics!.total_market_cap_yesterday_percentage_change as number)
    : null

  return (
    <Card className="overflow-hidden border-cyan-400/25 bg-gradient-to-b from-slate-950/80 via-slate-950/70 to-slate-950/60 backdrop-blur-md shadow-2xl shadow-black/40">
      {/* Hero strip — macro pulse */}
      <div className="border-b border-white/10 bg-white/[0.02]">
        <div className="grid grid-cols-3 divide-x divide-white/5">
          <div className="px-4 py-3">
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-mono mb-0.5">Total mcap</p>
            <div className="flex items-baseline gap-2 font-mono tabular-nums">
              <span className="text-base font-bold">{fmtCompactUsd(state.metrics?.total_market_cap)}</span>
              {mcapChange != null && (
                <span className={`text-[11px] ${mcapChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {fmtPct(mcapChange, 2)}
                </span>
              )}
            </div>
          </div>
          <div className="px-4 py-3">
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-mono mb-0.5">BTC dominance</p>
            <div className="flex items-baseline gap-1 font-mono tabular-nums">
              <span className="text-base font-bold">
                {isFiniteNum(state.metrics?.btc_dominance) ? `${state.metrics!.btc_dominance!.toFixed(1)}%` : '—'}
              </span>
            </div>
          </div>
          <div className="px-4 py-3">
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground font-mono mb-0.5">Fear & Greed</p>
            <div className="flex items-baseline gap-1 font-mono tabular-nums">
              <span className="text-base font-bold">—</span>
              <span className="text-[10px] text-muted-foreground/70">in snapshot</span>
            </div>
          </div>
        </div>
      </div>

      {/* Header + tabs */}
      <div className="px-4 pt-3 pb-0">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <Sparkle size={15} className="text-amber-300" weight="fill" />
            <span className="text-sm font-bold">Live market intelligence</span>
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
          {state.lastUpdated && (
            <p className="text-[9px] font-mono text-muted-foreground/60 tabular-nums">
              Updated {fmtTimeAgo(state.lastUpdated)}
            </p>
          )}
        </div>

        <div className="flex items-center gap-0.5 border-b border-white/5 -mx-4 px-4 pb-0">
          {TABS.map(t => {
            const active = tab === t.key
            return (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setExpanded(false) }}
                className={`relative px-3 py-2 text-xs font-semibold transition-colors ${
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground/80'
                }`}
                title={t.hint}
              >
                {t.label}
                {active && (
                  <motion.span
                    layoutId="tab-underline"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-cyan-400 to-emerald-400"
                  />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Content */}
      <div className="px-1 py-1">
        {state.loading ? (
          <div className="space-y-1 px-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-8 rounded bg-white/[0.03] animate-pulse" />
            ))}
          </div>
        ) : down ? (
          <div className="px-4 py-6 text-center">
            <p className="text-xs text-muted-foreground">Live data temporarily unavailable.</p>
          </div>
        ) : current.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <ArrowsClockwise size={16} className="mx-auto mb-1 animate-spin text-muted-foreground/40" />
            <p className="text-[11px] text-muted-foreground/70">Waiting for live data…</p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>
              {(tab === 'hot' || tab === 'gainers' || tab === 'losers') && (
                <div>
                  {visible.map((c, i) => <MoverRow key={`${tab}-${i}`} coin={c as TrendingCoin} index={i} />)}
                </div>
              )}
              {tab === 'listings' && (
                <div>
                  {visible.map((c, i) => <ListingChip key={`l-${i}`} coin={c as NewListing} index={i} />)}
                </div>
              )}
              {tab === 'airdrops' && (
                <div>
                  {visible.map((a, i) => <AirdropRow key={`a-${i}`} airdrop={a as Airdrop} index={i} />)}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        )}

        {!state.loading && current.length > MOVERS_VISIBLE && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="w-full flex items-center justify-center gap-1 mt-1 px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? 'Show less' : `Show ${current.length - MOVERS_VISIBLE} more`}
            <CaretDown size={10} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      <p className="text-[9px] text-muted-foreground/60 px-4 py-2 border-t border-white/5 flex items-center gap-1.5">
        <span className="w-1 h-1 rounded-full bg-cyan-400" />
        CoinMarketCap · refreshes every 5 min
      </p>
    </Card>
  )
}
