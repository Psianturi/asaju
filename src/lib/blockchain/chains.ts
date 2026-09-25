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
  explorerUrl: string
  contractAddress: string
  spawnFee: string        // in native token units — sent as tx value AND must match the
                          // deployed contract's spawnFee() (see setFees() in MAEFNFTV4.sol)
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
    spawnFee: '0.02',   // sized for typical Sepolia faucet drips; see setFees() in deploy-v5.js
    color: '#8B5CF6',
    testnet: true,
  },
  97: {
    chainId: 97,
    name: 'BNB Smart Chain Testnet',
    shortName: 'BNB',
    nativeSymbol: 'tBNB',
    rpcUrl: 'https://bsc-testnet-rpc.publicnode.com',
    explorerUrl: 'https://testnet.bscscan.com',
    contractAddress: contractFor(97, '0x4cCB2f96f66B4E06E5A78da25797b7386814C313'),  // V5, 25 Sep 2026
    spawnFee: '0.005',  // sized for tBNB faucet drips
    color: '#F0B90B',
    testnet: true,
  },
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
