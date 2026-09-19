/**
 * Shared number/price/percentage formatters with explicit null-safety.
 * Pattern: never let a missing field render as a fake "0" or "▲ 0.0%".
 * Usage: fmtPrice(coin.quote?.[0]?.price) // '—' when missing
 */

/** Optional-value formatter: returns fallback when value is null/undefined/NaN. */
export function fmtOpt<T>(v: T | null | undefined, f: (x: T) => string, fb = '—'): string {
  if (v == null) return fb
  if (typeof v === 'number' && Number.isNaN(v)) return fb
  return f(v)
}

const usdFull = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const usdInt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/** $ prices: 2dp when >= 1, 4dp when < 1. '—' when missing. */
export function fmtPrice(usd: number | null | undefined): string {
  return fmtOpt(usd, v => (v >= 1 ? `$${usdFull.format(v)}` : `$${v.toFixed(4)}`))
}

/** Compact USD: $1.24T / $812.5B / $42.1M. '—' when missing. */
export function fmtCompactUsd(n: number | null | undefined): string {
  return fmtOpt(n, v => {
    if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
    if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
    if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
    if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
    return `$${usdFull.format(v)}`
  })
}

/** Plain integer with thousands separator: 100,000. */
export function fmtInt(n: number | null | undefined): string {
  return fmtOpt(n, v => usdInt.format(v))
}

/** Airdrop-style prize: $100,000 (integer, with currency suffix when given). */
export function fmtPrize(prize: number | null | undefined, currency?: string | null): string {
  if (prize == null || Number.isNaN(prize)) return '—'
  return `$${usdInt.format(prize)}${currency ?? ''}`
}

/** Signed % change: '+4.9%' / '-2.1%'. '—' when missing. Never fakes zero. */
export function fmtPct(change: number | null | undefined, digits = 1): string {
  return fmtOpt(change, v => `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`)
}

/** Whether a value is a real, finite number we may display as data. */
export function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Relative "time ago" for small spans: 'just now', '2m ago', '1h ago'. */
export function fmtTimeAgo(ts: number | Date | null | undefined): string {
  if (ts == null) return '—'
  const ms = typeof ts === 'number' ? ts : ts.getTime()
  const diff = Date.now() - ms
  if (diff < 45_000) return 'just now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`
  return `${Math.round(diff / 86_400_000)}d ago`
}

export function fmtAgeSeconds(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  if (seconds < 0) return 'just now'
  if (seconds < 60) return `${Math.round(seconds)}s ago`
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86_400) return `${(seconds / 3_600).toFixed(1)}h ago`
  return `${(seconds / 86_400).toFixed(1)}d ago`
}
