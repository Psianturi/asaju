import { useEffect, useState } from 'react'
import { ChartLine, TrendUp, TrendDown, Newspaper, ShieldCheck, Database } from '@phosphor-icons/react'
import { Card } from '@/components/ui/card'
import { cloudRunService, MarketSnapshot, DexPool } from '@/services/cloudRunService'
import { fmtPct, fmtPrice, fmtTimeAgo, isFiniteNum } from '@/lib/format'

const COIN_LABELS: Record<string, string> = { bitcoin: 'BTC', ethereum: 'ETH', mantle: 'MNT' }
const REFRESH_MS = 5 * 60 * 1000

function getNewsTitle(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null
  const record = item as Record<string, unknown>
  const title = record.title ?? record.name
  return typeof title === 'string' && title.trim() ? title.trim() : null
}

function sentimentColor(value: number): string {
  if (value >= 60) return 'text-emerald-400'
  if (value <= 40) return 'text-rose-400'
  return 'text-amber-400'
}

interface MarketContextPanelProps {
  snapshot: MarketSnapshot
  pools?: DexPool[]
  compact?: boolean
}

export function MarketContextPanel({ snapshot, pools = [], compact = false }: MarketContextPanelProps) {
  const generatedAtMs = snapshot.generated_at * 1000
  const lastUpdated = new Date(generatedAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const sentimentValue = snapshot.fear_greed ? Number(snapshot.fear_greed.value) : null
  const news = (snapshot.news ?? []).map(getNewsTitle).filter((title): title is string => Boolean(title)).slice(0, compact ? 2 : 3)

  return (
    <div className={compact ? 'space-y-2.5' : 'space-y-3'}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ChartLine size={15} className="text-cyan-300" weight="duotone" />
            <span className="text-sm font-bold">Market intelligence</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Context available to the agent before it forms a proposal.
          </p>
        </div>
        <div className="text-right">
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-mono">Updated</p>
          <p className="text-[10px] text-muted-foreground font-mono tabular-nums whitespace-nowrap">{lastUpdated}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-[9px] font-mono text-amber-200">
          <ShieldCheck size={9} /> CoinMarketCap
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[9px] font-mono text-emerald-200">
          <Database size={9} /> On-chain liquidity
        </span>
      </div>

      <div className="grid grid-cols-3 gap-1">
        {Object.entries(snapshot.prices).map(([id, price]) => {
          const change = isFiniteNum(price.usd_24h_change) ? (price.usd_24h_change as number) : null
          const up = change != null && change >= 0
          return (
            <div key={id} className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1.5">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-muted-foreground font-mono uppercase">{COIN_LABELS[id] ?? id}</span>
                {change != null && (
                  up
                    ? <TrendUp size={10} className="text-emerald-400" weight="bold" />
                    : <TrendDown size={10} className="text-rose-400" weight="bold" />
                )}
              </div>
              <p className="text-sm font-bold font-mono tabular-nums mt-0.5">{fmtPrice(price.usd)}</p>
              <p className={`text-[10px] font-mono tabular-nums ${change != null ? (up ? 'text-emerald-400 text-terminal-glow-up' : 'text-rose-400 text-terminal-glow-down') : 'text-muted-foreground/50'}`}>
                {change != null ? `${fmtPct(change)} / 24h` : '—'}
              </p>
            </div>
          )
        })}
      </div>

      {sentimentValue !== null && snapshot.fear_greed && (
        <div className="flex items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5">
          <span className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground shrink-0">Sentiment</span>
          <div className="relative flex-1 h-1 rounded-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-400 opacity-80">
            <div className="absolute h-2 w-2 -translate-y-[2px] rounded-full border border-background bg-white shadow" style={{ left: `calc(${Math.max(0, Math.min(100, sentimentValue))}% - 4px)` }} />
          </div>
          <span className={`text-[10px] font-bold tabular-nums shrink-0 ${sentimentColor(sentimentValue)}`}>
            {snapshot.fear_greed.value_classification} · {sentimentValue}
          </span>
        </div>
      )}

      {!compact && pools.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">Mantle liquidity watch</p>
            <span className="text-[9px] text-muted-foreground/60">On-chain</span>
          </div>
          <div className="space-y-1">
            {pools.map((pool, index) => {
              const basePrice = parseFloat(pool.attributes.base_token_price_usd)
              return (
                <div key={`${pool.attributes.name}-${index}`} className="flex items-center justify-between gap-3 rounded-md border border-white/[0.05] bg-white/[0.02] px-2.5 py-1.5 text-xs">
                  <span className="font-medium truncate">{pool.attributes.name}</span>
                  <span className="font-mono text-muted-foreground whitespace-nowrap tabular-nums">
                    {isFiniteNum(basePrice) ? `$${basePrice.toFixed(3)}` : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {news.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Newspaper size={12} className="text-amber-300" weight="duotone" />
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">CMC news signal</p>
          </div>
          <div className="space-y-1">
            {news.map((title, index) => (
              <p key={`${title}-${index}`} className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{title}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function MarketSnapshotCard() {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null)
  const [pools, setPools] = useState<DexPool[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [snap, dex] = await Promise.all([
          cloudRunService.getMarketSnapshot(),
          cloudRunService.getMantleDexPools(),
        ])
        if (cancelled) return
        setSnapshot(snap)
        setPools(dex.pools.slice(0, 3))
        setError(false)
      } catch (err) {
        console.error('Failed to load market snapshot:', err)
        if (!cancelled) setError(true)
      }
    }
    load()
    const interval = setInterval(load, REFRESH_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  if (error || !snapshot) return null

  return (
    <Card className="overflow-hidden border-cyan-400/15 bg-white/[0.02]">
      <div className="p-4">
        <MarketContextPanel snapshot={snapshot} pools={pools} />
        <p className="text-[10px] text-muted-foreground/60 mt-3 pt-2.5 border-t border-border/20">
          Research context only. The agent may use this evidence in a proposal; it does not execute a trade automatically.
        </p>
      </div>
    </Card>
  )
}
