import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Agent } from '@/lib/types'
import { Storefront, Warning, ArrowRight } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { getChain, DEFAULT_CHAIN_ID } from '@/lib/blockchain/chains'
import { cloudRunService } from '@/services/cloudRunService'
import { mantleService } from '@/lib/blockchain/mantleService'

interface MarketplaceListingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent: Agent
  sellerWallet: string
  /** Called after a successful list / cancel / transfer so the parent can refresh. */
  onChanged?: () => void
}

export function MarketplaceListingDialog({ open, onOpenChange, agent, sellerWallet, onChanged }: MarketplaceListingDialogProps) {
  const chainId = agent.chainId ?? DEFAULT_CHAIN_ID
  const currency = getChain(chainId)?.nativeSymbol ?? 'token'
  const [price, setPrice] = useState('')
  const [buyer, setBuyer] = useState('')
  const [busy, setBusy] = useState<'list' | 'cancel' | 'transfer' | null>(null)

  const handleList = async () => {
    const p = parseFloat(price)
    if (isNaN(p) || p <= 0) {
      toast.error('Enter a valid price greater than 0')
      return
    }
    setBusy('list')
    const res = await cloudRunService.listAgentForSale(agent.id, sellerWallet, p)
    setBusy(null)
    if (res.ok) {
      toast.success(`${agent.name} listed for ${p} ${currency}`)
      onChanged?.()
      onOpenChange(false)
    } else {
      toast.error('Could not list agent', { description: res.error })
    }
  }

  const handleCancel = async () => {
    setBusy('cancel')
    const res = await cloudRunService.cancelListing(agent.id, sellerWallet)
    setBusy(null)
    if (res.ok) {
      toast.success('Listing cancelled')
      onChanged?.()
      onOpenChange(false)
    } else {
      toast.error('Could not cancel listing', { description: res.error })
    }
  }

  const handleTransfer = async () => {
    const to = buyer.trim()
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
      toast.error('Enter a valid buyer wallet address (0x…)')
      return
    }
    setBusy('transfer')
    toast.info('Confirm the transfer in your wallet…')
    const res = await mantleService.transferAgentOwnership(agent.walletAddress, to, chainId)
    setBusy(null)
    if (res.success) {
      toast.success('Ownership transferred on-chain ✓', {
        description: 'The buyer will see the agent after the next sync.',
      })
      onChanged?.()
      onOpenChange(false)
    } else {
      toast.error('Transfer failed', { description: res.error?.slice(0, 150) })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Storefront size={18} weight="duotone" className="text-secondary" />
            Sell {agent.name}
          </DialogTitle>
          <DialogDescription>
            Listing shows your agent to buyers. Payment is arranged between you and the buyer —
            ASAJU does not hold funds yet.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">1 · List for sale</p>
            <div className="flex gap-2">
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder={`Price in ${currency}`}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
              <Button onClick={handleList} disabled={busy !== null} className="shrink-0">
                {busy === 'list' ? 'Listing…' : 'List'}
              </Button>
            </div>
            <button
              onClick={handleCancel}
              disabled={busy !== null}
              className="text-[11px] text-muted-foreground hover:text-destructive transition-colors"
            >
              Cancel an existing listing
            </button>
          </div>

          <div className="space-y-2 pt-1 border-t border-border/40">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">2 · Complete a sale</p>
            <div className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-2 py-1.5">
              <Warning size={13} weight="fill" className="text-amber-400 shrink-0 mt-0.5" />
              <span className="text-[10px] text-amber-300/90 leading-snug">
                Only transfer after you've received payment. This moves the agent to the buyer
                on-chain and cannot be undone.
              </span>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Buyer wallet 0x…"
                value={buyer}
                onChange={(e) => setBuyer(e.target.value)}
                className="font-mono text-xs"
              />
              <Button onClick={handleTransfer} disabled={busy !== null} variant="outline" className="shrink-0">
                {busy === 'transfer' ? 'Transferring…' : <>Transfer <ArrowRight size={14} className="ml-1" /></>}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
