import { ethers, BrowserProvider, Contract, JsonRpcProvider, TransactionReceipt } from 'ethers'
import { GAS_LIMITS } from './config'
import { MAEF_NFT_ABI } from './abi'
import { DEFAULT_CHAIN_ID, getChain } from './chains'

/**
 * Subset of AsajuMarketplace / AsajuMarketplaceERC20 the UI needs. Both variants
 * share list/cancel and differ only in how buy() is paid for — which the
 * service handles, so callers never branch on settlement type.
 */
const MARKETPLACE_ABI = [
  'function listings(address agentWallet) view returns (address seller, uint256 price, bool active)',
  'function list(address agentWallet, uint256 price)',
  'function cancel(address agentWallet)',
  'function buy(address agentWallet) payable',
  'function agentContract() view returns (address)',
  'function feeBps() view returns (uint256)',
  'event AgentSold(address indexed agentWallet, address indexed seller, address indexed buyer, uint256 price, uint256 fee)',
] as const

/** Minimal ERC-20 surface for the allowance grant before an ERC-20 buy. */
const ERC20_MIN_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function balanceOf(address account) view returns (uint256)',
] as const

type EthProvider = {
  isMetaMask?: boolean
  isOKExWallet?: boolean
  isRabby?: boolean
  isBitKeep?: boolean
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on: (event: string, callback: (...args: unknown[]) => void) => void
  removeListener: (event: string, callback: (...args: unknown[]) => void) => void
}

declare global {
  interface Window {
    ethereum?: EthProvider
    okxwallet?: EthProvider      // OKX Wallet primary injection point
    bitkeep?: {                  // Bitget Wallet injection point
      ethereum?: EthProvider
    }
  }
}

export interface DetectedWallet {
  id: 'okx' | 'metamask' | 'rabby' | 'bitget' | 'injected'
  name: string
  provider: EthProvider
}

// Detects all EIP-1193 providers currently injected in the browser.
export function detectWallets(): DetectedWallet[] {
  const wallets: DetectedWallet[] = []
  if (typeof window === 'undefined') return wallets

  // OKX Wallet (priority injection point)
  if (window.okxwallet) {
    wallets.push({ id: 'okx', name: 'OKX Wallet', provider: window.okxwallet })
  }

  // Bitget Wallet (bitkeep.ethereum injection point)
  if (window.bitkeep?.ethereum) {
    wallets.push({ id: 'bitget', name: 'Bitget Wallet', provider: window.bitkeep.ethereum })
  }

  // Standard window.ethereum (MetaMask, Rabby, Coinbase, etc.)
  if (window.ethereum) {
    if (window.ethereum.isRabby) {
      wallets.push({ id: 'rabby', name: 'Rabby', provider: window.ethereum })
    } else if (window.ethereum.isMetaMask) {
      wallets.push({ id: 'metamask', name: 'MetaMask', provider: window.ethereum })
    } else {
      wallets.push({ id: 'injected', name: 'Browser Wallet', provider: window.ethereum })
    }
  }
  return wallets
}

// Falls back to best-available provider when no preferred one is set.
// Priority: OKX Wallet → Bitget Wallet → window.ethereum (MetaMask, Rabby, Coinbase, etc.)
function resolveProvider(): EthProvider | undefined {
  return window.okxwallet ?? window.bitkeep?.ethereum ?? window.ethereum
}

export interface SpawnAgentOnChainResult {
  success: boolean
  transactionHash?: string
  contractAddress?: string
  provisionAmount?: string
  error?: string
  gasUsed?: string
}

export interface TopUpGasResult {
  success: boolean
  transactionHash?: string
  amount?: string
  gasUsed?: string
  error?: string
}

export class MantleBlockchainService {
  private provider: BrowserProvider | null = null
  private signer: ethers.Signer | null = null
  private contract: Contract | null = null
  private currentChainId = DEFAULT_CHAIN_ID
  private preferredProvider: EthProvider | null = null

  // Called by WalletConnect picker before connectWallet() to set a specific provider.
  setPreferredProvider(provider: EthProvider | null): void {
    this.preferredProvider = provider
  }

  private getEthProvider(): EthProvider | undefined {
    return this.preferredProvider ?? resolveProvider()
  }

  private getChainConfig(chainId: number) {
    const chain = getChain(chainId)
    if (!chain) {
      throw new Error(`Unsupported network: ${chainId}`)
    }
    return chain
  }

