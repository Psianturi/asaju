/**
 * Backend URL.
 *
 * The dev URL is read first so a `dev` preview can point at the tagged Cloud Run
 * revision without touching the shared variable. Vercel warns that editing a
 * variable present in both environments removes it from the other one, so the
 * two are deliberately kept as separate names rather than one name edited in
 * two places.
 */
const backendUrl =
  import.meta.env.VITE_GCP_BACKEND_URL_DEV ||
  import.meta.env.VITE_GCP_BACKEND_URL ||
  'https://agentic-event-factory.run.app'

export const config = {
  backend: {
    url: backendUrl,
    projectId: import.meta.env.VITE_GCP_PROJECT_ID || 'agentic-event-factory',
    timeout: 55000,
    pollingInterval: 3000,
    maxPollAttempts: 200,
  },
  
  blockchain: {
    networkUrl: import.meta.env.VITE_MANTLE_NETWORK_URL || import.meta.env.VITE_MANTLE_NETWORK_RPC || 'https://rpc.mantle.xyz',
    chainId: parseInt(import.meta.env.VITE_CHAIN_ID || import.meta.env.VITE_MANTLE_CHAIN_ID || '5000'),
    explorerUrl: import.meta.env.VITE_EXPLORER_URL || 'https://explorer.mantle.xyz',
    networkName: 'Mantle Network',
    defaultGasLimit: parseInt(import.meta.env.VITE_DEFAULT_GAS_LIMIT || '500000'),
    gasPriceMultiplier: parseFloat(import.meta.env.VITE_GAS_PRICE_MULTIPLIER || '1.2'),
  },

  contracts: {
    nftAddress: import.meta.env.VITE_NFT_CONTRACT_ADDRESS || '',
    factoryAddress: import.meta.env.VITE_AGENT_FACTORY_CONTRACT_ADDRESS || '',
  },

  features: {
    enableBlockchain: import.meta.env.VITE_ENABLE_BLOCKCHAIN !== 'false',
    enableBreeding: import.meta.env.VITE_ENABLE_BREEDING !== 'false',
    enableMarketplace: import.meta.env.VITE_ENABLE_MARKETPLACE !== 'false',
    enablePolling: true,
    enableWisdomGeneration: true,
    maxEventsForWisdom: 5,
  },

  app: {
    environment: import.meta.env.VITE_ENVIRONMENT || (import.meta.env.DEV ? 'development' : 'production'),
    debugMode: import.meta.env.VITE_DEBUG_MODE === 'true' || import.meta.env.DEV,
  },

  ui: {
    toastDuration: 4000,
    animationDuration: 300,
    pollingIndicatorDelay: 1000,
  },
} as const

export type AppConfig = typeof config

export function isBackendAvailable(): boolean {
  return !!(
    import.meta.env.VITE_GCP_BACKEND_URL_DEV ||
    import.meta.env.VITE_GCP_BACKEND_URL
  )
}

export function isDevelopment(): boolean {
  return import.meta.env.DEV
}

export function isProduction(): boolean {
  return import.meta.env.PROD
}
