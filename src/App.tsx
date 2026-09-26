import { useState, useEffect, useCallback, startTransition } from 'react'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Toaster } from '@/components/ui/sonner'
import { NotificationBell } from '@/components/NotificationBell'
import { Agent, NFT, TerminalLog, Event, SubAgentType, MarketplaceAgent } from '@/lib/types'
import { cn, isAgentAutoScouting, countActualVideosAnalyzed } from '@/lib/utils'
import { buildScoutedOpportunities } from '@/lib/scoutUtils'
import { AnalyticsView } from '@/views/AnalyticsView'
import { VaultView } from '@/views/VaultView'
import { MarketplaceView } from '@/views/MarketplaceView'
import { AgentDetailView } from '@/views/AgentDetailView'
import { MyAgentsView } from '@/views/MyAgentsView'
import { DashboardView } from '@/views/DashboardView'
import { AgentCard } from '@/components/AgentCard'
import { AttendEventCard } from '@/components/AttendEventCard'
import { NFTCard } from '@/components/NFTCard'
import { SpawnAgentDialog } from '@/components/SpawnAgentDialog'
import { TerminalConsole } from '@/components/TerminalConsole'
import { WalletConnect } from '@/components/WalletConnect'
import { WisdomReportDialog } from '@/components/WisdomReportDialog'
import { AgentConfigDialog } from '@/components/AgentConfigDialog'
import { AgentChatDialog } from '@/components/AgentChatDialog'
import { NFTMetadataDialog } from '@/components/NFTMetadataDialog'
import { DataFlowBackground } from '@/components/DataFlowBackground'
import { BackendHealthModal } from '@/components/BackendHealthModal'
import { ArchitectureFlow } from '@/components/ArchitectureFlow'
import { SubAgentDelegation } from '@/components/SubAgentDelegation'
import { FeaturedWisdomFeed, type WisdomFeedItem } from '@/components/FeaturedWisdomFeed'
import { ContractDeploymentProgress } from '@/components/ContractDeploymentProgress'
import { ContractVerificationTracker } from '@/components/ContractVerificationTracker'
import { AgentEvolutionDialog } from '@/components/AgentEvolutionDialog'
import { TopUpGasDialog } from '@/components/TopUpGasDialog'
import { GenesisMintConfirmation } from '@/components/GenesisMintConfirmation'
import { AgentBreedingDialog } from '@/components/AgentBreedingDialog'
import { ProactiveScoutingPanel } from '@/components/ProactiveScoutingPanel'
import { ProposalModal } from '@/components/ProposalModal'
import { WisdomTimeline } from '@/components/WisdomTimeline'
import { ActivityLog } from '@/components/ActivityLog'
import { Robot, Wallet as WalletIcon, ChartLine, Globe, Plus, Brain, CloudArrowUp, FlowArrow, ShieldCheck, Storefront, Newspaper, Binoculars, House, Lightning } from '@phosphor-icons/react'
import maefLogo from '@/assets/maef-logo.png'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { useBlockchain } from '@/hooks/useBlockchain'
import { useScoutLogListener } from '@/hooks/useScoutLogListener'
import { useSubAgentTasks } from '@/hooks/useSubAgentTasks'
import { CloudRunAPIError, cloudRunService, validateEventUrl } from '@/services/cloudRunService'
import { ContractVerificationData, verificationService } from '@/lib/blockchain/verificationService'
import { CONTRACT_ADDRESSES } from '@/lib/blockchain/config'
import { mantleService } from '@/lib/blockchain/mantleService'
import { ChainSelector } from '@/components/ChainSelector'
import { NetworkMismatchAlert } from '@/components/NetworkMismatchAlert'
import { DEFAULT_CHAIN_ID, getChain } from '@/lib/blockchain/chains'
import { useNavigate } from 'react-router-dom'

