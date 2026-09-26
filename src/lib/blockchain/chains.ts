/**
 * MAEF Supported Chains — single source of truth.
 * Add new chains here; frontend + backend both reference this config.
 *
 * Contract addresses come from env (VITE_CONTRACT_ADDRESS_<chainId>) so a
 * redeploy is a Vercel env change, not a code change. The literal below each
 * one is the currently deployed fallback, so a missing env var can never
 * silently resolve to the zero address.
 */

function contractFor(chainId: number, fallback: string): string {
  const fromEnv = import.meta.env[`VITE_CONTRACT_ADDRESS_${chainId}`] as string | undefined
  return fromEnv?.trim() || fallback
}

export interface ChainConfig {
  chainId: number
  name: string
  shortName: string
  nativeSymbol: string
  rpcUrl: string
  /** Fallbacks handed to wallet_addEthereumChain so MetaMask can fail over. */
  rpcUrls?: string[]
  explorerUrl: string
  contractAddress: string
  spawnFee: string        // in native token units — sent as tx value AND must match the
                          // deployed contract's spawnFee() (see setFees() in AsajuAgentV5.sol)
  /** Portion of spawnFee the contract forwards to the new agent as gas.
   *  Must match the deployed agentProvision(); derived per chain from live gas
   *  price by contracts/scripts/calibrate-fees.js, not picked by hand. */
  agentProvision: string
  color: string           // brand color for UI badges
  testnet: boolean
}

export const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  // ── Active ────────────────────────────────────────────────────────────────
  5003: {
    chainId: 5003,
    name: 'Mantle Sepolia',
    shortName: 'Mantle',
    nativeSymbol: 'MNT',
    rpcUrl: 'https://rpc.sepolia.mantle.xyz',
    explorerUrl: 'https://explorer.sepolia.mantle.xyz',
    contractAddress: contractFor(5003, '0x66fD8b5411856D42c08D9356e879a6e7dF0c9419'),
    spawnFee: '1',
    agentProvision: '0.5',
    color: '#00F3FF',
    testnet: true,
  },
  11155111: {
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    shortName: 'Ethereum',
    nativeSymbol: 'ETH',
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    explorerUrl: 'https://sepolia.etherscan.io',
    contractAddress: contractFor(11155111, '0x0fE75B47bFE360A305F5D56607d976448fF7c9e7'),  // V5, 25 Sep 2026
    spawnFee: '0.01',       // set on-chain 26 Sep via calibrate-fees.js
    agentProvision: '0.005',  // ~26 mints of runway at current Sepolia gas
    color: '#8B5CF6',
    testnet: true,
  },
  97: {
    chainId: 97,
    name: 'BNB Smart Chain Testnet',
    shortName: 'BNB',
    nativeSymbol: 'tBNB',
    rpcUrl: 'https://bsc-testnet-rpc.publicnode.com',
    rpcUrls: [
      'https://bsc-testnet-rpc.publicnode.com',
      'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
    ],
    explorerUrl: 'https://testnet.bscscan.com',
    contractAddress: contractFor(97, '0x4cCB2f96f66B4E06E5A78da25797b7386814C313'),  // V5, 25 Sep 2026
    spawnFee: '0.01',       // set on-chain 26 Sep via calibrate-fees.js
    agentProvision: '0.005',  // far past the runway floor, but a balance the owner can actually see
    color: '#F0B90B',
    testnet: true,
  },
}

/**
 * Auto-replenish thresholds, as a share of what the chain provisions a new
 * agent. Mantle's long-standing 0.05 / 0.1 were exactly 10% and 20% of its
 * 0.5 provision — expressing them as ratios keeps that behaviour while making
 * the numbers correct on chains that provision a different amount.
 */
export function autoReplenish(chainId: number): { threshold: number; refill: number } {
  const provision = Number(getChain(chainId)?.agentProvision ?? 0)
  return { threshold: provision * 0.1, refill: provision * 0.2 }
}

/** Explorer link for a transaction. */
export function txUrl(chainId: number, txHash: string): string {
  const chain = getChain(chainId)
  if (!chain) return ''
  return `${chain.explorerUrl.replace(/\/$/, '')}/tx/${txHash}`
}

/**
 * Explorer link for one NFT. Blockscout (Mantle) and the Etherscan family
 * (Sepolia, BscScan) use incompatible URL shapes, so callers must not build
 * these by hand — doing so is how the mint dialog ended up pointing every
 * chain's NFT at Mantle's contract.
 */
export function nftUrl(chainId: number, tokenId: string | number): string {
  const chain = getChain(chainId)
  if (!chain || !chain.contractAddress) return ''
  const base = chain.explorerUrl.replace(/\/$/, '')
  if (base.includes('mantle.xyz')) {
    return `${base}/token/${chain.contractAddress}?type=nft&tokenId=${tokenId}`
  }
  return `${base}/nft/${chain.contractAddress}/${tokenId}`
}

export const DEFAULT_CHAIN_ID = 97


export function getChain(chainId: number): ChainConfig | undefined {
  return CHAIN_CONFIGS[chainId]
}

/** Only chains with a contract address — a chain awaiting deploy is not selectable. */
export function getSupportedChains(): ChainConfig[] {
  return Object.values(CHAIN_CONFIGS).filter(c => c.contractAddress !== '')
}
