import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Brain, Eye, Newspaper, Robot } from '@phosphor-icons/react'
import { Card } from '@/components/ui/card'
import { cloudRunService, type CmcAiSummary } from '@/services/cloudRunService'
import { fmtAgeSeconds, isFiniteNum } from '@/lib/format'

/**
 * CmcAiSummaryCard — surfaces CoinMarketCap's own AI-generated market thesis
 * (the same payload that gets injected as the highest-priority context into the
 * agent's proposal prompt). Lives on the dashboard right below the Sensory
 * Feed and right above the proposal card, so the visual story is:
 *
 *   1. Raw CMC data (Sensory Feed)
 *   2. CMC's own AI digest of that data (this card)
 *   3. Asaju's Gemini proposal grounded in steps 1 + 2
 *
 * Pure presentation — no LLM call, no Gemini prompt. Just renders whatever CMC
 * served at /v5/cmc-ai/latest. Fail-soft: shows a quiet "feed unavailable"
 * instead of a hard error when the provider is down.
 */
export function CmcAiSummaryCard() {
  const [summary, setSummary] = useState<CmcAiSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const { summary } = await cloudRunService.getCmcAiBrief()
        if (cancelled) return
        if (summary && (summary.tldr || summary.thesis)) {
          setSummary(summary)
        } else {
          setSummary(null)
        }
        setError(false)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const interval = setInterval(load, 5 * 60 * 1000) // 5-min refresh
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  if (loading) {
    return (
      <Card className="p-4 border border-violet-400/20 bg-violet-400/[0.02]">
        <div className="flex items-center gap-2 mb-2">
          <Brain size={15} className="text-violet-300" weight="duotone" />
          <p className="text-xs font-bold text-violet-200 uppercase tracking-wider">CMC AI Market Summary</p>
          <span className="ml-auto text-[10px] text-muted-foreground/60 font-mono">loading…</span>
        </div>
        <div className="space-y-2">
          <div className="h-4 w-3/4 rounded bg-white/[0.04] animate-pulse" />
          <div className="h-3 w-full rounded bg-white/[0.04] animate-pulse" />
          <div className="h-3 w-5/6 rounded bg-white/[0.04] animate-pulse" />
        </div>
      </Card>
    )
  }

  if (error || !summary) {
    // Compact 1-bar fallback so it doesn't displace critical content below.
    return (
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-md border border-violet-400/15 bg-violet-400/[0.03] text-[11px]">
        <div className="flex items-center gap-1.5">
          <Brain size={12} weight="duotone" className="text-violet-300/60" />
          <span className="font-semibold text-violet-200/80">CMC AI Market Summary</span>
          <span className="text-muted-foreground/60">·</span>
          <span className="text-muted-foreground/70 italic">feed unavailable — agent falls back to its own market signals</span>
        </div>
      </div>
    )
  }

  return (
    <Card className="relative p-4 border border-violet-400/30 bg-gradient-to-br from-violet-400/[0.06] via-transparent to-cyan-400/[0.04] overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3 relative z-10">
        <div className="flex items-center gap-2">
          <div className="relative w-7 h-7 rounded-lg bg-violet-400/15 border border-violet-400/40 flex items-center justify-center">
            <Brain size={14} className="text-violet-200" weight="duotone" />
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-violet-300 animate-pulse" />
          </div>
          <div>
            <p className="text-xs font-bold text-violet-100 uppercase tracking-wider">CMC AI Market Summary</p>
            <p className="text-[10px] text-muted-foreground/70 mt-0.5">
              <Robot size={9} weight="duotone" className="inline-block align-middle mr-0.5" />
              Read by your agent before every proposal
            </p>
          </div>
        </div>
        <p className="text-[10px] font-mono text-muted-foreground/60 shrink-0 tabular-nums">
          {isFiniteNum(summary.generated_at)
            ? fmtAgeSeconds((Date.now() / 1000) - (summary.generated_at as number))
            : '—'}
        </p>
      </div>

      {/* TLDR — the headline summary, prominently displayed */}
      <AnimatePresence mode="wait">
        {summary.tldr && (
          <motion.div
            key={`tldr-${summary.tldr.slice(0, 40)}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-3 p-3 rounded-lg border border-violet-400/25 bg-violet-400/[0.06] relative z-10"
          >
            <p className="text-[10px] uppercase tracking-wider font-mono text-violet-200/80 mb-1">TLDR</p>
            <p className="text-sm leading-relaxed text-gray-100 font-medium">{summary.tldr}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Thesis — longer-form analysis, truncated for the dashboard but
          the full text is in the agent's prompt. */}
      {summary.thesis && (
        <p className="text-xs text-gray-300 leading-relaxed mb-3 line-clamp-3 relative z-10">
          {summary.thesis}
        </p>
      )}

      {/* Trending headlines — quick scan of what's moving today */}
      {(summary.headlines ?? []).length > 0 && (
        <div className="relative z-10">
          <p className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground/70 mb-1.5 flex items-center gap-1">
            <Newspaper size={9} weight="duotone" />
            Top headlines
          </p>
          <ul className="space-y-1">
            {(summary.headlines ?? []).slice(0, 4).map((h, i) => (
              <li
                key={i}
                className="text-[11px] text-gray-200 leading-snug flex items-start gap-1.5"
              >
                <span className="text-violet-300/60 mt-0.5 font-mono shrink-0">▸</span>
                <span className="line-clamp-1">{h}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Audit footer — makes clear what the agent is reading */}
      <div className="mt-3 pt-2.5 border-t border-violet-400/15 flex items-center justify-between gap-2 relative z-10">
        <p className="text-[9px] font-mono text-muted-foreground/60 flex items-center gap-1">
          <Eye size={9} weight="duotone" className="text-violet-300/60" />
          Source: CoinMarketCap /v5/cmc-ai/latest (Phase 1, Enterprise plan)
        </p>
      </div>
    </Card>
  )
}
