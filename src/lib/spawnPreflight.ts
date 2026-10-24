import { parseEther, formatEther } from 'ethers'

/** Headroom on top of spawnFee for the transaction's own gas. */
export const SPAWN_GAS_HEADROOM_BPS = 500n // 5%

/** How much more the wallet needs to spawn, in wei; 0n when it has enough. */
export function spawnShortfall(balanceWei: bigint, spawnFee: string): bigint {
  const fee = parseEther(spawnFee)
  const needed = fee + (fee * SPAWN_GAS_HEADROOM_BPS) / 10_000n
  return balanceWei >= needed ? 0n : needed - balanceWei
}

export function formatShortfall(shortfallWei: bigint, symbol: string): string {
  const n = Number(formatEther(shortfallWei))
  return `${n < 0.0001 ? '<0.0001' : n.toFixed(4)} ${symbol}`
}

/** Turn wallet/RPC errors into a sentence a user can act on. */
export function describeSpawnError(error: unknown, symbol: string): string {
  const raw = error instanceof Error ? error.message : String(error ?? '')
  const text = raw.toLowerCase()
  if (text.includes('user rejected') || text.includes('user denied') || text.includes('action_rejected')) {
    return 'You cancelled the transaction in your wallet. No agent was created and nothing was charged.'
  }
  if (text.includes('insufficient funds')) {
    return `Not enough ${symbol} for the spawn fee plus gas. No agent was created and nothing was charged.`
  }
  if (text.includes('missing revert data') || text.includes('estimategas') || text.includes('call_exception')) {
    return `The network rejected the spawn transaction before sending it (usually not enough ${symbol}, or the fee changed). No agent was created and nothing was charged.`
  }
  return raw.length > 220 ? `${raw.slice(0, 220)}…` : raw || 'Agent deployment failed'
}
