import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearReturningUser, isReturningUser, markReturningUser, wantsLandingPage, STAY_HOME } from './returningUser'

class MemoryStorage {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, v) }
  removeItem(k: string) { this.m.delete(k) }
}

describe('returning user', () => {
  beforeEach(() => { (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage() })
  afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage })

  it('is a first visit until someone connects', () => {
    expect(isReturningUser()).toBe(false)
    markReturningUser()
    expect(isReturningUser()).toBe(true)
  })

  it('counts a session saved before the flag existed', () => {
    localStorage.setItem('maef-wallet-session-at', '123')
    expect(isReturningUser()).toBe(true)
  })

  it('forgets the user after an explicit disconnect', () => {
    markReturningUser()
    clearReturningUser()
    expect(isReturningUser()).toBe(false)
  })

  it('treats a missing or blocked storage as a first visit', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage
    expect(isReturningUser()).toBe(false)
    expect(() => markReturningUser()).not.toThrow()
  })

  it('lets in-app home links show the landing page', () => {
    expect(wantsLandingPage(STAY_HOME)).toBe(true)
    expect(wantsLandingPage(null)).toBe(false)
    expect(wantsLandingPage({})).toBe(false)
  })
})
