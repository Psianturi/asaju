import { describe, expect, it } from 'vitest'
import { readFeed } from './feedStatus'

const ok = <T,>(value: T): PromiseSettledResult<T> => ({ status: 'fulfilled', value })

describe('readFeed', () => {
  it('returns rows when the feed answered', () => {
    expect(readFeed(ok({ results: [1, 2], available: true }))).toEqual({ rows: [1, 2] })
  })

  it('reports the provider reason when the feed was refused', () => {
    expect(readFeed(ok({ results: [], available: false, reason: 'plan_unsupported' as const }))).toEqual({
      rows: [],
      problem: 'plan_unsupported',
    })
  })

  it('treats an empty but successful feed as empty, not failed', () => {
    expect(readFeed(ok({ results: [], available: true }))).toEqual({ rows: [] })
  })

  it('treats a response from an older backend (no availability field) as available', () => {
    expect(readFeed(ok({ results: [] }))).toEqual({ rows: [] })
  })

  it('marks a rejected request as unreachable', () => {
    expect(readFeed({ status: 'rejected', reason: new Error('timeout') })).toEqual({ rows: [], problem: 'unreachable' })
  })
})
