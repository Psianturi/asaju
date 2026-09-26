export type Niche = 'Blockchain/DeFi' | 'Trading/Investment' | 'Technology' | 'Health/Wellness'
export type Personality = 'Aggressive' | 'Analytical' | 'Creative'
export type AgentStatus = 'idle' | 'active' | 'processing' | 'error'
export type SubAgentType = 'secretary' | 'scribe' | 'social-lite' | 'mint-master'
export type RarityTier = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic'

export interface SubAgent {
  type: SubAgentType
  name: string
  status: AgentStatus
  lastAction?: string
  description: string
}

export interface Agent {
  id: string
  name: string
  personality: Personality
  niche: Niche
  walletAddress: string
  chainId?: number
  contractAddress?: string
  deploymentTxHash?: string
  needsFunding?: boolean
  eventsAttended: number
  level: number
  status: AgentStatus
  createdAt: number
  subAgents: SubAgent[]
  wisdomUnlocked: boolean
  customInstructions?: string
  /** Agent's native token balance. Misnamed `mantleBalance` historically —
      the field is actually chain-agnostic; the symbol comes from the agent's
      `chainId` (MNT on Mantle, tBNB on BNB, ETH on ETH Sepolia). */
  nativeBalance?: number
  gasSpent?: number
  isGenesis?: boolean
  ownershipStatus?: 'original-creator' | 'marketplace-acquired' | 'bred'
  agentGasBalance?: number
  autoReplenishGas?: boolean
  generation?: number
  parentIds?: string[]
  breedingCount?: number
  maxBreedings?: number
  geneticTraits?: string[]
  lastBreedingTime?: number
  breedingCooldownHours?: number
  rarityTier?: RarityTier
  autoScoutEnabled?: boolean
  autoScoutDisabledReason?: string
  autoScoutDisabledAt?: number
  dailyMintCap?: number
  weeklyMintCap?: number
  mintCount24h?: number
  mintCount7d?: number
  lastScoutAt?: number
  lastScoutReason?: string
  topFeedbackTags?: Array<{ tag: string; score: number }>
  customAgenda?: string
  scoutedOpportunities?: ScoutedEvent[]
  autonomousSignatures?: number
  wisdomHeritageScore?: number
  parentNames?: { parent_1: string; parent_2: string }
  lineageBiography?: string
  spawnedOnV4?: boolean
  skillScores?: Record<string, number>
  // Comprehension is a derived view from the agent's event history — computed
  // live by the backend on every agent fetch. The owner sees *how far along*
  // the agent is, not just *where it is*, so the dashboard can show a real
  // progress bar toward the next mint milestone.
  comprehensionScore?: number
  comprehensionCoverage?: number
  comprehensionDepth?: number
  comprehensionDensity?: number
  comprehensionNextMilestone?: number | null
  comprehensionProgressToNext?: number
  comprehensionSampledNiches?: string[]
  recentScoutLog?: ScoutLogFeedItem[]
}

export interface ScoutLogFeedItem {
  event_id: string
  title: string
  niche: string
  attended_at: number
  summary_excerpt: string
}

export interface ScoutLogEntry {
  logId: string
  schedulerRunId: string | null
  agentId: string
  runAt: number
  action: 'MINTED' | 'SKIPPED'
  /** Whether an NFT was really minted. action='MINTED' only means the agent
   *  attended the video; milestone minting made those two different things.
   *  null on logs written before the field existed (attending always minted then). */
  minted: boolean | null
  reasonCode: string
  score: number | null
  thresholdApplied: number | null
  agentGasBalance: number | null
  candidateTitle: string | null
  candidateUrl: string | null
  reasonDescription: string | null
}

export interface ScoutedEvent {
  id: string
  title: string
  platform: 'YouTube'
  url: string
  date: number
  description: string
  relevanceScore: number
  scoutedAt: number
  approved?: boolean
}

export interface EvolutionLevel {
  level: number
  title: string
  description: string
  eventsRequired: number
  unlocked: boolean
  features: string[]
}

