import { useEffect, useState } from 'react'
import { ethers } from 'ethers'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Agent } from '@/lib/types'
import { Storefront, Warning, ArrowRight, SealCheck } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { getChain, DEFAULT_CHAIN_ID, marketplaceCurrency, supportsMarketplace } from '@/lib/blockchain/chains'
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

type OnchainListing = { listed: boolean; seller: string; price: bigint }

export function MarketplaceListingDialog({ open, onOpenChange, agent, sellerWallet, onChanged }: MarketplaceListingDialogProps) {
  const chainId = agent.chainId ?? DEFAULT_CHAIN_ID
  const chain = getChain(chainId)
  const currency = marketplaceCurrency(chainId) || 'token'
  const decimals = chain?.paymentTokenDecimals ?? 18
  const canList = supportsMarketplace(chainId) && !!chain?.marketplaceAddress
  const [price, setPrice] = useState('')
  const [buyer, setBuyer] = useState('')
  const [busy, setBusy] = useState<'list' | 'cancel' | 'transfer' | null>(null)
  // The escrow is the only source of truth for a listing, so the dialog reads
  // it directly instead of trusting the backend board.
  const [listing, setListing] = useState<OnchainListing | null>(null)

  useEffect(() => {
    if (!open || !canList) return
    let cancelled = false
    mantleService.getListing(agent.walletAddress, chainId).then((l) => {
      if (!cancelled) setListing(l)
    })
    return () => { cancelled = true }
  }, [open, canList, agent.walletAddress, chainId])

  const listedBySomeoneElse = listing?.listed && listing.seller.toLowerCase() !== sellerWallet.toLowerCase()

  // Mirror the new on-chain state into the board right away; the indexer would
  // catch up within a poll anyway, so a failed sync is only a delay.
  const syncBoard = async () => {
    const res = await cloudRunService.syncListing(agent.id)
    if (!res.ok) console.warn('[marketplace] board sync deferred to indexer:', res.error)
  }

  const handleList = async () => {
    const p = parseFloat(price)
    if (isNaN(p) || p <= 0) {
      toast.error('Enter a valid price greater than 0')
      return
    }
    setBusy('list')
    toast.info('Confirm the listing in your wallet…')
    const res = await mantleService.listAgentForSale(agent.walletAddress, price.trim(), chainId)
    if (res.success) {
      await syncBoard()
      toast.success(`${agent.name} listed for ${p} ${currency}`, {
        description: 'Buyers can now purchase it through the escrow.',
      })
      onChanged?.()
      onOpenChange(false)
    } else {
      toast.error('Could not list agent', { description: res.error?.slice(0, 150) })
    }
    setBusy(null)
  }

  const handleCancel = async () => {
    setBusy('cancel')
    toast.info('Confirm the cancellation in your wallet…')
    const res = await mantleService.cancelAgentListing(agent.walletAddress, chainId)
    if (res.success) {
      await syncBoard()
      toast.success('Listing cancelled')
      onChanged?.()
      onOpenChange(false)
    } else {
      toast.error('Could not cancel listing', { description: res.error?.slice(0, 150) })
    }
    setBusy(null)
  }

  const handleTransfer = async () => {
    const to = buyer.trim()
    if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
      toast.error('Enter a valid wallet address (0x…)')
      return
    }
    setBusy('transfer')
    toast.info('Confirm the transfer in your wallet…')
    const res = await mantleService.transferAgentOwnership(agent.walletAddress, to, chainId)
    setBusy(null)
    if (res.success) {
      if (listing?.listed) await syncBoard()
      toast.success('Ownership transferred on-chain ✓', {
        description: 'The new owner will see the agent after the next sync.',
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
            Listing is signed from your wallet and held by the on-chain escrow. When a buyer pays,
            ownership moves to them in the same transaction — no one has to trust anyone.
          </DialogDescription>
        </DialogHeader>

        {!canList ? (
          <div className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2">
            <Warning size={14} weight="fill" className="text-amber-400 shrink-0 mt-0.5" />
            <span className="text-xs text-amber-300/90 leading-snug">
              {chain?.name ?? `Chain ${chainId}`} has no marketplace escrow. Agents can be sold on
              BNB Testnet, Ethereum Sepolia and Robinhood Chain Testnet.
            </span>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">1 · Escrow listing</p>
              {listing?.listed && !listedBySomeoneElse ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2">
                  <span className="flex items-center gap-1.5 text-xs text-emerald-300">
                    <SealCheck size={14} weight="fill" />
                    Listed for {ethers.formatUnits(listing.price, decimals)} {currency}
                  </span>
                  <Button size="sm" variant="outline" onClick={handleCancel} disabled={busy !== null}>
                    {busy === 'cancel' ? 'Cancelling…' : 'Cancel listing'}
                  </Button>
                </div>
              ) : (
                <>
                  {listedBySomeoneElse && (
                    <p className="text-[11px] text-amber-300/90">
                      A previous owner's listing is still on the escrow. It can't be bought while you own
                      the agent; listing again replaces it once they cancel.
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder={`Price in ${currency}`}
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                    />
                    <Button onClick={handleList} disabled={busy !== null || !!listedBySomeoneElse} className="shrink-0">
                      {busy === 'list' ? 'Listing…' : 'List'}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground/70">
                    The marketplace fee is deducted from the sale price when it sells.
                  </p>
                </>
              )}
            </div>

            <div className="space-y-2 pt-1 border-t border-border/40">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">2 · Direct transfer (no payment)</p>
              <div className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-2 py-1.5">
                <Warning size={13} weight="fill" className="text-amber-400 shrink-0 mt-0.5" />
                <span className="text-[10px] text-amber-300/90 leading-snug">
                  Moves the agent to another wallet for free — for gifts or moving between your own
                  wallets. To get paid, use the escrow listing above. This cannot be undone.
                </span>
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Recipient wallet 0x…"
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
        )}
      </DialogContent>
    </Dialog>
  )
}
