import { describe, expect, it } from 'vitest'
import { fmtTokenAmount } from './format'

describe('fmtTokenAmount', () => {
  it('keeps small prices instead of rounding them away', () => {
    expect(fmtTokenAmount(0.01)).toBe('0.01')
    expect(fmtTokenAmount(0.05)).toBe('0.05')
    expect(fmtTokenAmount(0.000123)).toBe('0.000123')
  })

  it('trims trailing zeros and groups thousands', () => {
    expect(fmtTokenAmount(12.5)).toBe('12.5')
    expect(fmtTokenAmount(1500)).toBe('1,500')
    expect(fmtTokenAmount(2.123456)).toBe('2.1235')
  })

  it('handles zero, dust and missing values', () => {
    expect(fmtTokenAmount(0)).toBe('0')
    expect(fmtTokenAmount(0.0000001)).toBe('<0.000001')
    expect(fmtTokenAmount(undefined)).toBe('—')
    expect(fmtTokenAmount(Number.NaN)).toBe('—')
  })
})
