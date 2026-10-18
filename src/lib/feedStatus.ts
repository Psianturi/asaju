import type { FeedUnavailableReason } from '@/services/cloudRunService'

/** Why a market feed has no rows. `unreachable` = the ASAJU backend did not answer. */
export type FeedProblem = FeedUnavailableReason | 'unreachable'

/** Plain-language explanation shown in place of an empty table. */
export const FEED_PROBLEM_COPY: Record<FeedProblem, string> = {
  plan_unsupported: "This feed isn't included in the current CoinMarketCap API plan.",
  rate_limited: 'CoinMarketCap rate limit reached — retrying in a few minutes.',
  auth: 'The CoinMarketCap API key was rejected.',
  not_configured: 'No CoinMarketCap API key is configured.',
  upstream_error: "CoinMarketCap didn't respond — retrying automatically.",
  unreachable: "Couldn't reach the ASAJU backend — retrying automatically.",
}

type FeedResponse<T> = {
  results?: T[]
  available?: boolean
  reason?: FeedUnavailableReason | null
  source?: 'coinmarketcap' | 'cache' | 'coingecko' | null
}

/** Rows shown while CoinMarketCap is failing come from a stand-in; say which. */
export type FeedSource = 'cache' | 'coingecko'

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
  return rows.length > 0 && (source === 'cache' || source === 'coingecko') ? { rows, source } : { rows }
}
