/**
 * Privy: email / Google sign-in with an embedded wallet, for people who do
 * not have a browser wallet. Off unless VITE_PRIVY_APP_ID is set, so builds
 * without it behave exactly as before and never load the Privy bundle.
 *
 * The embedded wallet is a plain EOA. Every ASAJU signature check recovers an
 * EOA address, so Privy users sign room, mandate and proposal challenges the
 * same way a MetaMask user does — Privy's own login token authorises nothing.
 */
export const PRIVY_APP_ID = (import.meta.env.VITE_PRIVY_APP_ID as string | undefined)?.trim() || ''

export const privyEnabled = PRIVY_APP_ID.length > 0

/** Window event that opens the wallet picker from anywhere in the app. */
export const OPEN_WALLET_PICKER = 'asaju:open-wallet-picker'
