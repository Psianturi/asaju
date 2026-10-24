import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { getChain, DEFAULT_CHAIN_ID } from '@/lib/blockchain/chains'
import { Button } from '@/components/ui/button'
import { Wallet, WarningCircle, CaretDown, Copy, ArrowSquareOut, SignOut } from '@phosphor-icons/react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { motion } from 'framer-motion'
import { detectWallets, DetectedWallet, mantleService } from '@/lib/blockchain/mantleService'
import { privyEnabled, OPEN_WALLET_PICKER } from '@/lib/privy'

// Privy's SDK is large; it is fetched only when an app id is configured.
const PrivyLoginButton = lazy(() => import('@/components/PrivyBridge').then(m => ({ default: m.PrivyLoginButton })))
const PrivySync = lazy(() => import('@/components/PrivyBridge').then(m => ({ default: m.PrivySync })))

interface WalletConnectProps {
  onConnect: (address: string) => void
  isConnected: boolean
  address?: string
  balance?: number
  /** Which chain the balance is denominated in — the label used to say MNT on every chain. */
  chainId?: number
  onDisconnect: () => void
}

const WALLET_STYLES: Record<DetectedWallet['id'], { border: string; bg: string; dot: string; label: string }> = {
  okx:      { border: 'border-blue-500/40 hover:border-blue-500/70',    bg: 'from-blue-500/10 to-cyan-500/10',     dot: 'bg-blue-400',   label: 'OKX' },
  bitget:   { border: 'border-cyan-500/40 hover:border-cyan-500/70',    bg: 'from-cyan-500/10 to-teal-500/10',     dot: 'bg-cyan-400',   label: 'BG' },
  metamask: { border: 'border-orange-500/40 hover:border-orange-500/70', bg: 'from-orange-500/10 to-amber-500/10', dot: 'bg-orange-400', label: 'MM' },
  rabby:    { border: 'border-purple-500/40 hover:border-purple-500/70', bg: 'from-purple-500/10 to-violet-500/10', dot: 'bg-purple-400', label: 'R' },
  injected: { border: 'border-primary/30 hover:border-primary/60',       bg: 'from-primary/10 to-accent/10',       dot: 'bg-primary',    label: '⬡' },
}

export function WalletConnect({ onConnect, isConnected, address, balance, chainId, onDisconnect }: WalletConnectProps) {
  const [showDialog, setShowDialog] = useState(false)
  const [detectedWallets, setDetectedWallets] = useState<DetectedWallet[]>([])

  useEffect(() => {
    const open = () => setShowDialog(true)
    window.addEventListener(OPEN_WALLET_PICKER, open)
    return () => window.removeEventListener(OPEN_WALLET_PICKER, open)
  }, [])

  useEffect(() => {
    if (showDialog) {
      setDetectedWallets(detectWallets())
    }
  }, [showDialog])

  const connectPrivy = useCallback(() => onConnect(''), [onConnect])
  const privySync = privyEnabled ? (
    <Suspense fallback={null}><PrivySync isConnected={!!isConnected} onConnect={connectPrivy} /></Suspense>
  ) : null

  const handleWalletSelect = (wallet: DetectedWallet) => {
    mantleService.setPreferredProvider(wallet.provider)
    setShowDialog(false)
    onConnect('')
  }

  if (isConnected && address) {
    const chain = getChain(chainId ?? DEFAULT_CHAIN_ID)
    const symbol = chain?.nativeSymbol ?? ''
    const short = `${address.slice(0, 6)}…${address.slice(-4)}`
    const copyAddress = () => {
      navigator.clipboard?.writeText(address).then(
        () => toast.success('Address copied'),
        () => toast.error('Could not copy the address'),
      )
    }
    // One compact button: address + balance at a glance, everything else
    // (copy, explorer, disconnect) one click away instead of crowding the header.
    return (
      <>
      {privySync}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-2 px-2.5 border-white/10 bg-white/[0.03] hover:bg-white/[0.06] font-mono text-xs"
            aria-label={`Wallet ${short}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
            <span className="text-foreground/90">{short}</span>
            <span className="hidden md:inline text-primary font-semibold">
              {(balance ?? 0).toFixed(4)} {symbol}
            </span>
            <CaretDown size={12} className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Connected wallet</p>
            <p className="font-mono text-xs break-all text-foreground/90">{address}</p>
            <p className="font-mono text-xs text-primary font-semibold">
              {(balance ?? 0).toFixed(4)} {symbol}
              {chain && <span className="text-muted-foreground font-normal"> · {chain.name}</span>}
            </p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={copyAddress}>
            <Copy size={14} /> Copy address
          </DropdownMenuItem>
          {chain?.explorerUrl && (
            <DropdownMenuItem asChild>
              <a href={`${chain.explorerUrl}/address/${address}`} target="_blank" rel="noreferrer">
                <ArrowSquareOut size={14} /> View on explorer
              </a>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onDisconnect} className="text-destructive focus:text-destructive">
            <SignOut size={14} /> Disconnect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </>
    )
  }

  return (
    <>
      {privySync}
      <Button
        onClick={() => setShowDialog(true)}
        data-wallet-trigger
        size="sm"
        className="h-8 bg-gradient-to-r from-primary to-accent hover:opacity-90 font-semibold shadow-lg shadow-primary/30"
      >
        <Wallet className="mr-1.5" weight="duotone" />
        <span className="hidden sm:inline">Connect Wallet</span>
        <span className="sm:hidden">Connect</span>
      </Button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="glass-card border-2 border-primary/30 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-primary via-accent to-secondary bg-clip-text text-transparent">
              Connect your wallet
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Pick a wallet. You can switch networks from the header after connecting.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 mt-4">
            {detectedWallets.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <WarningCircle size={36} className="text-muted-foreground" weight="duotone" />
                <p className="text-sm text-muted-foreground">No compatible wallet detected.</p>
                <div className="flex gap-2 text-xs">
                  <a
                    href="https://metamask.io/download/"
                    target="_blank"
                    rel="noreferrer"
                    className="underline text-primary hover:text-primary/80"
                  >
                    Install MetaMask
                  </a>
                  <span className="text-muted-foreground">or</span>
                  <a
                    href="https://www.okx.com/web3"
                    target="_blank"
                    rel="noreferrer"
                    className="underline text-blue-400 hover:text-blue-300"
                  >
                    Install OKX Wallet
                  </a>
                </div>
              </div>
            ) : (
              detectedWallets.map((wallet) => {
                const style = WALLET_STYLES[wallet.id]
                return (
                  <motion.div key={wallet.id} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                    <Button
                      onClick={() => handleWalletSelect(wallet)}
                      className={`w-full h-16 bg-gradient-to-r ${style.bg} border-2 ${style.border} transition-all`}
                    >
                      <div className={`w-8 h-8 rounded-full ${style.bg} border ${style.border} flex items-center justify-center mr-3 text-xs font-bold`}>
                        {style.label}
                      </div>
                      <div className="text-left">
                        <p className="font-bold text-foreground">{wallet.name}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                          Detected · EIP-1193
                        </p>
                      </div>
                    </Button>
                  </motion.div>
                )
              })
            )}

            {privyEnabled && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="h-px flex-1 bg-border/50" />no wallet?<span className="h-px flex-1 bg-border/50" />
                </div>
                <Suspense fallback={null}>
                  <PrivyLoginButton onStart={() => setShowDialog(false)} />
                </Suspense>
              </div>
            )}

            <div className="pt-3 border-t border-border/30">
              <p className="text-xs text-muted-foreground text-center">
                Supports MetaMask, OKX Wallet, Rabby, and any EIP-1193 compatible wallet
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
