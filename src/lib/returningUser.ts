/**
 * Someone who has connected a wallet (or signed in with Privy) on this browser
 * skips the landing page and opens the app directly. A first visit, or a
 * visit after an explicit disconnect, still lands on the landing page.
 */
const KEY = 'asaju-returning-user'
// Written by every successful connect before this flag existed.
const LEGACY_SESSION_KEY = 'maef-wallet-session-at'

/** Router state for links that mean "show me the landing page anyway". */
export const STAY_HOME = { stayHome: true } as const

function store(): Storage | undefined {
  try { return globalThis.localStorage } catch { return undefined }
}

export function markReturningUser(): void {
  try { store()?.setItem(KEY, '1') } catch { /* storage blocked */ }
}

export function clearReturningUser(): void {
  try { store()?.removeItem(KEY) } catch { /* storage blocked */ }
}

export function isReturningUser(): boolean {
  try {
    const s = store()
    return !!s && (s.getItem(KEY) === '1' || !!s.getItem(LEGACY_SESSION_KEY))
  } catch {
    return false
  }
}

export function wantsLandingPage(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as { stayHome?: unknown }).stayHome === true
}