export interface BackendProposal {
  proposal_id: string
  agent_id: string
  agent_wallet: string
  title: string
  description: string
  category: 'defi' | 'governance' | 'education' | 'community'
  proposal_hash: string
  status: 'pending' | 'approving' | 'approved' | 'rejected' | 'expired' | 'ephemeral'
  created_at: number
  expires_at: number
  tx_hash?: string
  heritage_score_after?: number
  proposals_approved_total?: number
  autonomous_execution_triggered?: boolean
  autonomous_transfer_tx?: string
  autonomous_transfer_status?: 'success' | 'failed'
  autonomous_transfer_amount_mnt?: number
  market_context?: {
    prices: Record<string, { usd: number; usd_24h_change?: number }>
    fear_greed: { value: number; value_classification: string } | null
    generated_at: number
  } | null
  market_context_status?: 'available' | 'stale' | 'unavailable'
  // Reasoning trace — surfaced in the "View AI Reasoning" slide-over so the
  // proposal isn't a black box. `reasoning_prompt` is only present on POST
  // responses (it isn't persisted to Firestore to keep the doc small).
  reasoning?: {
    context_summary?: {
      niche?: string
      level?: number
      events_count?: number
      market_snapshot_age_seconds?: number | null
      cmc_signals_present?: string[]
    }
    raw_response?: string
    ephemeral?: boolean
  }
  reasoning_prompt?: string
  // Chain-of-thought trigger tags — short human-readable strings listing
  // which data points drove this proposal (CMC AI thesis, Fear & Greed level,
  // top gainer, etc.). Rendered as small chips under the proposal title so the
  // owner can see *why* the agent acted.
  trigger_tags?: string[]
  // CMC AI thesis at the moment this proposal was generated. Rendered next to
  // the proposal so the owner sees the exact context the agent consumed.
  cmc_ai_summary?: {
    tldr?: string
    thesis?: string
    headlines?: string[]
    sources?: string[]
    generated_at?: number | null
  }
}

export interface Event {
  id: string
  agentId: string
  chainId?: number
  url: string
  title: string
  platform: 'YouTube'
  date: number
  summary: string
  status: 'pending' | 'completed' | 'failed' | 'scheduled'
  /** Owner's explicit rating of this event's wisdom (from backend feedback). */
  feedback?: 'up' | 'down' | null
}

export interface NFT {
  id: string
  agentId: string
  chainId?: number
  eventId: string
  eventTitle: string
  summary: string
  date: number
  transactionHash: string
  tokenId: string
  explorerUrl?: string
  imageUrl?: string
  agentLevel?: number
  isDynamic?: boolean
  evolutionStage?: 'standard' | 'advanced' | 'elite' | 'wisdom'
}

export interface TerminalLog {
  id: string
  agentId: string
  subAgentType: SubAgentType
  message: string
  timestamp: number
  type: 'info' | 'success' | 'error' | 'warning'
}

export interface WisdomCard {
  id: string
  agentId: string
  niche: Niche
  events: string[]
  insights: string[]
  strategicTips: string[]
  generatedAt: number
}

export interface SecurityAuditEntry {
  id: string
  timestamp: number
  type: 'transfer' | 'economy' | 'security' | 'governance' | 'system'
  icon: string
  message: string
  agentId?: string
  agentName?: string
  severity: 'info' | 'warning' | 'critical'
}

export interface MarketplaceAgent {
  id: string
  name: string
  personality: Personality
  niche: Niche
  walletAddress: string
  eventsAttended: number
  level: number
  wisdomUnlocked: boolean
  price: number
  chainId?: number
  seller: string
  sellerAddress: string
  listedAt: number
  agentGasBalance?: number
  status: AgentStatus
  subAgents: SubAgent[]
  createdAt: number
  nativeBalance?: number
  gasSpent?: number
  generation?: number
  parentIds?: string[]
  geneticTraits?: string[]
  rarityTier?: RarityTier
  wisdomHeritageScore?: number
  autonomousSignatures?: number
}

export interface MarketplaceFilters {
  generation?: number[]
  niche?: Niche[]
  rarityTier?: RarityTier[]
  priceRange?: { min: number; max: number }
  sortBy?: 'price-asc' | 'price-desc' | 'level-desc' | 'generation-desc' | 'wisdom-desc' | 'rarity-desc'
}

export interface BreedingPair {
  parent1: Agent
  parent2: Agent
}

export interface BreedingResult {
  offspring: Agent
  inheritedTraits: {
    from: string
    trait: string
  }[]
  wisdomMerge: {
    parent1Events: number
    parent2Events: number
    inheritedWisdom: number
  }
  geneticBonus: string[]
}
