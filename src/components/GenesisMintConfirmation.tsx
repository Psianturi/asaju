import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Sparkle, Wallet, ShieldCheck, Lightning } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { getChain } from '@/lib/blockchain/chains'

interface GenesisMintConfirmationProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  userBalance: number
  chainId?: number
  onConfirm: () => void
}

export function GenesisMintConfirmation({ open, onOpenChange, userBalance, chainId, onConfirm }: GenesisMintConfirmationProps) {
  const [isProcessing, setIsProcessing] = useState(false)

  // Genesis mint cost follows the chain's spawnFee (set on-chain via setFees()).
  // We display it in the agent's active chain currency so the dialog reads
  // correctly whether the user is on Mantle (1 MNT) or BNB (0.002 tBNB).
  const chainConfig = getChain(chainId ?? 5003)
  const currency = chainConfig?.nativeSymbol ?? 'token'
  const genesisCost = parseFloat(chainConfig?.spawnFee ?? '1')
  // The split between platform fee and agent gas follows the same proportion
  // V5 uses on-chain — half for the agent's gas reserve, half kept by the platform.
  const agentProvision = genesisCost / 2
  const platformFee = genesisCost / 2

  const handleConfirm = async () => {
    if (userBalance < genesisCost) {
      toast.error('Insufficient balance', {
        description: `You need at least ${genesisCost} ${currency} to mint a Genesis Agent`
      })
      return
    }

    setIsProcessing(true)
    toast.info('Waiting for wallet signature...', {
      description: 'Please approve the transaction in your wallet'
    })

    await new Promise(resolve => setTimeout(resolve, 2000))

    onConfirm()
    
    setIsProcessing(false)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card border-2 border-primary/30 max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary via-accent to-secondary flex items-center justify-center animate-glow-pulse">
              <Sparkle className="text-background" weight="fill" size={20} />
            </div>
            <span>Mint Genesis Agent</span>
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            You are about to mint your first autonomous AI agent with its own smart account on Mantle Network
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 mt-4">
          <div className="glass-card p-5 border-2 border-primary/30 space-y-3">
            <div className="flex items-center gap-2 mb-3">
              <Wallet className="text-primary" weight="duotone" size={22} />
              <h4 className="font-bold text-foreground">Transaction Breakdown</h4>
            </div>
            
            <div className="space-y-2 text-sm">
              <div className="flex justify-between items-center py-2 border-b border-border/30">
                <span className="text-muted-foreground">Platform Fee</span>
                <span className="font-mono font-semibold text-foreground">{platformFee} {currency}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-border/30">
                <span className="text-muted-foreground">Agent Gas Provision</span>
                <span className="font-mono font-semibold text-foreground">{agentProvision} {currency}</span>
              </div>
              <div className="flex justify-between items-center py-3 bg-primary/10 -mx-5 px-5 rounded-b-lg">
                <span className="font-bold text-foreground">Total Cost</span>
                <span className="font-mono font-bold text-xl text-primary">{genesisCost} {currency}</span>
              </div>
            </div>
          </div>

          <div className="glass-card p-4 border border-accent/30 bg-accent/5 space-y-2">
            <div className="flex items-start gap-3">
              <Lightning className="text-accent flex-shrink-0 mt-0.5" weight="fill" size={20} />
              <div className="flex-1 text-xs text-foreground/90">
                <p className="font-semibold mb-1">Agent Gas Provision Explained:</p>
                <p className="leading-relaxed">
                  {agentProvision} {currency} will be deposited directly into your agent's autonomous smart account.
                  This allows the agent to execute transactions independently (video analysis, NFT minting) without requiring your signature each time.
                </p>
              </div>
            </div>
          </div>

          <div className="glass-card p-4 border border-green-500/30 bg-green-500/5 space-y-2">
            <div className="flex items-start gap-3">
              <ShieldCheck className="text-green-500 flex-shrink-0 mt-0.5" weight="fill" size={20} />
              <div className="flex-1 text-xs text-foreground/90">
                <p className="font-semibold mb-1">Genesis Agent Benefits:</p>
                <ul className="space-y-1 list-disc list-inside leading-relaxed">
                  <li>Unique Smart Account on Mantle Network</li>
                  <li>4 Specialized Sub-Agents (Secretary, Scribe, Social-Lite, Mint-Master)</li>
                    <li>Autonomous YouTube analysis & NFT minting</li>
                  <li>Wisdom Report unlocked after 5 events</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Your Balance</p>
              <p className="font-mono font-bold text-foreground">{userBalance.toFixed(4)} {currency}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">After Transaction</p>
              <p className="font-mono font-bold text-foreground">{Math.max(0, userBalance - genesisCost).toFixed(4)} {currency}</p>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              onClick={() => onOpenChange(false)}
              variant="outline"
              className="flex-1 border-border/50 hover:border-border"
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={userBalance < genesisCost || isProcessing}
              className="flex-1 bg-gradient-to-r from-primary via-accent to-secondary hover:opacity-90 font-semibold shadow-lg shadow-primary/30"
            >
              {isProcessing ? (
                <>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  >
                    <Sparkle className="mr-2" weight="fill" />
                  </motion.div>
                  Processing...
                </>
              ) : (
                <>
                  <Sparkle className="mr-2" weight="fill" />
                  Confirm & Mint
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
