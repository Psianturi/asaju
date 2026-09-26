import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { mantleService } from '@/lib/blockchain/mantleService'

export interface BlockchainState {
  isConnected: boolean
  address: string | null
  network: string | null
  chainId: number | null
  isConnecting: boolean
  balance: string
  error: string | null
}

interface BlockchainContextValue extends BlockchainState {
  connectWallet: (chainId?: number) => Promise<string>
  disconnectWallet: () => void
  refreshBalance: (chainId?: number) => Promise<string>
  getExplorerUrl: (txHash: string, chainId?: number) => string
  getAddressExplorerUrl: (address: string, chainId?: number) => string
  getBalance: (address: string, chainId?: number) => Promise<string>
}

const BlockchainContext = createContext<BlockchainContextValue | null>(null)

// Every consumer must share one connection state — a component-local useState
// here previously meant each caller (App, DashboardView, NotificationBell) had
// its own copy that never saw a connect made through a different instance.
export function BlockchainProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BlockchainState>({
    isConnected: false,
    address: null,
    network: null,
    chainId: null,
    isConnecting: false,
    balance: '0.0',
    error: null
  })

  const connectWallet = useCallback(async (chainId?: number) => {
    setState(prev => ({ ...prev, isConnecting: true, error: null }))

    try {
      const { address, network } = await mantleService.connectWallet(chainId)
      const balance = await mantleService.getBalance(address, chainId)

      setState({
        isConnected: true,
        address,
        network,
        chainId: chainId ?? null,
        isConnecting: false,
        balance,
        error: null
      })

      return address
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to connect wallet'
      setState(prev => ({
        ...prev,
        isConnecting: false,
        error: errorMessage
      }))
      throw error
    }
  }, [])

  const disconnectWallet = useCallback(() => {
    mantleService.disconnect()
    setState({
      isConnected: false,
      address: null,
      network: null,
      chainId: null,
      isConnecting: false,
      balance: '0.0',
      error: null
    })
  }, [])

  const refreshBalance = useCallback(async (chainId?: number) => {
    if (state.address) {
      const balance = await mantleService.getBalance(state.address, chainId)
      setState(prev => ({ ...prev, balance, chainId: chainId ?? prev.chainId }))
      return balance
    }
    return '0.0'
  }, [state.address])

  const getExplorerUrl = useCallback((txHash: string, chainId?: number) => {
    return mantleService.getExplorerUrl(txHash, chainId)
  }, [])

  const getAddressExplorerUrl = useCallback((address: string, chainId?: number) => {
    return mantleService.getAddressExplorerUrl(address, chainId)
  }, [])

  const getBalance = useCallback(async (address: string, chainId?: number): Promise<string> => {
    return mantleService.getBalance(address, chainId)
  }, [])

  const value: BlockchainContextValue = {
    ...state,
    connectWallet,
    disconnectWallet,
    refreshBalance,
    getExplorerUrl,
    getAddressExplorerUrl,
    getBalance,
  }

  return <BlockchainContext.Provider value={value}>{children}</BlockchainContext.Provider>
}

export function useBlockchain(): BlockchainContextValue {
  const ctx = useContext(BlockchainContext)
  if (!ctx) {
    throw new Error('useBlockchain must be used within a BlockchainProvider')
  }
  return ctx
}
