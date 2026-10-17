import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { getSupportedChains, getChain } from '@/lib/blockchain/chains'

interface ChainSelectorProps {
  selectedChainId: number
  onChainChange: (chainId: number) => void
}

export function ChainSelector({ selectedChainId, onChainChange }: ChainSelectorProps) {
  const chains = getSupportedChains()
  const current = getChain(selectedChainId)

  return (
    <Select
      value={String(selectedChainId)}
      onValueChange={(v) => onChainChange(Number(v))}
    >
      {/* The trigger shows the short name so it never truncates into the wallet
          button; the full network name lives in the list and the tooltip. */}
      <SelectTrigger
        className="h-8 w-auto gap-1.5 px-2.5 text-xs font-mono border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
        title={current?.name}
        aria-label={current ? `Network: ${current.name}` : 'Select network'}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          {current && (
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: current.color }} />
          )}
          <span className="truncate">{current?.shortName ?? 'Network'}</span>
        </span>
      </SelectTrigger>
      <SelectContent align="end">
        {chains.map((chain) => (
          <SelectItem key={chain.chainId} value={String(chain.chainId)}>
            <span className="flex items-center gap-2 text-xs font-mono">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: chain.color }} />
              {chain.name}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
