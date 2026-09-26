import { useState } from 'react'
import { Agent } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Lightning, Wallet, Warning } from '@phosphor-icons/react'
import { motion } from 'framer-motion'
import { getChain } from '@/lib/blockchain/chains'

interface BreedingCooldownBoostProps {
  agent: Agent
  userBalance: number
  onBoost: (agentId: string) => void
}

// BOOST_COST is chain-agnostic at the contract level (constant 0.5 native),
// but we display it in the agent's active chain currency so the dialog reads
// correctly whether the user is on Mantle (MNT) or BNB (tBNB).
const BOOST_COST = 0.5

export function BreedingCooldownBoost({ agent, userBalance, onBoost }: BreedingCooldownBoostProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  // Display currency follows the agent's chain (e.g. MNT on Mantle Sepolia,
  // tBNB on BNB testnet, ETH on Ethereum Sepolia) — never assume MNT.
  const currency = getChain(agent.chainId ?? 5003)?.nativeSymbol ?? 'token'

  const handleConfirm = async () => {
    setIsProcessing(true)
    await new Promise(resolve => setTimeout(resolve, 1500))
    onBoost(agent.id)
    setIsProcessing(false)
    setDialogOpen(false)
  }

  const canAfford = userBalance >= BOOST_COST

  return (
    <>
      <Button
        onClick={() => setDialogOpen(true)}
        size="sm"
        className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold shadow-lg shadow-amber-500/30 group"
      >
        <Lightning className="mr-2 group-hover:animate-pulse" weight="fill" size={16} />
        Boost Recovery
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="glass-card border-2 border-amber-500/30 max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-2xl">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500/30 to-orange-500/30 border-2 border-amber-500/40 flex items-center justify-center">
                <Lightning size={24} className="text-amber-500" weight="fill" />
              </div>
              <span className="bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">
                Neural Recovery Boost
              </span>
            </DialogTitle>
            <DialogDescription className="text-foreground/70 text-base">
              Accelerate your agent's neural recovery using advanced blockchain-based restoration protocols.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="glass-card p-4 border border-primary/30 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Agent Name</span>
                <span className="font-bold text-primary">{agent.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Current Status</span>
                <span className="font-mono text-amber-500 text-sm">Cooldown Active</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Boost Cost</span>
                <span className="font-bold font-mono text-amber-500">{BOOST_COST} {currency}</span>
              </div>
            </div>

            <div className="glass-card p-4 border border-secondary/30 space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <Wallet size={18} className="text-secondary" weight="duotone" />
                <span className="font-bold text-secondary">Your Balance</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Available {currency}</span>
                <span className="font-bold font-mono text-lg">{userBalance.toFixed(2)} {currency}</span>
              </div>
              {!canAfford && (
                <div className="flex items-center gap-2 text-destructive text-sm mt-2">
                  <Warning size={16} weight="fill" />
                  <span>Insufficient balance</span>
                </div>
              )}
            </div>

            {canAfford && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-card p-4 border-2 border-amber-500/50 bg-gradient-to-br from-amber-500/10 to-orange-500/10"
              >
                <div className="flex items-start gap-3">
                  <Lightning size={20} className="text-amber-500 mt-0.5 flex-shrink-0" weight="fill" />
                  <div className="flex-1">
                    <h4 className="font-bold text-amber-500 text-sm mb-1">Instant Recovery Effect</h4>
                    <p className="text-xs text-foreground/80">
                      Your agent will immediately become ready for fusion. The cooldown timer will be completely bypassed using advanced {currency}-powered neural restoration.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={!canAfford || isProcessing}
              className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold shadow-lg shadow-amber-500/30"
            >
              {isProcessing ? (
                <>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    className="mr-2"
                  >
                    <Lightning size={16} weight="fill" />
                  </motion.div>
                  Processing...
                </>
              ) : (
                <>
                  <Lightning className="mr-2" weight="fill" size={16} />
                  Confirm & Boost ({BOOST_COST} {currency})
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
