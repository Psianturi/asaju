import { useEffect, useRef, type ReactNode } from 'react'
import { PrivyProvider, usePrivy, useWallets } from '@privy-io/react-auth'
import { defineChain } from 'viem'
import { EnvelopeSimple } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { PRIVY_APP_ID } from '@/lib/privy'
import { DEFAULT_CHAIN_ID, getSupportedChains } from '@/lib/blockchain/chains'
import { mantleService } from '@/lib/blockchain/mantleService'

/**
 * Everything that touches the Privy SDK lives in this file, so it ships as its
 * own chunk and loads only when Privy is enabled.
 */

// The embedded wallet can only switch to chains Privy was told about.
const chains = getSupportedChains().map(c => defineChain({
  id: c.chainId,
  name: c.name,
  nativeCurrency: { name: c.nativeSymbol, symbol: c.nativeSymbol, decimals: 18 },
  rpcUrls: { default: { http: [c.rpcUrl, ...(c.rpcUrls ?? []).filter(u => u !== c.rpcUrl)] } },
  blockExplorers: { default: { name: 'Explorer', url: c.explorerUrl } },
  testnet: true,
}))
const defaultChain = chains.find(c => c.id === DEFAULT_CHAIN_ID) ?? chains[0]

export function PrivyRoot({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // External wallets keep using ASAJU's own picker; Privy covers the rest.
        loginMethods: ['email', 'google'],
        appearance: { theme: 'dark', accentColor: '#3FD8EA', landingHeader: 'Sign in to ASAJU' },
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
        defaultChain,
        supportedChains: chains,
      }}
    >
      {children}
    </PrivyProvider>
  )
}

// Set when the person starts a Privy sign-in from the wallet dialog, so a
// finished login connects right away.
let wantsConnect = false

/** "Continue with email or Google" in the wallet dialog. */
export function PrivyLoginButton({ onStart }: { onStart?: () => void }) {
  const { ready, authenticated, login } = usePrivy()
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full justify-start gap-3 h-12"
      disabled={!ready}
      onClick={() => {
        wantsConnect = true
        onStart?.()
        if (!authenticated) login()
      }}
    >
      <EnvelopeSimple size={20} weight="duotone" className="text-primary" />
      <span className="flex flex-col items-start leading-tight">
        <span className="text-sm font-semibold">Continue with email or Google</span>
        <span className="text-[11px] text-muted-foreground">{ready ? 'No wallet needed — we create one for you' : 'Loading sign-in…'}</span>
      </span>
    </Button>
  )
}

/**
 * Keeps the app's wallet state and the Privy session in step:
 * - a finished Privy login (or a restored session) connects its embedded wallet;
 * - disconnecting in the app signs out of Privy, so it does not reconnect.
 */
export function PrivySync({ isConnected, onConnect }: { isConnected: boolean; onConnect: () => void }) {
  const { ready, authenticated, logout } = usePrivy()
  const { wallets, ready: walletsReady } = useWallets()
  const embedded = wallets.find(w => w.walletClientType === 'privy')
  const wasConnected = useRef(isConnected)
  const connecting = useRef(false)

  useEffect(() => {
    if (!ready || !walletsReady || !authenticated || !embedded || isConnected || connecting.current) return
    connecting.current = true
    embedded.getEthereumProvider()
      .then(provider => {
        mantleService.setPreferredProvider(provider as never)
        wantsConnect = false
        onConnect()
      })
      .catch(err => console.warn('[privy] embedded wallet unavailable:', err))
      .finally(() => { connecting.current = false })
  }, [ready, walletsReady, authenticated, embedded, isConnected, onConnect])

  useEffect(() => {
    if (wasConnected.current && !isConnected && authenticated && !wantsConnect) {
      void logout()
    }
    wasConnected.current = isConnected
  }, [isConnected, authenticated, logout])

  return null
}
