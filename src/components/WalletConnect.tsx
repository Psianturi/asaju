import { useState, useEffect } from 'react'
import { getChain, DEFAULT_CHAIN_ID } from '@/lib/blockchain/chains'
import { Button } from '@/components/ui/button'
import { Wallet, CurrencyCircleDollar, WarningCircle } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { motion } from 'framer-motion'
import { detectWallets, DetectedWallet, mantleService } from '@/lib/blockchain/mantleService'

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
    if (showDialog) {
      setDetectedWallets(detectWallets())
    }
  }, [showDialog])

  const handleWalletSelect = (wallet: DetectedWallet) => {
    mantleService.setPreferredProvider(wallet.provider)
    setShowDialog(false)
    onConnect('')
  }

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-3">
        <div className="hidden md:flex flex-col items-end px-3 py-2 rounded-lg glass-card border-primary/20">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-0.5">User Wallet</p>
          <p className="text-xs font-mono text-foreground/90 mb-1">
            {address.slice(0, 6)}...{address.slice(-4)}
          </p>
          <div className="flex items-center gap-1.5">
            <CurrencyCircleDollar size={14} className="text-primary" weight="fill" />
            <p className="text-xs font-mono font-bold text-primary">
              {(balance ?? 0).toFixed(4)} {getChain(chainId ?? DEFAULT_CHAIN_ID)?.nativeSymbol ?? ''}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onDisconnect}
          className="glass-card border-primary/20 hover:border-destructive/40"
        >
          Disconnect
        </Button>
      </div>
    )
  }

  return (
    <>
      <Button
        onClick={() => setShowDialog(true)}
        data-wallet-trigger
        className="bg-gradient-to-r from-primary to-accent hover:opacity-90 font-semibold shadow-lg shadow-primary/30"
      >
        <Wallet className="mr-2" weight="duotone" />
        Connect Wallet
      </Button>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="glass-card border-2 border-primary/30 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold bg-gradient-to-r from-primary via-accent to-secondary bg-clip-text text-transparent">
              Connect to Mantle
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Select a wallet to connect to Mantle Network
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
