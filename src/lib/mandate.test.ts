import { describe, expect, it } from 'vitest'
import { describeMandate, describeScoutRun, runsUsedToday } from './mandate'
import type { AgentMandate } from '@/services/cloudRunService'

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0)
const base: AgentMandate = {
  owner_wallet: '0xabc', chain_id: 97, scopes: ['attend_event'], max_runs_per_day: 2,
  runs_used_today: 1, runs_day: '2026-10-20', expires_at: NOW / 1000 + 3 * 86400,
}

describe('mandate display', () => {
  it('counts runs only for today (UTC)', () => {
    expect(runsUsedToday(base, NOW)).toBe(1)
    expect(runsUsedToday({ ...base, runs_day: '2026-10-19' }, NOW)).toBe(0)
  })

  it('says how much budget and time is left', () => {
    expect(describeMandate(base, NOW)).toEqual({ runs: '1 of 2 runs used today', expires: 'expires in 3 days', spent: false })
    expect(describeMandate({ ...base, runs_used_today: 2 }, NOW).spent).toBe(true)
    expect(describeMandate({ ...base, expires_at: NOW / 1000 + 5 * 3600 }, NOW).expires).toBe('expires in 5 h')
    expect(describeMandate({ ...base, expires_at: NOW / 1000 - 1 }, NOW).expires).toBe('expired')
    // A fresh 7-day mandate, seconds old, still reads as 7 days.
    expect(describeMandate({ ...base, expires_at: NOW / 1000 + 7 * 86400 - 30 }, NOW).expires).toBe('expires in 7 days')
  })

  it('explains a scout run in plain words', () => {
    expect(describeScoutRun({ status: 'attended' }).tone).toBe('success')
    expect(describeScoutRun({ status: 'skipped', reason_code: 'MINT_CAP_REACHED' }).text).toMatch(/limit/)
    expect(describeScoutRun({ status: 'no_new_events' }).tone).toBe('info')
  })
})
