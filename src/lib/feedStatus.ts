import type { FeedUnavailableReason } from '@/services/cloudRunService'

/** Why a market feed has no rows. `unreachable` = the ASAJU backend did not answer. */
export type FeedProblem = FeedUnavailableReason | 'unreachable'

/** Plain-language explanation shown in place of an empty table. */
export const FEED_PROBLEM_COPY: Record<FeedProblem, string> = {
  // Users see that a feed is unavailable, never why at the provider level
  // (plans, keys, limits) — that detail lives in /api/v1/market/status.
  plan_unsupported: 'This feed is not available right now.',
  rate_limited: 'This feed is busy — it refreshes on its own in a few minutes.',
  auth: 'This feed is temporarily unavailable.',
  not_configured: 'This feed is temporarily unavailable.',
  upstream_error: 'This feed is temporarily unavailable — it retries on its own.',
  plan_expired: 'This feed is temporarily unavailable.',
  unreachable: "Couldn't reach the ASAJU server — retrying automatically.",
}

type FeedResponse<T> = {
  results?: T[]
  available?: boolean
  reason?: FeedUnavailableReason | null
  source?: 'coinmarketcap' | 'cache' | 'coingecko' | 'cmc_listings' | null
}

/** Rows shown while CoinMarketCap is failing come from a stand-in; say which. */
export type FeedSource = 'cache' | 'coingecko' | 'cmc_listings'

/**
 * Rows from one feed call, plus why it is empty when the call did not succeed.
 * A feed that answered with no rows and no failure is genuinely empty, which is
 * different from a provider refusing the call — only the latter gets a problem.
 */
export function readFeed<T>(r: PromiseSettledResult<FeedResponse<T>>): { rows: T[]; problem?: FeedProblem; source?: FeedSource } {
  if (r.status === 'rejected') return { rows: [], problem: 'unreachable' }
  const rows = r.value.results ?? []
  if (rows.length === 0 && r.value.available === false) {
    return { rows, problem: r.value.reason ?? 'upstream_error' }
  }
  const source = r.value.source
  return rows.length > 0 && (source === 'cache' || source === 'coingecko' || source === 'cmc_listings') ? { rows, source } : { rows }
}
