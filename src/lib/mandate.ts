import type { AgentMandate, ScoutRunResult } from '@/services/cloudRunService'

/** Daily budgets an owner can pick. The backend accepts 1–100; a few runs a
 *  day is plenty for learning and keeps gas and model cost predictable. */
export const MANDATE_RUN_OPTIONS = [1, 2, 4] as const
export const DEFAULT_MANDATE_RUNS = 2

const todayUtc = (now: number) => new Date(now).toISOString().slice(0, 10)

/** "1 of 2 runs used today" — the counter resets on the first run of a UTC day. */
export function runsUsedToday(m: AgentMandate, now = Date.now()): number {
  return m.runs_day === todayUtc(now) ? m.runs_used_today : 0
}

export function describeMandate(m: AgentMandate, now = Date.now()): { runs: string; expires: string; spent: boolean } {
  const used = runsUsedToday(m, now)
  const left = m.expires_at * 1000 - now
  const hours = Math.max(1, Math.round(left / 3_600_000))
  const days = Math.round(left / 86_400_000)
  return {
    runs: `${used} of ${m.max_runs_per_day} run${m.max_runs_per_day === 1 ? '' : 's'} used today`,
    expires: left <= 0 ? 'expired' : hours >= 24 ? `expires in ${days} day${days === 1 ? '' : 's'}` : `expires in ${hours} h`,
    spent: used >= m.max_runs_per_day,
  }
}

/** Plain-language outcome of one scout cycle. */
export function describeScoutRun(r: ScoutRunResult): { tone: 'success' | 'info' | 'warning'; text: string } {
  if (r.status === 'attended') return { tone: 'success', text: 'Found a video, learned from it, and saved the lesson.' }
  if (r.status === 'no_new_events') return { tone: 'info', text: r.message || 'Nothing new worth learning right now. It will look again on the next run.' }
  const why: Record<string, string> = {
    MINT_CAP_REACHED: 'Daily mint limit reached. It will continue tomorrow.',
    INSUFFICIENT_GAS: "The agent's wallet is low on gas. Top it up and try again.",
    YOUTUBE_API_LIMIT: 'YouTube search quota is used up for today.',
  }
  return { tone: 'warning', text: (r.reason_code && why[r.reason_code]) || r.message || 'Skipped this time.' }
}