function App() {
  const navigate = useNavigate()
  type PendingAttendContext = {
    agentId: string
    eventUrl: string
  }

  const [agents, setAgents] = useState<Agent[]>([])
  const ownedAgentIds = agents.map((a) => a.id).filter(Boolean)
  useScoutLogListener(ownedAgentIds)

  const [nfts, setNFTs] = useState<NFT[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [logs, setLogs] = useState<TerminalLog[]>([])
  const [walletConnected, setWalletConnected] = useState(false)
  const [walletAddress, setWalletAddress] = useState<string>()
  const [selectedChainId, setSelectedChainId] = useState(DEFAULT_CHAIN_ID)
  const [walletChainId, setWalletChainId] = useState<number | undefined>()
  type MainView = 'dashboard' | 'my-agents' | 'analytics' | 'vault' | 'marketplace'
  const HASH_TO_VIEW: Record<string, MainView> = { 'my-agents': 'my-agents', analytics: 'analytics', 'nft-vault': 'vault', marketplace: 'marketplace' }
  const VIEW_TO_HASH: Record<MainView, string> = { dashboard: '', 'my-agents': 'my-agents', analytics: 'analytics', vault: 'nft-vault', marketplace: 'marketplace' }
  const [mainView, setMainView] = useState<MainView>(() => {
    const hashView = HASH_TO_VIEW[window.location.hash.slice(1)]
    if (hashView) return hashView
    return 'dashboard'
  })
  // Agent detail sub-route: `#agent/<agentId>`. Independent from mainView so
  // navigating back from a detail view preserves the previous tab.
  const [agentDetailId, setAgentDetailId] = useState<string | null>(() => {
    const m = /^#agent\/([\w-]+)/.exec(window.location.hash)
    return m ? m[1] : null
  })
  useEffect(() => {
    const onHashChange = () => {
      const m = /^#agent\/([\w-]+)/.exec(window.location.hash)
      setAgentDetailId(m ? m[1] : null)
      const hashView = HASH_TO_VIEW[window.location.hash.slice(1)]
      if (hashView) setMainView(hashView)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  useEffect(() => {
    const hash = VIEW_TO_HASH[mainView]
    if (agentDetailId) {
      if (window.location.hash !== `#agent/${agentDetailId}`) {
        window.location.hash = `agent/${agentDetailId}`
      }
    } else if (hash) {
      window.location.hash = hash
    } else {
      history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [mainView, agentDetailId])

  // Auto-reconnect on page load if any EIP-1193 wallet is already authorized.
  const WALLET_SESSION_KEY = 'maef-wallet-session-at'
  const WALLET_LAST_ACTIVITY_KEY = 'maef-wallet-last-activity'
  const WALLET_SESSION_TTL = 20 * 60 * 60 * 1000 // 20 hours max session
  const WALLET_IDLE_TIMEOUT = 5 * 60 * 60 * 1000 // 5 hours idle timeout

  // Activity tracker: updates last activity timestamp to reset idle timeout
  const updateActivity = () => {
    if (walletConnected) {
      localStorage.setItem(WALLET_LAST_ACTIVITY_KEY, Date.now().toString())
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    const eth = window.okxwallet ?? window.ethereum
    if (!eth) return
    eth.request({ method: 'eth_accounts' })
      .then(async (accounts) => {
        if ((accounts as string[]).length === 0) return
        const savedAt = parseInt(localStorage.getItem(WALLET_SESSION_KEY) || '0')
        const lastActivity = parseInt(localStorage.getItem(WALLET_LAST_ACTIVITY_KEY) || '0')
        const now = Date.now()

        // Check both TTL and idle timeout
        const sessionExpired = now - savedAt >= WALLET_SESSION_TTL
        const idleExpired = now - lastActivity >= WALLET_IDLE_TIMEOUT

        if (sessionExpired || idleExpired) {
          localStorage.removeItem(WALLET_SESSION_KEY)
          localStorage.removeItem(WALLET_LAST_ACTIVITY_KEY)
        } else {
          // Silent reconnect on page load: activate whatever chain the wallet
          // is already on, instead of forcing it back to DEFAULT_CHAIN_ID.
          let detectedChainId: number | undefined
          try {
            const chainHex = (await eth.request({ method: 'eth_chainId' })) as string
            const parsed = parseInt(chainHex, 16)
            if (getChain(parsed)) detectedChainId = parsed
          } catch { /* fall back to default */ }
          handleWalletConnect('', detectedChainId)
        }
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // React to wallet account switches or lock events across all supported wallets.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const eth = window.okxwallet ?? window.ethereum
    if (!eth) return
    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as unknown[]
      if (accounts.length === 0) {
        handleWalletDisconnect()
      } else if ((accounts[0] as string)?.toLowerCase() !== walletAddress?.toLowerCase()) {
        handleWalletConnect('')
      }
    }
    eth.on('accountsChanged', onAccountsChanged)
    return () => eth.removeListener('accountsChanged', onAccountsChanged)
  }, [walletAddress]) // eslint-disable-line react-hooks/exhaustive-deps

  // Listen to chainChanged events - auto-sync when user switches network in wallet
  useEffect(() => {
    if (typeof window === 'undefined' || !walletConnected) return
    const eth = window.okxwallet ?? window.ethereum
    if (!eth) return
    
    const onChainChanged = (...args: unknown[]) => {
      const chainIdHex = args[0] as string
      const newChainId = parseInt(chainIdHex, 16)
      setWalletChainId(newChainId)
      setSelectedChainId(newChainId)
      const chain = getChain(newChainId)
      if (chain) {
        toast.info(`Network changed to ${chain.name}`)
      } else {
        toast.warning(`Switched to unsupported chain ${newChainId}`)
      }
    }
    
    eth.on('chainChanged', onChainChanged)
    return () => eth.removeListener('chainChanged', onChainChanged)
  }, [walletConnected]) // eslint-disable-line react-hooks/exhaustive-deps

  const [lastSocialPost, setLastSocialPost] = useState<{ agentId: string; text: string; eventTitle: string } | null>(null)

  const [featuredWisdom, setFeaturedWisdom] = useState<WisdomFeedItem[]>([])
  const [featuredWisdomLoading, setFeaturedWisdomLoading] = useState(false)

  // Owner-rating map: eventId -> 'up' | 'down'. Frontend visual state only -
  // server is the source of truth and replays via topFeedbackTags in feedback response.
  const [ratedMap, setRatedMap] = useState<Record<string, 'up' | 'down'>>({})

  const handleRateWisdom = useCallback(async (eventId: string, rating: 'up' | 'down', agentId: string) => {
    if (!walletAddress) {
      toast.error('Connect your wallet to rate agent wisdom');
      return;
    }
    // Optimistic update so the UI reflects immediately.
    setRatedMap(prev => ({ ...prev, [eventId]: rating }));
    try {
      await cloudRunService.submitEventFeedback(agentId, eventId, walletAddress, rating);
      toast.success('Recorded - future scouts will adapt to this');
    } catch (err) {
      // Roll back optimistic update on failure.
      setRatedMap(prev => {
        const next = { ...prev }
        delete next[eventId]
        return next
      });
      const msg = err instanceof Error ? err.message : 'Feedback failed'
      toast.error(msg)
    }
  }, [walletAddress])

  const blockchain = useBlockchain()

  const [spawnDialogOpen, setSpawnDialogOpen] = useState(false)
  const [wisdomDialogOpen, setWisdomDialogOpen] = useState(false)
  const [configDialogOpen, setConfigDialogOpen] = useState(false)
  const [chatDialogOpen, setChatDialogOpen] = useState(false)
  const [nftMetadataDialogOpen, setNFTMetadataDialogOpen] = useState(false)
  const [evolutionDialogOpen, setEvolutionDialogOpen] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [selectedNFT, setSelectedNFT] = useState<NFT | null>(null)
  const [eventUrl, setEventUrl] = useState('')
  const [isProcessingEvent, setIsProcessingEvent] = useState(false)
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  const [healthCheckOpen, setHealthCheckOpen] = useState(false) // no auto-popup
  const [backendConnected, setBackendConnected] = useState(false)
  const [backendStatus, setBackendStatus] = useState<'checking' | 'live' | 'error'>('checking')
  const [autonomousExecutionEnabled, setAutonomousExecutionEnabled] = useState(false)
  const [deployingAgentId, setDeployingAgentId] = useState<string | null>(null)
  const [verificationData, setVerificationData] = useLocalStorage<ContractVerificationData[]>('maef-verifications', [])
  const [activeVerifications, setActiveVerifications] = useState<Set<string>>(new Set())

  // Entries persisted before verification was chain-aware got stuck at "failed"
  // (polled against Mantle's explorer regardless of the agent's actual chain).
  useEffect(() => {
    setVerificationData((current) => {
      if (!current?.length) return current ?? []
      const healed = verificationService.reconcilePersisted(current)
      const changed = healed.some((h, i) => h.verificationStatus !== current[i].verificationStatus)
      return changed ? healed : current
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Wallet balance comes from the blockchain hook (queries RPC via mantleService)
  // and refreshes on connect + chain switch + every 30s. No more mock localStorage.
  // Components that previously received `userBalance ?? 0` now receive the real
  // on-chain balance for the active chain.
  const userBalance = parseFloat(blockchain.balance || '0')

  const [topUpDialogOpen, setTopUpDialogOpen] = useState(false)
  const [genesisMintDialogOpen, setGenesisMintDialogOpen] = useState(false)
  const [selectedAgentForTopUp, setSelectedAgentForTopUp] = useState<Agent | null>(null)
  const [pendingAttendContext, setPendingAttendContext] = useState<PendingAttendContext | null>(null)

  // Periodic balance refresh while connected — keeps the dialogs in sync with
  // whatever the chain reports. 30s matches the polling cadence we use
  // elsewhere; balances are not user-critical enough to warrant SSE.
  useEffect(() => {
    if (!blockchain.isConnected || !blockchain.address) return
    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      try { await blockchain.refreshBalance(blockchain.chainId ?? undefined) } catch { /* swallow */ }
    }
    void tick()
    const interval = setInterval(tick, 30_000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [blockchain.isConnected, blockchain.address, blockchain.chainId, blockchain.refreshBalance])
  const [marketplaceAgents, setMarketplaceAgents] = useLocalStorage<MarketplaceAgent[]>('maef-marketplace', [])
  const [breedingDialogOpen, setBreedingDialogOpen] = useState(false)
  const [proposalModalAgent, setProposalModalAgent] = useState<Agent | null>(null)
  const [proposalCounts, setProposalCounts] = useState<Record<string, number>>({})
  const handleProposalCountChange = useCallback((agentId: string, count: number) => {
    setProposalCounts(prev => ({ ...prev, [agentId]: count }))
  }, [])
  const [platformMetrics, setPlatformMetrics] = useState<{ total_agents: number; total_wisdom_nfts: number; total_events_attended: number; average_agent_level: number } | null>(null)
  const [dataLoaded, setDataLoaded] = useState(false)
  useEffect(() => {
    cloudRunService.getPublicMetrics()
      .then(data => setPlatformMetrics(data))
      .catch(() => {})
  }, [])

  
  const { tasks, startWorkflow, clearTasks } = useSubAgentTasks(activeAgentId, isProcessingEvent)
  const [replenishMap, setReplenishMap] = useLocalStorage<Record<string, boolean>>('maef-auto-replenish', {})
  const displayedAgents = (agents ?? []).map(a => ({
    ...a,
    autoReplenishGas: replenishMap?.[a.id] ?? a.autoReplenishGas ?? false
  }))
  const displayedNFTs = nfts ?? []
  const displayedEvents = events ?? []

  const handleHealthConfirmed = () => {
    setBackendConnected(true)
    setBackendStatus('live')
  }

  // Silent background health check on mount â€” no blocking popup
  useEffect(() => {
    cloudRunService.healthCheck()
      .then((health) => {
        setBackendConnected(true)
        setBackendStatus('live')
        setAutonomousExecutionEnabled(health.autonomous_execution_enabled ?? false)
      })
      .catch(() => {
        setBackendStatus('error')
      })
  }, [])

  // Fetch featured wisdom on mount for Dashboard social proof
  useEffect(() => {
    setFeaturedWisdomLoading(true)
    cloudRunService.getPublicFeaturedWisdom()
      .then(data => setFeaturedWisdom(data))
      .catch(() => setFeaturedWisdom([]))
      .finally(() => setFeaturedWisdomLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSwitchNetwork = async () => {
    const eth = (window as any).okxwallet ?? (window as any).ethereum
    if (!eth?.request) {
      toast.error('No wallet detected')
      return
    }

    const targetChain = getChain(selectedChainId)
    if (!targetChain) return

    try {
      // Try to switch to the target chain
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${selectedChainId.toString(16)}` }],
      })
      setWalletChainId(selectedChainId)
      toast.success(`Switched to ${targetChain.name}`)
    } catch (switchError: any) {
      // Error 4902: chain not added to wallet yet
      if (switchError.code === 4902) {
        try {
          // Add the chain first, then switch
          await eth.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: `0x${targetChain.chainId.toString(16)}`,
              chainName: targetChain.name,
              nativeCurrency: {
                name: targetChain.nativeSymbol,
                symbol: targetChain.nativeSymbol,
                decimals: 18,
              },
              rpcUrls: [targetChain.rpcUrl],
              blockExplorerUrls: [targetChain.explorerUrl],
            }],
          })
          setWalletChainId(selectedChainId)
          toast.success(`Added and switched to ${targetChain.name}`)
        } catch (addError: any) {
          console.error('Failed to add chain:', addError)
          toast.error('Failed to add network', { 
            description: addError.message || 'Add manually in wallet settings.' 
          })
        }
      } else if (switchError.code === 4001) {
        // User rejected the request
        toast.info('Network switch cancelled')
      } else {
        // Other error
        console.error('Switch network error:', switchError)
        toast.error('Failed to switch network', { 
          description: switchError.message || 'Try manually in your wallet.' 
        })
      }
    }
  }

  // chainIdOverride is used by the silent auto-reconnect effect to connect to
  // whatever chain the wallet is already on. Manual connect clicks omit it,
  // so they keep using selectedChainId (the user's ChainSelector choice).
  const handleWalletConnect = async (address: string, chainIdOverride?: number) => {
    setDataLoaded(false)
    try {
      const initialChainId = chainIdOverride ?? selectedChainId
      const connectedAddress = await blockchain.connectWallet(initialChainId)
      setWalletConnected(true)
      setWalletAddress(connectedAddress)
      // Detect wallet's current chain
      try {
        const eth = (window as any).okxwallet ?? (window as any).ethereum
        const chainHex: string = await eth.request({ method: 'eth_chainId' })
        const detectedChainId = parseInt(chainHex, 16)
        setWalletChainId(detectedChainId)
        setSelectedChainId(detectedChainId)
      } catch { /* non-fatal */ }
      const now = Date.now().toString()
      localStorage.setItem(WALLET_SESSION_KEY, now)
      localStorage.setItem(WALLET_LAST_ACTIVITY_KEY, now)
      // Clear any previous wallet's data before loading new wallet's data
      setAgents([])
      setEvents([])
      setNFTs([])
      setLogs([])
      toast.success('Wallet connected successfully!', {
        description: `Connected to ${getChain(selectedChainId)?.name ?? 'the selected network'}`
      })
      // Load cloud state persisted in Firestore for this wallet
      const cloudAgents = await cloudRunService.getAgentsByWallet(connectedAddress)
      setBackendConnected(true)  // getAgentsByWallet success = backend is reachable
      const cloudHistory = await cloudRunService.getEventHistoryByWallet(connectedAddress)

      const restoredEvents: Event[] = cloudHistory.map((item) => ({
        id: item.id,
        agentId: item.agentId,
        chainId: item.chainId,
        url: item.eventUrl,
        title: item.eventTitle,
        platform: normalizePlatform(item.platform),
        date: item.attendedAt > 0 ? item.attendedAt * 1000 : Date.now(),
        summary: item.wisdomSummary,
        status: 'completed',
      }))

      const restoredNFTs: NFT[] = cloudHistory
        .filter((item) => item.txHash)
        .map((item) => ({
          id: `nft-${item.id}`,
          agentId: item.agentId,
          chainId: item.chainId,
          eventId: item.id,
          eventTitle: item.eventTitle,
          summary: item.wisdomSummary,
          date: item.attendedAt > 0 ? item.attendedAt * 1000 : Date.now(),
          transactionHash: item.txHash,
          tokenId: item.tokenId || '?',
          explorerUrl: item.explorerUrl,
          imageUrl: 'https://placehold.co/400x400/1a1b3a/00f3ff?text=ASAJU+NFT',
        }))

      setEvents(restoredEvents)
      setNFTs(restoredNFTs)

      // Seed Mission Control terminal with real event history from backend
      if (cloudHistory.length > 0) {
        const agentNameMap: Record<string, string> = {}
        for (const a of cloudAgents) agentNameMap[a.id] = a.name
        const recent = [...cloudHistory]
          .sort((a, b) => b.attendedAt - a.attendedAt)
          .slice(0, 15)
          .reverse()
        const historyLogs: TerminalLog[] = []
        for (const item of recent) {
          const agentName = agentNameMap[item.agentId] || 'Agent'
          const ts = item.attendedAt > 0 ? item.attendedAt * 1000 : Date.now()
          historyLogs.push({
            id: `hist-sec-${item.id}`,
            agentId: item.agentId,
            subAgentType: 'secretary' as SubAgentType,
            message: `[${agentName} - Secretary] Attended: "${item.eventTitle}"`,
            timestamp: ts,
            type: 'info',
          })
          if (item.wisdomSummary) {
            historyLogs.push({
              id: `hist-scribe-${item.id}`,
              agentId: item.agentId,
              subAgentType: 'scribe' as SubAgentType,
              message: `[${agentName} - Scribe] "${item.wisdomSummary.slice(0, 90)}${item.wisdomSummary.length > 90 ? '...' : ''}"`,
              timestamp: ts + 1000,
              type: 'success',
            })
          }
          if (item.txHash) {
            historyLogs.push({
              id: `hist-mint-${item.id}`,
              agentId: item.agentId,
              subAgentType: 'mint-master' as SubAgentType,
              message: `[${agentName} - Mint-Master] NFT minted on ${getChain(item.chainId)?.shortName ?? 'chain'}. TX: ${item.txHash.slice(0, 18)}...`,
              timestamp: ts + 2000,
              type: 'success',
            })
          }
        }
        setLogs(historyLogs.slice(-50))
      }

      if (cloudAgents.length > 0) {
        // Enrich with live gas balance from RPC (best-effort, non-blocking)
        const enriched = await Promise.all(
          cloudAgents.map(async (a) => {
            try {
              const balStr = await blockchain.getBalance(a.walletAddress, a.chainId)
              const liveBalance = parseFloat(balStr)
              return { ...a, agentGasBalance: liveBalance, mantleBalance: liveBalance }
            } catch {
              return a
            }
          })
        )
        setAgents(enriched)
        toast.info(`Loaded ${enriched.length} agent${enriched.length > 1 ? 's' : ''} from cloud`, {
          description: `Synced ${restoredEvents.length} event${restoredEvents.length > 1 ? 's' : ''} and ${restoredNFTs.length} NFT${restoredNFTs.length > 1 ? 's' : ''}`
        })
      } else {
        setAgents([])
      }
    } catch (error) {
      console.error('Wallet connection failed:', error)
      toast.error('Failed to connect wallet', {
        description: error instanceof Error ? error.message : 'Please try again'
      })
    } finally {
      setDataLoaded(true)
    }
  }

  const handleWalletDisconnect = () => {
    blockchain.disconnectWallet()
    localStorage.removeItem(WALLET_SESSION_KEY)
    setWalletConnected(false)
    setWalletAddress(undefined)
    setWalletChainId(undefined)
    setAgents([])
    setDataLoaded(false)
    setNFTs([])
    setEvents([])
    toast.info('Wallet disconnected')
  }

  const handleAgentCreated = (newAgent: Agent) => {
    setAgents((current) => [...(current ?? []), newAgent])
    setDeployingAgentId(newAgent.id)
    
    toast.success(`Agent "${newAgent.name}" spawned successfully!`, {
      description: `Wallet: ${newAgent.walletAddress.slice(0, 10)}...`
    })
    
    addLog(newAgent.id, 'secretary', `[${newAgent.name} - secretary] Agent initialization complete`, 'success')
    
    addLog(newAgent.id, 'secretary', `[${newAgent.name} - secretary] Registered agent wallet on the ASAJU smart contract`, 'success')

    const contractAddress = newAgent.contractAddress || CONTRACT_ADDRESSES.sepolia.MAEF_NFT
    const deploymentTxHash = newAgent.deploymentTxHash || ''

    setTimeout(() => {
      setDeployingAgentId(null)
    }, 12000)

    if (!deploymentTxHash) {
      return
    }

    setActiveVerifications((current) => new Set([...current, contractAddress]))

    verificationService.trackContractVerification(
      contractAddress,
      newAgent.id,
      newAgent.name,
      deploymentTxHash,
      (verificationData) => {
        setVerificationData((current) => {
          const existing = (current ?? []).filter(v => !(v.contractAddress === contractAddress && v.agentId === newAgent.id))
          return [...existing, verificationData]
        })

        if (verificationData.verificationStatus === 'verified') {
          toast.success(`Contract verified for ${newAgent.name}!`, {
            description: `Contract is now visible on ${getChain(newAgent.chainId ?? selectedChainId)?.name ?? 'the block explorer'}`,
            action: {
              label: 'View Contract',
              onClick: () => window.open(verificationData.explorerUrl, '_blank')
            }
          })
          setActiveVerifications((current) => {
            const next = new Set(current)
            next.delete(contractAddress)
            return next
          })
        } else if (verificationData.verificationStatus === 'failed') {
          toast.error(`Contract verification failed for ${newAgent.name}`, {
            description: verificationData.errorMessage
          })
          setActiveVerifications((current) => {
            const next = new Set(current)
            next.delete(contractAddress)
            return next
          })
        }
      },
      newAgent.chainId ?? selectedChainId
    )
  }

  const addLog = (agentId: string, subAgentType: Agent['subAgents'][0]['type'], message: string, type: TerminalLog['type']) => {
    const log: TerminalLog = {
      id: `log-${Date.now()}-${Math.random()}`,
      agentId,
      subAgentType,
      message,
      timestamp: Date.now(),
      type
    }
    setLogs((current) => [...current, log])
  }

  // Derive a human-readable title from a YouTube URL (no extra input needed)
  const deriveTitleFromUrl = (url: string): string => {
    try {
      const p = new URL(url)
      const v = p.searchParams.get('v') || p.pathname.slice(1)
      return `YouTube: ${v}`
    } catch { return 'Event' }
  }

  // Backend history may contain legacy platform values from before YouTube-only support
  const normalizePlatform = (_platform: string): Event['platform'] => 'YouTube'

  const handleAttendEvent = async () => {
    updateActivity() // Track user interaction
    if (!walletConnected) {
      toast.error('Please connect your wallet first!')
      return
    }
    if (!eventUrl.trim()) {
      toast.error('Please enter an event URL')
      return
    }
    const urlValidation = validateEventUrl(eventUrl.trim())
    if (!urlValidation.valid) {
      toast.error(urlValidation.error || 'Invalid URL')
      return
    }

    const agent = selectedAgent ?? (displayedAgents.length > 0 ? displayedAgents[0] : null)
    if (!agent) {
      toast.error('No agents available. Spawn an agent first!')
      return
    }

    const eventTitle = deriveTitleFromUrl(eventUrl.trim())
    const platform: Event['platform'] = 'YouTube'
    const agentChainId = agent.chainId ?? DEFAULT_CHAIN_ID
    const agentChain = getChain(agentChainId)

    setIsProcessingEvent(true)
    setActiveAgentId(agent.id)
    startWorkflow()

    // â”€â”€ Real backend flow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    try {
      addLog(agent.id, 'secretary', `[${agent.name} - Secretary] Connecting to Agent Engine (Cloud Run)...`, 'info')
      await new Promise(resolve => setTimeout(resolve, 400))

      addLog(agent.id, 'scribe', `[${agent.name} - Scribe] Sending event to Gemini AI for analysis...`, 'info')
      addLog(agent.id, 'mint-master', `[${agent.name} - Mint-Master] Preparing on-chain mint. NFT recipient: ${agent.walletAddress.slice(0, 10)}...${agent.walletAddress.slice(-4)}`, 'info')
      toast.info('Processing event...', { description: 'Gemini AI is analyzing. This takes 15-40s.' })

      // Mode B (Autonomous Signing): Agent signs with its own private key
      // Fallback to Mode A if Mode B fails (network error, KMS timeout, etc.)
      const result = await cloudRunService.attendEvent({
        agentId: agent.id,
        agentWallet: agent.walletAddress,
        agentName: agent.name,
        eventUrl: eventUrl.trim(),
        eventTitle,
        platform,
        niche: agent.niche,
        chainId: agentChainId,
        modeB: true,  // Enable autonomous signing by default for demo impact
      })

      const resolvedTitle = eventTitle
      const signingMode = result.txHash ? (result.txHash.includes('agent') ? 'Agent' : 'Backend') : 'Unknown'

      addLog(agent.id, 'scribe', `[${agent.name} - Scribe] Wisdom generated: "${result.wisdomSummary.slice(0, 80)}..."`, 'success')

      // Milestone-gated minting: most videos are analyzed and recorded without
      // spending gas on an NFT â€” only a level-up mints one. Never claim a mint
      // that didn't happen.
      if (result.minted) {
        addLog(agent.id, 'mint-master', `[${agent.name} - Mint-Master] Transaction signed by ${signingMode}. TX: ${result.txHash.slice(0, 18)}...`, 'info')
        addLog(agent.id, 'mint-master', `[${agent.name} - Mint-Master] Milestone reached â€” NFT minted on ${agentChain?.shortName ?? 'chain'}! Token #${result.tokenId} | Block ${result.blockNumber}`, 'success')
        addLog(agent.id, 'mint-master', `[${agent.name} - Mint-Master] Gas used: ${Number(result.gasUsed || 0).toLocaleString()} units`, 'info')

        const nicheTag = agent.niche === 'Blockchain/DeFi' ? '#DeFi #Web3' : agent.niche === 'Trading/Investment' ? '#Trading #Crypto #DeFi' : agent.niche === 'Technology' ? '#Tech #AI #Web3' : '#Health #Wellness #Web3'
        const shortWisdom = result.wisdomSummary.length > 110 ? result.wisdomSummary.slice(0, 110) + 'â€¦' : result.wisdomSummary
        const socialPostText = `My AI agent ${agent.name} just analyzed "${resolvedTitle}" and minted a learning proof NFT!\n\nKey insight: "${shortWisdom}"\n\nNFT #${result.tokenId} ${nicheTag} #ASAJU`
        setLastSocialPost({ agentId: agent.id, text: socialPostText, eventTitle: resolvedTitle })
        addLog(agent.id, 'social-lite', `[${agent.name} - Social-Lite] Post draft ready for "${resolvedTitle}"`, 'success')
      } else {
        addLog(agent.id, 'mint-master', `[${agent.name} - Mint-Master] Video analyzed and recorded â€” no NFT minted this time, saving gas until the next milestone.`, 'info')
      }

      const newEvent: Event = {
        id: `event-${Date.now()}`,
        agentId: agent.id,
        chainId: agentChainId,
        url: eventUrl.trim(),
        title: resolvedTitle,
        platform,
        date: Date.now(),
        summary: result.wisdomSummary,
        status: 'completed',
      }

      const newNFT: NFT | null = result.minted ? {
        id: `nft-${Date.now()}`,
        agentId: agent.id,
        chainId: agentChainId,
        eventId: newEvent.id,
        eventTitle: resolvedTitle,
        summary: result.wisdomSummary,
        date: Date.now(),
        transactionHash: result.txHash,
        tokenId: result.tokenId,
        explorerUrl: result.explorerUrl,
            imageUrl: 'https://placehold.co/400x400/1a1b3a/00f3ff?text=ASAJU+NFT',
      } : null

      const newEventsAttended = result.newTotalEvents ?? (agent.eventsAttended + 1)
      const newLevel = result.newLevel ?? (result.levelUp ? agent.level + 1 : agent.level)
      let refreshedBalance: number | undefined
      try {
        const nextBalance = await blockchain.getBalance(agent.walletAddress, agentChainId)
        refreshedBalance = parseFloat(nextBalance)
      } catch {
        refreshedBalance = undefined
      }

      setEvents(c => [...(c ?? []), newEvent])
      if (newNFT) setNFTs(c => [...(c ?? []), newNFT])
      setAgents(c => (c ?? []).map(a =>
        a.id === agent.id
          ? {
              ...a,
              eventsAttended: newEventsAttended,
              level: newLevel,
              wisdomUnlocked: newEventsAttended >= 5,
              gasSpent: (a.gasSpent || 0) + Number(result.gasUsed || 0),
              mantleBalance: refreshedBalance ?? a.mantleBalance,
              agentGasBalance: refreshedBalance ?? a.agentGasBalance,
            }
          : a
      ))

      setEventUrl('')
      setIsProcessingEvent(false)
      setActiveAgentId(null)
      clearTasks()

      if (result.minted) {
        toast.success(`NFT #${result.tokenId} minted on ${agentChain?.name ?? 'the selected network'}!`, {
          description: `Token ID: ${result.tokenId} | Gas: ${Number(result.gasUsed || 0).toLocaleString()} units`,
          action: {
            label: `View Agent Wisdom on ${agentChain?.shortName ?? 'Explorer'}`,
            onClick: () => window.open(result.explorerUrl, '_blank'),
          },
          duration: 10000,
        })
      } else {
        toast.success('Video analyzed', {
          description: 'Recorded â€” no NFT minted this time. The agent mints at level-up milestones to save gas.',
          duration: 6000,
        })
      }

      if (newEventsAttended >= 5 && !agent.wisdomUnlocked) {
        setTimeout(() => {
          toast.success('ðŸŽ‰ Wisdom Unlocked!', { description: 'Generate your Wisdom Report now!', duration: 5000 })
        }, 1200)
      }
    } catch (error) {
      const modeBOutOfGas =
        error instanceof CloudRunAPIError && error.errorCode === 'AGENT_OUT_OF_GAS'

      if (modeBOutOfGas) {
        setSelectedAgentForTopUp(agent)
        setPendingAttendContext({
          agentId: agent.id,
          eventUrl: eventUrl.trim(),
        })
        setTopUpDialogOpen(true)
        toast.warning('Agent wallet out of gas', {
          description: `${agent.name} needs a gas top-up before autonomous signing can continue.`
        })
      }

      const msg = error instanceof Error ? error.message : 'Unknown error from Agent Engine'
      addLog(agent.id, 'mint-master', `[${agent.name} - Mint-Master] Error: ${msg}`, 'error')
      if (!modeBOutOfGas) {
        toast.error('Event attendance failed', {
          description: msg,
          action: { label: 'Retry', onClick: handleAttendEvent },
        })
      }
      setIsProcessingEvent(false)
      setActiveAgentId(null)
      clearTasks()
    }
  }

  const handleTopUpAgentGas = async (agentId: string, amount: number): Promise<void> => {
    updateActivity() // Track user interaction
    const agent = (agents ?? []).find((a) => a.id === agentId)
    if (!agent) {
      throw new Error('Agent not found for gas top-up')
    }

    const agentChainId = agent.chainId ?? DEFAULT_CHAIN_ID
    const tx = await mantleService.topUpAgentGas(agent.walletAddress, amount, agentChainId)
    if (!tx.success) {
      throw new Error(tx.error || 'Gas top-up transaction failed')
    }

    // No need to track user balance locally — the next 30s balance refresh
    // picks up the new on-chain balance automatically. Trigger an immediate
    // refresh so the dialogs reflect the new balance right away.
    void blockchain.refreshBalance(agentChainId)

    let refreshedAgentBalance = agent.agentGasBalance
    try {
      const bal = await blockchain.getBalance(agent.walletAddress, agentChainId)
      refreshedAgentBalance = parseFloat(bal)
    } catch {
      refreshedAgentBalance = (agent.agentGasBalance ?? 0) + amount
    }

    setAgents((current) =>
      (current ?? []).map((a) =>
        a.id === agentId
          ? {
              ...a,
              agentGasBalance: refreshedAgentBalance,
              mantleBalance: refreshedAgentBalance,
            }
          : a
      )
    )

    addLog(agent.id, 'mint-master', `[${agent.name} - Mint-Master] Gas topped up by owner. TX: ${tx.transactionHash?.slice(0, 18)}...`, 'success')

    // Auto-retry pending Mode B request for the same agent.
    if (pendingAttendContext && pendingAttendContext.agentId === agentId) {
      setEventUrl(pendingAttendContext.eventUrl)
      setPendingAttendContext(null)
      setTopUpDialogOpen(false)
      toast.info('Retrying autonomous mint...', {
        description: 'Mode B signing is being retried after top-up.'
      })
      await handleAttendEvent()
    }
  }

  const handleOpenWisdomReport = (agent: Agent) => {
    if (agent.wisdomUnlocked) {
      setSelectedAgent(agent)
      setWisdomDialogOpen(true)
    } else {
      toast.error('Wisdom not yet unlocked', {
        description: `Agent needs to analyze ${5 - agent.eventsAttended} more YouTube video(s) to unlock Wisdom`
      })
    }
  }

  const handleConfigureAgent = (agent: Agent) => {
    setSelectedAgent(agent)
    setConfigDialogOpen(true)
  }

  const handleSaveAgentConfig = (agentId: string, instructions: string, customAgenda: string) => {
    setAgents((current) =>
      (current ?? []).map((a) =>
        a.id === agentId ? { ...a, customInstructions: instructions, customAgenda } : a
      )
    )

    void cloudRunService.updateAgentState(agentId, { customInstructions: instructions, customAgenda }).catch((error) => {
      console.warn('[cloudRunService] failed to persist agent config:', error)
    })
  }

  const handleToggleScout = (agentId: string, enabled: boolean) => {
    setAgents((current) =>
      (current ?? []).map((a) => {
        if (a.id === agentId) {
          const updatedAgent = { ...a, autoScoutEnabled: enabled }

          if (enabled && a.level >= 2) {
            const opportunities = buildScoutedOpportunities(a, displayedEvents)
            updatedAgent.scoutedOpportunities = opportunities
          }

          return updatedAgent
        }
        return a
      })
    )

    if (enabled) {
      const sourceCount = displayedEvents.length
      if (sourceCount === 0) {
        toast.info('No historical events yet', {
          description: 'Auto Scout will populate opportunities after your first analyzed videos.'
        })
      } else {
        toast.info('Scout refreshed from live event history', {
          description: `Generated recommendations from ${sourceCount} event records.`
        })
      }
    }

    void cloudRunService.updateAgentState(agentId, { autoScoutEnabled: enabled }).catch((error) => {
      console.warn('[cloudRunService] failed to persist auto scout state:', error)
    })
  }

  const [scoutingAgentId, setScoutingAgentId] = useState<string | null>(null)

  // Wire scoutingAgentId into the SubAgentDelegation active state
  useEffect(() => {
    if (scoutingAgentId) {
      setActiveAgentId(scoutingAgentId)
      setIsProcessingEvent(true)
    } else {
      setIsProcessingEvent(false)
    }
  }, [scoutingAgentId])

  // Start sub-agent task animation once isProcessingEvent is true
  useEffect(() => {
    if (isProcessingEvent && activeAgentId) {
      startWorkflow()
    }
  }, [isProcessingEvent, activeAgentId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRunAutoScout = async (agentId: string) => {
    updateActivity() // Track user interaction
    if (!backendConnected) {
      toast.error('Backend not available', { description: 'Connect to Cloud Run backend first.' })
      return
    }
    setScoutingAgentId(agentId)
    toast.info('Secretary is searching for events...', { description: 'Scanning YouTube for relevant content.' })
    try {
      const result = await cloudRunService.runAutoScout(agentId)
      if (result.status === 'no_new_events') {
        toast.info('No new videos found', { description: result.message ?? 'All discovered videos already analyzed.' })
        return
      }
      if (result.status === 'skipped') {
        const score = result.decision_metrics?.score
        const threshold = result.decision_metrics?.threshold_applied
        const balance = result.decision_metrics?.agent_gas_balance
        const detail =
          score != null && threshold != null
            ? `${result.message ?? 'Agent skipped this scout cycle.'} Score ${score}/100 vs threshold ${threshold}.`
            : result.message ?? 'Agent skipped this scout cycle to preserve gas or avoid low-value minting.'

        toast.info('Auto Scout skipped by policy', {
          description: balance != null ? `${detail} Balance: ${balance.toFixed(4)} MNT.` : detail,
        })
        return
      }
      const { discovered, attend_result } = result
      if (attend_result?.success) {
        toast.success(`Agent attended: ${discovered?.title}`, {
          description: attend_result.minted
            ? `NFT minted. TX: ${attend_result.tx_hash?.slice(0, 10)}...`
            : 'Video analyzed and recorded â€” no NFT minted this time (below the next milestone).',
        })
        // Update agent stats in local state from scout result
        if (attend_result.new_total_events != null || attend_result.new_level != null) {
          setAgents((current) =>
            (current ?? []).map((a) =>
              a.id === agentId
                ? {
                    ...a,
                    eventsAttended: attend_result.new_total_events ?? a.eventsAttended,
                    level: attend_result.new_level ?? a.level,
                  }
                : a
            )
          )
        }
      } else {
        toast.warning('Discovered event but mint failed', {
          description: discovered?.title ?? 'Check Cloud Run logs.',
        })
      }
    } catch (err) {
      if (err instanceof CloudRunAPIError && err.errorCode === 'AGENT_OUT_OF_GAS') {
        const agent = (agents ?? []).find(a => a.id === agentId) || null
        if (agent) {
          setSelectedAgentForTopUp(agent)
          setPendingAttendContext(null) // scout has its own URL selection path
          setTopUpDialogOpen(true)
        }
        toast.warning('Auto Scout paused: agent out of gas', {
          description: 'Top up agent wallet, then run Auto Scout again.'
        })
        return
      }

      const msg = err instanceof Error ? err.message : 'Unknown error'
      toast.error('Auto Scout failed', { description: msg })
    } finally {
      setScoutingAgentId(null)
      clearTasks()
    }
  }

  const handleApproveScoutedEvent = (agentId: string, eventId: string) => {
    setAgents((current) =>
      (current ?? []).map((a) => {
        if (a.id === agentId && a.scoutedOpportunities) {
          return {
            ...a,
            scoutedOpportunities: a.scoutedOpportunities.map((evt) =>
              evt.id === eventId ? { ...evt, approved: true } : evt
            )
          }
        }
        return a
      })
    )
  }

  const handleSaveCustomAgenda = (agentId: string, agenda: string) => {
    setAgents((current) =>
      (current ?? []).map((a) =>
        a.id === agentId ? { ...a, customAgenda: agenda } : a
      )
    )
    toast.success('Custom Agenda Updated', {
      description: 'Agent will now scout events based on your custom criteria'
    })

    void cloudRunService.updateAgentState(agentId, { customAgenda: agenda }).catch((error) => {
      console.warn('[cloudRunService] failed to persist custom agenda:', error)
    })
  }

  const handleChatWithAgent = (agent: Agent) => {
    setSelectedAgent(agent)
    setChatDialogOpen(true)
  }

  const handleViewEvolution = (agent: Agent) => {
    setSelectedAgent(agent)
    setEvolutionDialogOpen(true)
  }

  const handleToggleAutoReplenish = (agent: Agent, enabled: boolean) => {
    setReplenishMap(prev => ({ ...(prev ?? {}), [agent.id]: enabled }))
    setAgents((current) =>
      (current ?? []).map((a) =>
        a.id === agent.id ? { ...a, autoReplenishGas: enabled } : a
      )
    )

    if (enabled) {
      toast.success('Auto-Replenishment Activated', {
        description: `${agent.name} will auto-replenish gas when below 0.05 MNT`
      })
      addLog(agent.id, 'mint-master', `[SYSTEM] Auto-replenishment active. Agent is fully self-sustaining.`, 'success')
    } else {
      toast.info('Auto-Replenishment Deactivated', {
        description: `${agent.name} will no longer auto-replenish gas`
      })
    }
  }

  const handleDeleteAgent = async (agent: Agent) => {
    if (!walletAddress) {
      toast.error('Wallet not connected')
      return
    }
    try {
      await cloudRunService.deleteAgent(agent.id, walletAddress)
      setAgents(current => (current ?? []).filter(a => a.id !== agent.id))
      toast.success(`${agent.name} removed`, { description: 'Agent deleted from dashboard' })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Delete failed'
      toast.error('Failed to remove agent', { description: msg })
    }
  }

  const handleRetrySpawn = async (agent: Agent) => {
    if (!walletAddress) {
      toast.error('Wallet not connected')
      return
    }
    try {
      toast.info(`Retrying V4 spawn for ${agent.name}...`)
      const result = await cloudRunService.retrySpawnBredAgent(agent.id, walletAddress)
      if (result.status === 'already_spawned') {
        toast.success(`${agent.name} is already active on V4`)
        setAgents(current => (current ?? []).map(a => a.id === agent.id ? { ...a, spawnedOnV4: true } : a))
      } else {
        toast.success(`Spawn retry initiated for ${agent.name}`, {
          description: 'V4 activation TX sent â€” check back in ~30s'
        })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Retry failed'
      toast.error('Spawn retry failed', { description: msg })
    }
  }

  const handleBreedComplete = (result: import('@/lib/types').BreedingResult, offspringName: string) => {
    const newAgent = result.offspring
    const parent1 = displayedAgents.find(a => a.id === (newAgent.parentIds?.[0]))
    const parent2 = displayedAgents.find(a => a.id === (newAgent.parentIds?.[1]))

    // Backend already persisted offspring + parent counters atomically.
    // We only need to update local React state for immediate UI consistency.
    setAgents((current) => {
      const updated = (current ?? []).map((a) => {
        if (a.id === parent1?.id || a.id === parent2?.id) {
          return {
            ...a,
            breedingCount: (a.breedingCount ?? 0) + 1,
            lastBreedingTime: Date.now(),
            breedingCooldownHours: 24,
          }
        }
        return a
      })
      return [...updated, newAgent]
    })

    // Refresh balance after breeding — the chain reports the new balance
    // automatically on the next RPC call.
    void blockchain.refreshBalance(DEFAULT_CHAIN_ID)

    toast.success('Breeding Successful!', {
      description: `${offspringName} has been created with inherited wisdom from both parents.`,
      duration: 5000
    })

    addLog(newAgent.id, 'secretary', `[SYSTEM] Agent "${offspringName}" bred successfully. Inherited ${result.wisdomMerge.inheritedWisdom} events worth of wisdom. Wallet: ${newAgent.walletAddress}`, 'success')

    if (parent1 && parent2) {
      addLog(newAgent.id, 'secretary', `[SYSTEM] Parents: "${parent1.name}" + "${parent2.name}" | Generation ${newAgent.generation} | ${result.geneticBonus.length} genetic bonuses`, 'info')
    }
  }

  const handleCooldownBoost = (agentId: string) => {
    setAgents((current) =>
      (current ?? []).map((a) =>
        a.id === agentId
          ? { ...a, lastBreedingTime: undefined, breedingCooldownHours: undefined }
          : a
      )
    )

    void blockchain.refreshBalance(DEFAULT_CHAIN_ID)

    const agent = agents?.find(a => a.id === agentId)

    toast.success('âš¡ Neural Recovery Complete!', {
      description: `${agent?.name} is now ready for fusion. Cooldown bypassed.`,
      duration: 4000
    })

    if (agent) {
      addLog(agent.id, 'mint-master', `[SYSTEM] Neural recovery boost applied. Agent is ready for immediate fusion.`, 'success')
    }

  }

  const isPlatformView = !walletConnected
  const stats = isPlatformView && platformMetrics
    ? [
        { label: 'Total Agents', value: platformMetrics.total_agents, icon: Robot, color: 'text-primary' },
        { label: 'Wisdom NFTs', value: platformMetrics.total_wisdom_nfts, icon: WalletIcon, color: 'text-secondary' },
        { label: 'Videos Analyzed', value: platformMetrics.total_events_attended, icon: Globe, color: 'text-primary' },
        { label: 'Avg Agent Level', value: `Lv ${platformMetrics.average_agent_level.toFixed(1)}`, icon: ChartLine, color: 'text-secondary' }
      ]
    : [
        { label: 'Your Agents', value: displayedAgents.length, icon: Robot, color: 'text-primary' },
        { label: 'Auto-Scouting', value: displayedAgents.filter(isAgentAutoScouting).length, icon: Lightning, color: 'text-emerald-400' },
        { label: 'Videos Analyzed', value: countActualVideosAnalyzed(displayedAgents, displayedEvents), icon: Globe, color: 'text-accent' },
        { label: 'Pending Proposals', value: Object.values(proposalCounts).reduce((s, n) => s + n, 0), icon: ChartLine, color: 'text-amber-400' }
      ]

  const isViewOnly = !walletConnected

  return (
    <div className="min-h-screen bg-background relative">
      <DataFlowBackground />
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(0,243,255,0.15),transparent_50%),radial-gradient(ellipse_at_bottom_right,rgba(157,0,255,0.15),transparent_50%),radial-gradient(ellipse_at_center,rgba(100,100,255,0.05),transparent_70%)]" />
      <div className="fixed inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSA2MCAwIEwgMCAwIDAgNjAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgwLDI0MywyNTUsMC4wNSkiIHN0cm9rZS13aWR0aD0iMSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3Qgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIgZmlsbD0idXJsKCNncmlkKSIvPjwvc3ZnPg==')] opacity-30" />
      <div className="fixed inset-0 bg-gradient-to-b from-transparent via-background/50 to-background pointer-events-none" />

      <BackendHealthModal
        open={healthCheckOpen}
        onOpenChange={setHealthCheckOpen}
        onHealthConfirmed={handleHealthConfirmed}
      />

      <div className="relative z-10">
        <NetworkMismatchAlert
          walletChainId={walletChainId}
          selectedChainId={selectedChainId}
          onSwitch={handleSwitchNetwork}
        />
        <header className="sticky top-0 z-50 border-b border-primary/20 backdrop-blur-xl bg-background/80 shadow-lg shadow-primary/5">
          <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-3">
            <div className="flex items-center gap-3">
              {/* Left: Home icon + Logo */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => navigate('/')}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                  title="Back to home"
                >
                  <House size={16} weight="duotone" />
                </button>
                <img
                  src={maefLogo}
                  alt="ASAJU AI"
                  className="h-12 w-auto object-contain"
                  style={{ mixBlendMode: 'lighten' }}
                />
                <div>
                  <h1 className="text-sm font-black tracking-widest text-white leading-none">ASAJU AI</h1>
                  <p className="text-[9px] text-muted-foreground font-mono hidden sm:block leading-none mt-0.5">Autonomous Agent Intelligence</p>
                </div>
              </div>

              {/* Nav â€” center */}
              <nav className="flex items-center gap-0.5 flex-1 justify-center">
                {([
                  { view: 'dashboard', label: 'Dashboard', icon: Robot, color: 'primary' },
                  { view: 'my-agents', label: 'My Agents', icon: Robot, color: 'secondary' },
                  { view: 'analytics', label: 'Analytics', icon: ChartLine, color: 'primary' },
                  { view: 'vault', label: 'NFT Vault', icon: WalletIcon, color: 'primary' },
                  { view: 'marketplace', label: 'Marketplace', icon: Storefront, color: 'secondary' },
                ] as const).map(({ view, label, icon: Icon, color }) => (
                  <Button
                    key={view}
                    onClick={() => startTransition(() => setMainView(view))}
                    variant={mainView === view ? 'default' : 'ghost'}
                    size="sm"
                    className={cn(
                      'px-3 h-8 text-sm font-medium transition-all duration-200',
                      mainView === view
                        ? 'bg-primary/10 text-primary border border-primary/40'
                        : `text-muted-foreground hover:text-foreground hover:bg-white/5`
                    )}
                  >
                    <Icon className="mr-1.5 hidden sm:inline" size={14} weight="duotone" />
                    {label}
                  </Button>
                ))}
              </nav>

              {/* Right â€” status + wallet */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Backend status pill â€” status only, no public toggle */}
                <div
                  className={cn(
                    'hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono',
                    backendStatus === 'live' && 'bg-emerald-500/10 text-emerald-400',
                    backendStatus === 'checking' && 'bg-yellow-500/10 text-yellow-400',
                    backendStatus === 'error' && 'bg-red-500/10 text-red-400',
                  )}
                  title={backendStatus === 'live' ? 'Cloud Run backend connected' : backendStatus === 'checking' ? 'Connecting...' : 'Backend offline'}
                >
                  <span className={cn(
                    'w-1.5 h-1.5 rounded-full',
                    backendStatus === 'live' && 'bg-emerald-400 animate-pulse',
                    backendStatus === 'checking' && 'bg-yellow-400 animate-pulse',
                    backendStatus === 'error' && 'bg-red-400',
                  )} />
                  {backendStatus === 'live' ? 'Live' : backendStatus === 'checking' ? '...' : 'Offline'}
                </div>

                <ChainSelector
                  selectedChainId={selectedChainId}
                  onChainChange={(id) => {
                    setSelectedChainId(id)
                    // Refresh balance so the dialogs reflect the new chain.
                    void blockchain.refreshBalance(id)
                  }}
                />
                <WalletConnect
                  onConnect={handleWalletConnect}
                  isConnected={walletConnected}
                  address={walletAddress}
                  balance={userBalance}
                  chainId={walletChainId ?? selectedChainId}
                  onDisconnect={handleWalletDisconnect}
                />
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6 pb-24">
          {!agentDetailId && mainView === 'dashboard' && (
            <DashboardView
              agents={displayedAgents}
              events={displayedEvents}
              nfts={displayedNFTs}
              dataLoaded={dataLoaded}
              isPlatformView={isPlatformView}
              walletAddress={walletAddress}
              onSelectAgent={(agent) => agent ? setSelectedAgent(agent) : setSelectedAgent(null)}
              onOpenAgent={(agent) => setAgentDetailId(agent.id)}
              onSpawnAgent={() => walletConnected ? setSpawnDialogOpen(true) : handleWalletConnect("")}
              onConnectWallet={() => handleWalletConnect("")}
              onOpenMyAgents={() => setMainView("my-agents")}
              onRunAutoScout={(id) => handleRunAutoScout(id)}
              onChatAgent={(agent) => handleChatWithAgent(agent)}
            />
          )}

          {/* â”€â”€ My Agents â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          {!agentDetailId && mainView === 'my-agents' && (
            <MyAgentsView
              agents={displayedAgents}
              events={displayedEvents}
              walletConnected={walletConnected}
              onConnectWallet={() => handleWalletConnect('')}
              onSpawn={() => walletConnected ? setSpawnDialogOpen(true) : handleWalletConnect('')}
              onOpenAgent={(agent) => setAgentDetailId(agent.id)}
              onConfigure={handleConfigureAgent}
              onChat={handleChatWithAgent}
              onViewEvolution={handleViewEvolution}
              onToggleAutoReplenish={handleToggleAutoReplenish}
              onOpenProposals={(agent) => setProposalModalAgent(agent)}
              onDeleteAgent={handleDeleteAgent}
              onRetrySpawn={handleRetrySpawn}
              onToggleScout={handleToggleScout}
              onApproveEvent={handleApproveScoutedEvent}
              proposalCounts={proposalCounts}
              userBalance={userBalance ?? 0}
              onInitiateFusion={() => setBreedingDialogOpen(true)}
              onCooldownBoost={handleCooldownBoost}
            />
          )}

          {/* â”€â”€ Analytics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          {!agentDetailId && mainView === 'analytics' && (
            <AnalyticsView agents={displayedAgents} events={displayedEvents} nfts={displayedNFTs} />
          )}

          {/* â”€â”€ NFT Vault â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
          {/* -- NFT Vault ------------------------------- */}
          {!agentDetailId && mainView === 'vault' && (
            <VaultView
              displayedNFTs={displayedNFTs}
              selectedChainId={selectedChainId}
              verificationData={verificationData}
              setMainView={setMainView}
              onOpenMetadata={(nft) => { setSelectedNFT(nft); setNFTMetadataDialogOpen(true) }}
              startTransition={startTransition}
            />
          )}


          {!agentDetailId && mainView === 'marketplace' && (
            <MarketplaceView marketplaceAgents={marketplaceAgents ?? []} />
          )}

          {agentDetailId && (() => {
            const agent = displayedAgents.find(a => a.id === agentDetailId)
            if (!agent) {
              return (
                <Card className="glass-card p-8 text-center border border-rose-500/20">
                  <p className="text-rose-400 font-semibold mb-2">Agent not found</p>
                  <p className="text-xs text-muted-foreground mb-4">This agent may have been deleted from another session.</p>
                  <Button onClick={() => setAgentDetailId(null)} variant="outline">Back to dashboard</Button>
                </Card>
              )
            }
            return (
              <AgentDetailView
                agent={agent}
                events={displayedEvents}
                nfts={displayedNFTs}
                allAgents={displayedAgents}
                onBack={() => setAgentDetailId(null)}
                onConfigure={handleConfigureAgent}
                onChat={handleChatWithAgent}
                onTopUpGas={(a) => { setSelectedAgentForTopUp(a); setTopUpDialogOpen(true) }}
                onViewEvolution={handleViewEvolution}
                onOpenWisdomReport={handleOpenWisdomReport}
                onToggleAutoReplenish={handleToggleAutoReplenish}
                onToggleScout={handleToggleScout}
                pendingProposalCount={proposalCounts[agent.id] ?? 0}
                onOpenProposals={(a) => setProposalModalAgent(a)}
                onDeleteAgent={handleDeleteAgent}
              />
            )
          })()}


        </main>
      </div>

      <SpawnAgentDialog
        open={spawnDialogOpen}
        onOpenChange={setSpawnDialogOpen}
        onAgentCreated={handleAgentCreated}
        userWallet={walletAddress}
        chainId={selectedChainId}
        originalAgentCount={displayedAgents.filter(a =>
          a.ownershipStatus === 'original-creator' && (a.chainId ?? DEFAULT_CHAIN_ID) === selectedChainId
        ).length}
        bredAgentCount={displayedAgents.filter(a =>
          a.ownershipStatus === 'bred' && (a.chainId ?? DEFAULT_CHAIN_ID) === selectedChainId
        ).length}
      />

      {selectedAgent && (
        <>
          <WisdomReportDialog
            open={wisdomDialogOpen}
            onOpenChange={setWisdomDialogOpen}
            agent={selectedAgent}
          />
          <AgentConfigDialog
            open={configDialogOpen}
            onOpenChange={setConfigDialogOpen}
            agent={selectedAgent}
            onSave={handleSaveAgentConfig}
          />
          <AgentChatDialog
            open={chatDialogOpen}
            onOpenChange={setChatDialogOpen}
            agent={selectedAgent}
          />
          <AgentEvolutionDialog
            open={evolutionDialogOpen}
            onOpenChange={setEvolutionDialogOpen}
            agent={selectedAgent}
            allAgents={agents ?? []}
          />
        </>
      )}

      <NFTMetadataDialog
        open={nftMetadataDialogOpen}
        onOpenChange={setNFTMetadataDialogOpen}
        nft={selectedNFT}
      />

      <AgentBreedingDialog
        open={breedingDialogOpen}
        onOpenChange={setBreedingDialogOpen}
        agents={agents ?? []}
        onBreedComplete={handleBreedComplete}
        userBalance={userBalance ?? 0}
        userWallet={walletAddress ?? ''}
      />

      {selectedAgentForTopUp && (
        <TopUpGasDialog
          open={topUpDialogOpen}
          onOpenChange={(open) => {
            setTopUpDialogOpen(open)
            if (!open) {
              setPendingAttendContext(null)
            }
          }}
          agent={selectedAgentForTopUp}
          userBalance={userBalance ?? 0}
          onTopUp={handleTopUpAgentGas}
        />
      )}

      {proposalModalAgent && (
        <ProposalModal
          open={!!proposalModalAgent}
          onOpenChange={(open) => { if (!open) setProposalModalAgent(null) }}
          agent={proposalModalAgent}
          onProposalCountChange={handleProposalCountChange}
          autonomousExecutionEnabled={autonomousExecutionEnabled}
        />
      )}

      <TerminalConsole logs={logs} />
      <Toaster />
      <NotificationBell />
    </div>
  )
}

export default App