  async connectWallet(chainId = DEFAULT_CHAIN_ID): Promise<{ address: string; network: string }> {
    const ethProvider = this.getEthProvider()
    if (!ethProvider) {
      throw new Error('No Web3 wallet found. Please install MetaMask, OKX Wallet, or another EVM-compatible wallet.')
    }

    try {
      const accounts = await ethProvider.request({
        method: 'eth_requestAccounts'
      }) as string[]

      if (!accounts || accounts.length === 0) {
        throw new Error('No accounts found. Please unlock your wallet.')
      }

      await this.activateChain(chainId)
      const address = await this.signer!.getAddress()
      const chain = this.getChainConfig(chainId)

      return {
        address,
        network: chain.name
      }
    } catch (error) {
      console.error('Wallet connection error:', error)
      throw error
    }
  }

  private async activateChain(chainId: number): Promise<void> {
    await this.switchToNetwork(chainId)
    const ethProvider = this.getEthProvider()
    if (!ethProvider) {
      throw new Error('No wallet found')
    }

    // A BrowserProvider is bound to the wallet's currently selected chain.
    this.provider = new BrowserProvider(ethProvider as any)
    this.signer = await this.provider.getSigner()
    this.currentChainId = chainId
    this.initializeContract()
  }

  async switchToNetwork(chainId = DEFAULT_CHAIN_ID): Promise<void> {
    const ethProvider = this.getEthProvider()
    if (!ethProvider) {
      throw new Error('No wallet found')
    }

    const chain = this.getChainConfig(chainId)

    try {
      await ethProvider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${chain.chainId.toString(16)}` }]
      })
    } catch (switchError: unknown) {
      const error = switchError as { code?: number }
      if (error.code === 4902) {
        await this.addNetwork(chainId)
      } else {
        throw switchError
      }
    }
  }

  private async addNetwork(chainId: number): Promise<void> {
    const ethProvider = this.getEthProvider()
    if (!ethProvider) {
      throw new Error('No wallet found')
    }

    const chain = this.getChainConfig(chainId)

    await ethProvider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: `0x${chain.chainId.toString(16)}`,
          chainName: chain.name,
          nativeCurrency: {
            name: chain.nativeSymbol,
            symbol: chain.nativeSymbol,
            decimals: 18,
          },
          rpcUrls: chain.rpcUrls ?? [chain.rpcUrl],
          blockExplorerUrls: [chain.explorerUrl]
        }
      ]
    })
  }

  private initializeContract(): void {
    if (!this.signer || !this.provider) {
      throw new Error('Signer not initialized')
    }

    const contractAddress = this.getChainConfig(this.currentChainId).contractAddress

    if (contractAddress === '0x0000000000000000000000000000000000000000') {
      this.contract = null
      return
    }

    this.contract = new Contract(contractAddress, MAEF_NFT_ABI, this.signer)
  }

  getContractAddress(chainId = this.currentChainId): string {
    return this.getChainConfig(chainId).contractAddress
  }

  async spawnAgent(agentWallet: string, chainId = this.currentChainId): Promise<SpawnAgentOnChainResult> {
    await this.activateChain(chainId)
    if (!this.contract) {
      return {
        success: false,
        error: 'Contract is not initialized. Check wallet connection and VITE_NFT_CONTRACT_ADDRESS_SEPOLIA.'
      }
    }

    try {
      const chain = getChain(chainId)
      const spawnFee = chain?.spawnFee ?? '1'
      const tx = await this.contract.spawnAgent(agentWallet, {
        value: ethers.parseEther(spawnFee),
      })

      const receipt: TransactionReceipt = await tx.wait()
      const gasUsed = receipt.gasUsed.toString()
      const gasPrice = receipt.gasPrice || BigInt(0)
      const gasCost = (Number(gasUsed) * Number(gasPrice)) / 1e18

      return {
        success: true,
        transactionHash: receipt.hash,
        contractAddress: this.getContractAddress(chainId),
        provisionAmount: chain?.agentProvision ?? '0',
        gasUsed: gasCost.toFixed(6)
      }
    } catch (error) {
      console.error('Agent spawn transaction error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }
    }
  }

  /**
   * Activate a bred offspring — only the wallet that called breedAgents() can
   * do this (contract enforces msg.sender === breeder, no backend fallback on
   * V6). Mirrors spawnAgent(): called from the browser right after breeding
   * confirms, using the offspring wallet + on-chain offspring key the backend
   * already generated and returned in the breed response.
   */
  async spawnBredAgent(
    offspringWallet: string,
    offspringKeyHex: string,
    chainId = this.currentChainId,
  ): Promise<SpawnAgentOnChainResult> {
    await this.activateChain(chainId)
    if (!this.contract) {
      return { success: false, error: 'Contract is not initialized. Check wallet connection.' }
    }

    try {
      const chain = getChain(chainId)
      const tx = await this.contract.spawnBredAgent(offspringWallet, offspringKeyHex)
      const receipt: TransactionReceipt = await tx.wait()
      const gasUsed = receipt.gasUsed.toString()
      const gasPrice = receipt.gasPrice || BigInt(0)
      const gasCost = (Number(gasUsed) * Number(gasPrice)) / 1e18

      return {
        success: true,
        transactionHash: receipt.hash,
        contractAddress: this.getContractAddress(chainId),
        provisionAmount: chain?.agentProvision ?? '0',
        gasUsed: gasCost.toFixed(6),
      }
    } catch (error) {
      console.error('spawnBredAgent transaction error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }
    }
  }

  async transferAgentOwnership(
    agentWallet: string,
    newOwner: string,
    chainId = this.currentChainId,
  ): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    await this.activateChain(chainId)
    if (!this.contract) {
      return { success: false, error: 'Contract is not initialized. Check wallet connection.' }
    }
    try {
      const tx = await this.contract.transferAgentOwnership(agentWallet, newOwner)
      const receipt: TransactionReceipt = await tx.wait()
      return { success: true, transactionHash: receipt.hash }
    } catch (error) {
      console.error('transferAgentOwnership transaction error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error occurred' }
    }
  }

  // ── Marketplace escrow ─────────────────────────────────────────────────────

  /**
   * Read the marketplace escrow for a chain, or null when that chain has none
   * deployed. Both variants share the list/cancel surface; only buy() differs
   * (native `payable` vs ERC-20 allowance + transferFrom).
   */
  private marketplaceContract(chainId: number): Contract | null {
    const chain = getChain(chainId)
    if (!chain?.marketplaceAddress) return null
    return new Contract(
      chain.marketplaceAddress,
      MARKETPLACE_ABI,
      this.provider ?? this.signer,
    )
  }

  /** On-chain listing state for an agent. `price` is 0 when not listed. */
  async getListing(
    agentWallet: string,
    chainId = this.currentChainId,
  ): Promise<{ listed: boolean; seller: string; price: bigint }> {
    const market = this.marketplaceContract(chainId)
    if (!market) return { listed: false, seller: ethers.ZeroAddress, price: 0n }
    try {
      const l = await market.listings(agentWallet)
      return { listed: Boolean(l.active), seller: l.seller, price: l.price }
    } catch (error) {
      console.error('getListing failed:', error)
      return { listed: false, seller: ethers.ZeroAddress, price: 0n }
    }
  }

  /** List an agent for sale. Only the current on-chain owner may call this. */
  async listAgentForSale(
    agentWallet: string,
    price: string,
    chainId = this.currentChainId,
  ): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    await this.activateChain(chainId)
    const market = this.marketplaceContract(chainId)
    if (!this.signer) {
      return { success: false, error: 'Wallet signer is not initialized. Please reconnect your wallet.' }
    }
    if (!market) {
      return { success: false, error: `No marketplace escrow on chain ${chainId}.` }
    }
    try {
      const connected = market.connect(this.signer) as unknown as {
        list: (a: string, p: bigint) => Promise<{ wait: () => Promise<TransactionReceipt> }>
      }
      const tx = await connected.list(agentWallet, ethers.parseUnits(price, 18))
      const receipt: TransactionReceipt = await tx.wait()
      return { success: true, transactionHash: receipt.hash }
    } catch (error) {
      console.error('listAgentForSale transaction error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'List failed' }
    }
  }

  /** Cancel a live listing. Only the seller who created it may call this. */
  async cancelAgentListing(
    agentWallet: string,
    chainId = this.currentChainId,
  ): Promise<{ success: boolean; transactionHash?: string; error?: string }> {
    await this.activateChain(chainId)
    const market = this.marketplaceContract(chainId)
    if (!this.signer) {
      return { success: false, error: 'Wallet signer is not initialized. Please reconnect your wallet.' }
    }
    if (!market) {
      return { success: false, error: `No marketplace escrow on chain ${chainId}.` }
    }
    try {
      const connected = market.connect(this.signer) as unknown as {
        cancel: (a: string) => Promise<{ wait: () => Promise<TransactionReceipt> }>
      }
      const tx = await connected.cancel(agentWallet)
      const receipt: TransactionReceipt = await tx.wait()
      return { success: true, transactionHash: receipt.hash }
    } catch (error) {
      console.error('cancelAgentListing transaction error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Cancel failed' }
    }
  }

  /**
   * Buy a listed agent through the escrow. Native chains send `msg.value`;
   * ERC-20 chains (Robinhood/ASA) grant an exact allowance first so the
   * marketplace can pull the token, then call the same buy(). Returns the same
   * shape for both so callers never branch on settlement type.
   */
  async buyListedAgent(
    agentWallet: string,
    chainId = this.currentChainId,
  ): Promise<{
    success: boolean
    transactionHash?: string
    pricePaid?: string
    currency?: string
    error?: string
  }> {
    await this.activateChain(chainId)
    const chain = getChain(chainId)
    const market = this.marketplaceContract(chainId)
    if (!this.signer) {
      return { success: false, error: 'Wallet signer is not initialized. Please reconnect your wallet.' }
    }
    if (!market || !chain?.marketplaceAddress) {
      return { success: false, error: `No marketplace escrow on chain ${chainId}.` }
    }

    try {
      const listing = await this.getListing(agentWallet, chainId)
      if (!listing.listed) {
        return { success: false, error: 'This agent is not listed for sale.' }
      }
      const decimals = chain.paymentTokenDecimals ?? 18
      const currency = chain.paymentTokenSymbol || chain.nativeSymbol
      const connected = market.connect(this.signer) as unknown as {
        buy: (a: string, overrides?: Record<string, unknown>) => Promise<{ wait: () => Promise<TransactionReceipt> }>
      }

      let overrides: Record<string, unknown> = {}
      if (chain.paymentToken) {
        // ERC-20 settlement: approve the exact price so the pull can't fail on
        // allowance, and so a stale listing can't drain more than it should.
        const token = new Contract(
          chain.paymentToken,
          ERC20_MIN_ABI,
          this.signer,
        ) as unknown as {
          approve: (spender: string, amount: bigint) => Promise<{ wait: () => Promise<TransactionReceipt> }>
        }
        const approveTx = await token.approve(chain.marketplaceAddress, listing.price)
        await approveTx.wait()
        overrides = {}
      } else {
        overrides = { value: listing.price }
      }

      const tx = await connected.buy(agentWallet, overrides)
      const receipt = await tx.wait()
      return {
        success: true,
        transactionHash: receipt.hash,
        pricePaid: ethers.formatUnits(listing.price, chain.paymentTokenDecimals ?? 18),
        currency,
      }
    } catch (error) {
      console.error('buyListedAgent transaction error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Buy failed' }
    }
  }

  async topUpAgentGas(agentWallet: string, amount: number, chainId = this.currentChainId): Promise<TopUpGasResult> {
    await this.activateChain(chainId)
    if (!this.signer || !this.provider) {
      return {
        success: false,
        error: 'Wallet signer is not initialized. Please reconnect your wallet.'
      }
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return {
        success: false,
        error: 'Top-up amount must be greater than zero.'
      }
    }

    try {
      const tx = await this.signer.sendTransaction({
        to: agentWallet,
        value: ethers.parseEther(amount.toString()),
      })

      const receipt = await tx.wait()
      if (!receipt) {
        throw new Error('Transaction receipt not available')
      }
      const gasUsed = receipt.gasUsed.toString()
      const gasPrice = receipt.gasPrice || BigInt(0)
      const gasCost = (Number(gasUsed) * Number(gasPrice)) / 1e18

      return {
        success: true,
        transactionHash: receipt.hash,
        amount: amount.toFixed(4),
        gasUsed: gasCost.toFixed(6),
      }
    } catch (error) {
      console.error('Agent gas top-up transaction error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown top-up error occurred'
      }
    }
  }

  async signMessage(message: string): Promise<{ signerWallet: string; signature: string }> {
    if (!this.signer) {
      throw new Error('Wallet signer is not initialized. Please reconnect your wallet.')
    }

    return {
      signerWallet: await this.signer.getAddress(),
      signature: await this.signer.signMessage(message),
    }
  }

  async getBalance(address: string, chainId = this.currentChainId): Promise<string> {
    try {
      const chain = this.getChainConfig(chainId)
      const provider = new JsonRpcProvider(chain.rpcUrl)
      const balance = await provider.getBalance(address)
      return ethers.formatEther(balance)
    } catch (error) {
      console.error('Error fetching balance:', error)
      return '0.0'
    }
  }

  async getTotalMinted(): Promise<number> {
    if (!this.contract) {
      return 0
    }

    try {
      const total = await this.contract.getTotalMinted()
      return Number(total)
    } catch (error) {
      console.error('Error fetching total minted:', error)
      return 0
    }
  }

  async getAgentNFTs(agentWallet: string): Promise<string[]> {
    if (!this.contract) {
      return []
    }

    try {
      const tokenIds = await this.contract.getAgentTokenIds(agentWallet)
      return tokenIds.map((id: bigint) => id.toString())
    } catch (error) {
      console.error('Error fetching agent NFTs:', error)
      return []
    }
  }

  getExplorerUrl(txHash: string, chainId = this.currentChainId): string {
    return `${this.getChainConfig(chainId).explorerUrl}/tx/${txHash}`
  }

  getAddressExplorerUrl(address: string, chainId = this.currentChainId): string {
    return `${this.getChainConfig(chainId).explorerUrl}/address/${address}`
  }

  disconnect(): void {
    this.provider = null
    this.signer = null
    this.contract = null
    this.preferredProvider = null
  }
}

export const mantleService = new MantleBlockchainService()
