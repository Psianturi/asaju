import { ArrowsLeftRight } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { getChain } from '@/lib/blockchain/chains'

/**
 * An agent lives on exactly one chain: its wallet, contract record and NFTs are
 * there. The wallet can be on another network, and every on-chain action
 * already asks the wallet to switch first — this banner just says so up front
 * instead of surprising the owner with a network prompt mid-action.
 */
export function NetworkMismatchBanner({
  agentName,
  agentChainId,
  currentChainId,
  onSwitchNetwork,
}: {
  agentName: string
  agentChainId: number
  currentChainId?: number
  onSwitchNetwork?: (chainId: number) => void
}) {
  if (currentChainId == null || currentChainId === agentChainId) return null
  const agentChain = getChain(agentChainId)
  const current = getChain(currentChainId)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3">
      <div className="flex items-start gap-2.5 min-w-0">
        <ArrowsLeftRight size={16} weight="bold" className="text-amber-300 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-100/90 leading-snug">
          <span className="font-semibold">{agentName}</span> lives on{' '}
          <span className="font-semibold">{agentChain?.name ?? `chain ${agentChainId}`}</span>. Your wallet is on{' '}
          {current?.name ?? `chain ${currentChainId}`} — any on-chain action will ask your wallet to switch first.
        </p>
      </div>
      {onSwitchNetwork && (
        <Button size="sm" variant="outline" onClick={() => onSwitchNetwork(agentChainId)} className="border-amber-500/40 text-amber-200 hover:bg-amber-500/10 shrink-0">
          Switch to {agentChain?.shortName ?? 'this network'}
        </Button>
      )}
    </div>
  )
}
