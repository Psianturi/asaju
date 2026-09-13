import { Agent, BackendProposal, Event, Niche, Personality, SubAgentType } from '@/lib/types'
import { config as appConfig } from '@/lib/config'

export const GCP_BACKEND_URL =
  import.meta.env.VITE_GCP_BACKEND_URL ||
  'https://mantle-agentic-event-21898396920.asia-southeast1.run.app'

if (!import.meta.env.VITE_GCP_BACKEND_URL) {
  console.warn('VITE_GCP_BACKEND_URL is not set. Using production Cloud Run fallback URL.')
}
const REQUEST_TIMEOUT = 55000

const ALLOWED_EVENT_DOMAINS = [
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
]

export function validateEventUrl(url: string): { valid: boolean; error?: string } {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { valid: false, error: 'Invalid URL. Please provide a full URL format (for example: https://...)' }
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, error: 'Only HTTPS URLs are allowed.' }
  }

  const hostname = parsed.hostname.toLowerCase()
  const isAllowed = ALLOWED_EVENT_DOMAINS.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
  if (!isAllowed) {
    return { valid: false, error: 'Domain is not allowed. Only YouTube URLs are supported.' }
  }

  return { valid: true }
}

export interface SpawnAgentRequest {
  name: string
  niche: Niche
  personality: Personality
  chainId: number
  customInstructions?: string
  userWallet?: string  // Connected MetaMask address (optional, used as owner ref)
}

export interface SpawnAgentResponse {
  success: boolean
  agentId: string
  mantleAddress: string
  initialBalance: number
  needsFunding: boolean
  chainId: number
  message: string
  error?: string
}

export interface MarkAgentFundedResponse {
  status: 'success'
  agent_id: string
  funded: boolean
}

export interface UpdateAgentStateRequest {
  customInstructions?: string
  autoScoutEnabled?: boolean
  customAgenda?: string
  generation?: number
  parentIds?: string[]
  breedingCount?: number
  maxBreedings?: number
  geneticTraits?: string[]
  lastBreedingTime?: number
  breedingCooldownHours?: number
}

export interface AssignEventRequest {
  agentId: string
  eventUrl: string
}

export interface AssignEventResponse {
  success: boolean
  taskId: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  estimatedDuration?: number
  message: string
  error?: string
}

export interface SubAgentLog {
  subAgentType: SubAgentType
  message: string
  timestamp: number
  type: 'info' | 'success' | 'error' | 'warning'
  status: 'idle' | 'active' | 'processing' | 'completed' | 'error'
}

export interface MissionStatusResponse {
  success: boolean
  taskId: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  progress: number
  currentPhase?: string
  logs: SubAgentLog[]
  result?: {
    eventId: string
    eventTitle: string
    platform: 'YouTube'
    summary: string
    transactionHash?: string
    tokenId?: string
    gasUsed?: number
  }
  error?: string
}

export interface AttendEventRequest {
  agentId: string
  agentWallet: string
  agentName: string
  eventUrl: string
  eventTitle: string
  platform: string
  niche: string
  chainId: number
  modeB?: boolean  // If true, agent signs autonomously with its own private key (Mode B); else backend signs (Mode A)
}

export interface AttendEventResponse {
  success: boolean
  txHash: string
  tokenId: string
  wisdomSummary: string
  gasUsed: string
  blockNumber: number
  explorerUrl: string
  levelUp: boolean
  newTotalEvents?: number
  newLevel?: number
}

export interface EventHistoryItem {
  id: string
  agentId: string
  chainId: number
  eventUrl: string
  eventTitle: string
  platform: string
  wisdomSummary: string
  txHash: string
  tokenId?: string
  gasUsed?: string
  blockNumber?: number
  attendedAt: number
  explorerUrl?: string
}

export interface GenerateWisdomRequest {
  agentId: string
}

export interface WisdomInsight {
  title: string
  description: string
  category: 'strategic' | 'technical' | 'market' | 'risk'
}

export interface GenerateWisdomResponse {
  success: boolean
  agentId: string
  wisdomReport: {
    id: string
    title: string
    executiveSummary: string
    eventsAnalyzed: number
    insights: WisdomInsight[]
    strategicRecommendations: string[]
    marketTrends: string[]
    riskAssessment: string
    generatedAt: number
  }
  error?: string
}

export interface AgentDetailsResponse {
  success: boolean
  agent: Agent
  events: Event[]
  totalGasSpent: number
  totalNFTsMinted: number
  error?: string
}

export interface MarketSnapshot {
  prices: Record<string, { usd: number; usd_market_cap?: number; usd_24h_change?: number }>
  fear_greed: { value: number; value_classification: string; update_time?: string } | null
  news?: unknown[]
  generated_at: number
}

export interface DexPool {
  attributes: {
    name: string
    base_token_price_usd: string
    quote_token_price_usd: string
  }
}

export class CloudRunAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public originalError?: unknown,
    public errorCode?: string,
  ) {
    super(message)
    this.name = 'CloudRunAPIError'
  }
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = REQUEST_TIMEOUT): Promise<Response> {
  // Guard: only allow calls to our own GCP backend domain
  const parsedUrl = new URL(url)
  const backendHost = new URL(GCP_BACKEND_URL).hostname
  if (parsedUrl.hostname !== backendHost) {
    throw new CloudRunAPIError(`Requests to external host "${parsedUrl.hostname}" are not permitted.`, 403)
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    // SECURITY: URL is validated against GCP_BACKEND_URL hostname above — SSRF is mitigated
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
    clearTimeout(timeoutId)
    return response
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new CloudRunAPIError('Request timeout - agent processing may take longer than expected', 408)
    }
    throw error
  }
}

async function handleAPIResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorMessage = `API Error: ${response.status} ${response.statusText}`
    let errorCode: string | undefined
    
    try {
      const errorData = await response.json()
      const detail = errorData?.detail

      if (detail && typeof detail === 'object') {
        errorCode = typeof detail.code === 'string' ? detail.code : undefined
        errorMessage = detail.message || errorData.error || errorData.message || errorMessage
      } else {
        errorMessage = detail || errorData.error || errorData.message || errorMessage
      }
    } catch {
      // Ignore JSON parse errors
    }

    if (response.status === 504) {
      throw new CloudRunAPIError('Gateway timeout - the autonomous agent is still processing. Please try polling for status.', 504, undefined, errorCode)
    } else if (response.status === 503) {
      throw new CloudRunAPIError('Service temporarily unavailable - Cloud Run instance may be starting up', 503, undefined, errorCode)
    } else if (response.status === 500) {
      throw new CloudRunAPIError('Internal server error - agent encountered an unexpected issue', 500, undefined, errorCode)
    } else if (response.status === 429) {
      throw new CloudRunAPIError('Too many requests - please wait before retrying', 429, undefined, errorCode)
    }

    throw new CloudRunAPIError(errorMessage, response.status, undefined, errorCode)
  }

  return response.json()
}

export const cloudRunService = {
  async spawnAgent(request: SpawnAgentRequest): Promise<SpawnAgentResponse> {
    try {
      if (!request.userWallet) {
        throw new CloudRunAPIError('Wallet must be connected before spawning an agent.', 400)
      }

      // Backend field names differ from frontend: name→agent_name, userWallet→user_wallet
      const backendPayload = {
        agent_name: request.name,
        niche: request.niche,
        user_wallet: request.userWallet,
        personality: request.personality,
        chain_id: request.chainId,
      }

      const response = await fetchWithTimeout(
        `${GCP_BACKEND_URL}/api/v1/agent/spawn`,
        {
          method: 'POST',
          body: JSON.stringify(backendPayload),
        }
      )

      const raw = await handleAPIResponse<{
        agent_id: string
        agent_wallet: string
        agent_name: string
        niche: string
        user_wallet: string
        level: number
        total_events: number
        needs_funding: boolean
        chain_id?: number
      }>(response)

      // Map backend snake_case → frontend camelCase
      return {
        success: true,
        agentId: raw.agent_id,
        mantleAddress: raw.agent_wallet,
        initialBalance: 0,
        needsFunding: raw.needs_funding,
        chainId: raw.chain_id ?? request.chainId,
        message: `Agent ${raw.agent_name} spawned successfully`,
      }
    } catch (error) {
      if (error instanceof CloudRunAPIError) {
        throw error
      }
      
      console.error('Error spawning agent:', error)
      throw new CloudRunAPIError(
        'Failed to connect to agent factory',
        undefined,
        error
      )
    }
  },

  async breedAgents(request: {
    userWallet: string
    parent1Id: string
    parent2Id: string
    offspringName: string
    breedTxHash?: string
  }): Promise<Agent> {
    const response = await fetchWithTimeout(
      `${GCP_BACKEND_URL}/api/v1/agent/breed`,
      {
        method: 'POST',
        body: JSON.stringify({
          user_wallet: request.userWallet,
          parent_1_id: request.parent1Id,
          parent_2_id: request.parent2Id,
          offspring_name: request.offspringName,
          breed_tx_hash: request.breedTxHash ?? null,
        }),
      },
      30000
    )

    const raw = await handleAPIResponse<{
      agent_id: string
      agent_wallet: string
      agent_name: string
      niche: string
      personality?: string
      user_wallet: string
      level: number
      total_events: number
      created_at: number
      needs_funding: boolean
      generation?: number
      parent_ids?: string[]
      parent_names?: { parent_1: string; parent_2: string }
      breeding_count?: number
      max_breedings?: number
      genetic_traits?: string[]
      wisdom_heritage_score?: number
      lineage_biography?: string
      spawned_on_v4?: boolean
    }>(response)

    const validNiches: Niche[] = ['Blockchain/DeFi', 'Trading/Investment', 'Technology', 'Health/Wellness']
    const validPersonalities: Personality[] = ['Aggressive', 'Analytical', 'Creative']

    return {
      id: raw.agent_id,
      name: raw.agent_name,
      personality: (validPersonalities.includes(raw.personality as Personality)
        ? raw.personality
        : 'Analytical') as Personality,
      niche: (validNiches.includes(raw.niche as Niche) ? raw.niche : 'Blockchain/DeFi') as Niche,
      walletAddress: raw.agent_wallet,
      eventsAttended: raw.total_events,
      level: raw.level,
      status: 'idle' as const,
      createdAt: raw.created_at ? raw.created_at * 1000 : Date.now(),
      subAgents: [],
      wisdomUnlocked: raw.level >= 3,
      needsFunding: raw.needs_funding,
      agentGasBalance: 0,
      mantleBalance: 0,
      generation: raw.generation,
      parentIds: raw.parent_ids,
      parentNames: raw.parent_names,
      breedingCount: raw.breeding_count ?? 0,
      maxBreedings: raw.max_breedings ?? 3,
      geneticTraits: raw.genetic_traits,
      wisdomHeritageScore: raw.wisdom_heritage_score,
      lineageBiography: raw.lineage_biography,
      ownershipStatus: 'bred' as const,
      isGenesis: false,
      spawnedOnV4: raw.spawned_on_v4 ?? false,
    }
  },

  async getAgentsByWallet(wallet: string): Promise<Agent[]> {
    try {
      const response = await fetchWithTimeout(
        `${GCP_BACKEND_URL}/api/v1/agent/list?wallet=${encodeURIComponent(wallet)}`
      )

      const raw = await handleAPIResponse<Array<{
        agent_id: string
        agent_wallet: string
        agent_name: string
        niche: string
        user_wallet: string
        level: number
        total_events: number
        created_at: number
        needs_funding: boolean
        custom_instructions?: string
        auto_scout_enabled?: boolean
        custom_agenda?: string
        generation?: number
        parent_ids?: string[]
        parent_names?: { parent_1: string; parent_2: string }
        breeding_count?: number
        max_breedings?: number
        genetic_traits?: string[]
        last_breeding_time?: number
        breeding_cooldown_hours?: number
        wisdom_heritage_score?: number
        autonomous_signatures?: number
        lineage_biography?: string
        spawned_on_v4?: boolean
        ownership_status?: string
        agent_gas_balance?: number | null
        chain_id?: number
        skill_scores?: Record<string, number>
      }>>(response)

      const validNiches: Niche[] = ['Blockchain/DeFi', 'Trading/Investment', 'Technology', 'Health/Wellness']

      return raw.map(r => ({
        id: r.agent_id,
        name: r.agent_name,
        personality: 'Analytical' as const,
        niche: (validNiches.includes(r.niche as Niche) ? r.niche : 'Blockchain/DeFi') as Niche,
        walletAddress: r.agent_wallet,
        chainId: r.chain_id ?? 5003,
        eventsAttended: r.total_events,
        level: r.level,
        status: 'idle' as const,
        createdAt: r.created_at ? r.created_at * 1000 : Date.now(),
        subAgents: [],
        wisdomUnlocked: r.level >= 3,
        needsFunding: r.needs_funding,
        customInstructions: r.custom_instructions,
        autoScoutEnabled: r.auto_scout_enabled,
        customAgenda: r.custom_agenda,
        autonomousSignatures: r.autonomous_signatures ?? 0,
        generation: r.generation,
        parentIds: r.parent_ids,
        parentNames: r.parent_names,
        breedingCount: r.breeding_count,
        maxBreedings: r.max_breedings,
        geneticTraits: r.genetic_traits,
        lastBreedingTime: r.last_breeding_time,
        breedingCooldownHours: r.breeding_cooldown_hours,
        wisdomHeritageScore: r.wisdom_heritage_score,
        lineageBiography: r.lineage_biography,
        spawnedOnV4: r.spawned_on_v4 ?? false,
        ownershipStatus: r.ownership_status as Agent['ownershipStatus'] | undefined,
        isGenesis: r.ownership_status === 'original-creator',
        agentGasBalance: r.agent_gas_balance ?? 0,
        skillScores: r.skill_scores,
      }))
    } catch (error) {
      // Non-fatal: return empty list if backend is unreachable
      console.warn('[cloudRunService] getAgentsByWallet failed:', error)
      return []
    }
  },

  async getEventHistoryByWallet(wallet: string): Promise<EventHistoryItem[]> {
    try {
      const response = await fetchWithTimeout(
        `${GCP_BACKEND_URL}/api/v1/event/list?wallet=${encodeURIComponent(wallet)}`
      )

      const raw = await handleAPIResponse<Array<{
        id: string
        agent_id: string
        chain_id?: number
        event_url: string
        event_title: string
        platform: string
        wisdom_summary: string
        tx_hash: string | null
        token_id: string | null
        gas_used: string | null
        block_number: number | null
        attended_at: number
        explorer_url: string | null
      }>>(response)

      return raw.map((r) => ({
        id: r.id,
        agentId: r.agent_id,
        chainId: r.chain_id ?? 5003,
        eventUrl: r.event_url,
        eventTitle: r.event_title,
        platform: r.platform,
        wisdomSummary: r.wisdom_summary,
        txHash: r.tx_hash ?? '',
        tokenId: r.token_id ?? undefined,
        gasUsed: r.gas_used ?? undefined,
        blockNumber: r.block_number ?? undefined,
        attendedAt: r.attended_at,
        explorerUrl: r.explorer_url ?? undefined,
      }))
    } catch (error) {
      console.warn('[cloudRunService] getEventHistoryByWallet failed:', error)
      return []
    }
  },

  async markAgentFunded(agentId: string): Promise<MarkAgentFundedResponse> {
    const response = await fetchWithTimeout(
      `${GCP_BACKEND_URL}/api/v1/agent/${agentId}/mark-funded`,
      { method: 'POST' }
    )

    return handleAPIResponse<MarkAgentFundedResponse>(response)
  },

  async updateAgentState(agentId: string, state: UpdateAgentStateRequest): Promise<void> {
    const backendPayload = {
      custom_instructions: state.customInstructions,
      auto_scout_enabled: state.autoScoutEnabled,
      custom_agenda: state.customAgenda,
      generation: state.generation,
      parent_ids: state.parentIds,
      breeding_count: state.breedingCount,
      max_breedings: state.maxBreedings,
      genetic_traits: state.geneticTraits,
      last_breeding_time: state.lastBreedingTime,
      breeding_cooldown_hours: state.breedingCooldownHours,
    }

    const response = await fetchWithTimeout(
      `${GCP_BACKEND_URL}/api/v1/agent/${encodeURIComponent(agentId)}/state`,
      {
        method: 'PATCH',
        body: JSON.stringify(backendPayload),
      }
    )

    await handleAPIResponse(response)
  },

  async assignEvent(request: AssignEventRequest): Promise<AssignEventResponse> {
    const urlCheck = validateEventUrl(request.eventUrl)
    if (!urlCheck.valid) {
      throw new CloudRunAPIError(urlCheck.error || 'Invalid event URL', 400)
    }

    // Legacy API path intentionally disabled to prevent partial payload writes.
    throw new CloudRunAPIError('assignEvent is not supported. Use attendEvent with the full payload instead.', 400)
  },

  async pollMissionStatus(taskId: string): Promise<MissionStatusResponse> {
    try {
      const response = await fetchWithTimeout(
        `${GCP_BACKEND_URL}/api/missions/${taskId}/status`,
        {
          method: 'GET',
        },
        30000
      )

      return handleAPIResponse<MissionStatusResponse>(response)
    } catch (error) {
      if (error instanceof CloudRunAPIError) {
        throw error
      }

      console.error('Error polling mission status:', error)
      throw new CloudRunAPIError(
        'Failed to retrieve mission status',
        undefined,
        error
      )
    }
  },

  // ── Real backend: AI summary + Mantle NFT mint (Mode A or B) ───────────────
  async attendEvent(request: AttendEventRequest): Promise<AttendEventResponse> {
    const urlCheck = validateEventUrl(request.eventUrl)
    if (!urlCheck.valid) {
      throw new CloudRunAPIError(urlCheck.error || 'Invalid event URL', 400)
    }

    try {
      const backendPayload = {
        agent_id: request.agentId,
        agent_wallet: request.agentWallet,
        agent_name: request.agentName,
        event_url: request.eventUrl,
        event_title: request.eventTitle,
        platform: request.platform,
        niche: request.niche,
        chain_id: request.chainId,
        mode_b: request.modeB ?? false,  // Mode B: agent signs autonomously; Mode A: backend signs (default)
      }

      const response = await fetchWithTimeout(
        `${GCP_BACKEND_URL}/api/v1/event/attend`,
        { method: 'POST', body: JSON.stringify(backendPayload) },
        90000  // 90s — Gemini + Mantle tx
      )

      const raw = await handleAPIResponse<{
        success: boolean
        tx_hash: string | null
        token_id: string | null
        wisdom_summary: string
        gas_used: string | null
        block_number: number | null
        explorer_url: string | null
        level_up: boolean
        new_total_events: number | null
        new_level: number | null
      }>(response)

      if (!raw.success) {
        throw new CloudRunAPIError('Backend returned success=false', 500)
      }

      return {
        success: true,
        txHash: raw.tx_hash ?? '',
        tokenId: raw.token_id ?? '?',
        wisdomSummary: raw.wisdom_summary,
        gasUsed: raw.gas_used ?? '0',
        blockNumber: raw.block_number ?? 0,
        explorerUrl: raw.explorer_url ?? (raw.tx_hash ? `${appConfig.blockchain.explorerUrl}/tx/${raw.tx_hash}` : appConfig.blockchain.explorerUrl),
        levelUp: raw.level_up,
        newTotalEvents: raw.new_total_events ?? undefined,
        newLevel: raw.new_level ?? undefined,
      }
    } catch (error) {
      if (error instanceof CloudRunAPIError) throw error
      throw new CloudRunAPIError(
        'Failed to process event attendance',
        undefined,
        error
      )
    }
  },

  async runAutoScout(agentId: string): Promise<{
    status: 'attended' | 'no_new_events' | 'skipped'
    reason_code?: string
    message?: string
    decision_metrics?: {
      score?: number | null
      threshold_applied?: number | null
      agent_gas_balance?: number | null
    }
    discovered?: { url: string; title: string; channel: string; scout_reason: string }
    attend_result?: {
      success: boolean
      tx_hash: string | null
      token_id: string | null
      wisdom_summary: string
      explorer_url: string | null
      new_total_events: number | null
      new_level: number | null
    }
  }> {
    try {
      const response = await fetchWithTimeout(
        `${GCP_BACKEND_URL}/api/v1/agent/${agentId}/scout`,
        { method: 'POST' },
        120000  // 120s — YouTube search + Gemini filter + Mantle tx
      )
      return handleAPIResponse(response)
    } catch (error) {
      if (error instanceof CloudRunAPIError) throw error
      throw new CloudRunAPIError('Auto Scout failed', undefined, error)
    }
  },

  /**
   * Record owner feedback on an agent's attended event wisdom.
   * Owner-only (backend verifies wallet ownership). Best-effort: returns
   * the agent's current top_feedback_tags so UI can update instantly.
   */
  async submitEventFeedback(
    agentId: string,
    eventId: string,
    userWallet: string,
    rating: 'up' | 'down',
  ): Promise<{ topFeedbackTags: Array<{ tag: string; score: number }> }> {
    const response = await fetchWithTimeout(
      `${GCP_BACKEND_URL}/api/v1/feedback`,
      {
        method: 'POST',
        body: JSON.stringify({
          agent_id: agentId,
          event_id: eventId,
          user_wallet: userWallet,
          rating,
        }),
      },
      15000,
    )
    const raw = await handleAPIResponse<{ status: string; top_feedback_tags: Array<{ tag: string; score: number }> }>(response)
    return { topFeedbackTags: raw.top_feedback_tags ?? [] }
  },

  async chatWithAgent(
    agentId: string,
    message: string,
    conversationHistory: string[],
    userContext?: {
      customInstructions?: string
      customAgenda?: string
      topFeedbackTags?: Array<{ tag: string; score: number }>
      eventsAttended?: number
    },
  ): Promise<{ reply: string; intent?: string }> {
    const response = await fetchWithTimeout(
      `${GCP_BACKEND_URL}/api/v1/agent/${agentId}/chat`,
      {
        method: 'POST',
        body: JSON.stringify({
          message,
          conversation_history: conversationHistory,
          user_context: userContext ?? null,
        }),
      },
      20000,
    )
    const raw = await handleAPIResponse<{ reply: string; intent?: string }>(response)
    return { reply: raw.reply, intent: raw.intent }
  },

  async generateWisdom(agentId: string, niche: string): Promise<{ insights: string[]; strategicTips: string[]; eventsAnalyzed: number; generatedAt: number }> {
    try {
      const response = await fetchWithTimeout(
        `${GCP_BACKEND_URL}/api/v1/agent/${agentId}/wisdom`,
        { method: 'POST' },
        60000
      )

      const raw = await handleAPIResponse<{
        agent_id: string
        niche: string
        events_analyzed: number
        insights: string[]
        strategic_tips: string[]
        generated_at: number
      }>(response)

      return {
        insights: raw.insights,
        strategicTips: raw.strategic_tips,
        eventsAnalyzed: raw.events_analyzed,
        generatedAt: raw.generated_at * 1000,
      }
    } catch (error) {
      if (error instanceof CloudRunAPIError) throw error
      throw new CloudRunAPIError('Failed to generate wisdom report', undefined, error)
    }
  },

  async getAgentDetails(agentId: string): Promise<AgentDetailsResponse> {
    try {
      const response = await fetchWithTimeout(
        `${GCP_BACKEND_URL}/api/v1/agent/${encodeURIComponent(agentId)}`
      )
      const raw = await handleAPIResponse<{
        agent_id: string
        agent_wallet: string
        agent_name: string
        niche: string
        user_wallet: string
        level: number
        total_events: number
        needs_funding: boolean
      }>(response)
      const validNiches: Niche[] = ['Blockchain/DeFi', 'Trading/Investment', 'Technology', 'Health/Wellness']
      return {
        success: true,
        agent: {
          id: raw.agent_id,
          name: raw.agent_name,
          personality: 'Analytical' as const,
          niche: (validNiches.includes(raw.niche as Niche) ? raw.niche : 'Blockchain/DeFi') as Niche,
          walletAddress: raw.agent_wallet,
          eventsAttended: raw.total_events,
          level: raw.level,
          status: 'idle' as const,
          createdAt: Date.now(),
          subAgents: [],
          wisdomUnlocked: raw.level >= 3,
          needsFunding: raw.needs_funding,
          agentGasBalance: 0,
          mantleBalance: 0,
        },
        events: [],
        totalGasSpent: 0,
        totalNFTsMinted: raw.total_events,
      }
    } catch (error) {
      if (error instanceof CloudRunAPIError) throw error
      throw new CloudRunAPIError('Failed to fetch agent details', undefined, error)
    }
  },

  async updateAgentInstructions(agentId: string, instructions: string): Promise<{ success: boolean }> {
    try {
      await cloudRunService.updateAgentState(agentId, { customInstructions: instructions })
      return { success: true }
    } catch (error) {
      if (error instanceof CloudRunAPIError) throw error
      throw new CloudRunAPIError('Failed to update agent instructions', undefined, error)
    }
  },

  async healthCheck(): Promise<{ status: string; version: string }> {
    try {
      const response = await fetchWithTimeout(
        `${GCP_BACKEND_URL}/health`,
        {
          method: 'GET',
        },
        5000
      )

      return handleAPIResponse<{ status: string; version: string }>(response)
    } catch (error) {
      console.error('Health check failed:', error)
      throw new CloudRunAPIError(
        'Backend service is not responding',
        undefined,
        error
      )
    }
  },

  // ── Public endpoints (no auth required) ────────────────────────────────────

  async getPublicMetrics() {
    try {
      const response = await fetchWithTimeout(
        `${GCP_BACKEND_URL}/api/v1/public/metrics`,
        { method: 'GET' }
      )

      return await handleAPIResponse<{
        total_agents: number
        total_wisdom_nfts: number
        total_events_attended: number
        average_agent_level: number
        global_wisdom_index: number
        total_bred_agents: number
        total_proposals_approved: number
      }>(response)
    } catch (error) {
      console.warn('[cloudRunService] getPublicMetrics failed:', error)
      return {
        total_agents: 0,
        total_wisdom_nfts: 0,
        total_events_attended: 0,
        average_agent_level: 0,
        global_wisdom_index: 0,
        total_bred_agents: 0,
        total_proposals_approved: 0,
      }
    }
  },

  async getPublicAgents() {
    try {
      const response = await fetchWithTimeout(
        `${GCP_BACKEND_URL}/api/v1/public/agents`,
        { method: 'GET' }
      )

      const raw = await handleAPIResponse<Array<{
        agent_name: string
        niche: string
        level: number
        total_events: number
        chain_id: number
        generation: number
        ownership_status: string
      }>>(response)

      return raw.map(a => ({
        agentName: a.agent_name,
        niche: a.niche,
        level: a.level,
        totalEvents: a.total_events,
        chainId: a.chain_id,
        generation: a.generation,
        ownershipStatus: a.ownership_status,
      }))
    } catch (error) {
      console.warn('[cloudRunService] getPublicAgents failed:', error)
      return []
    }
  },

  async getAgentScoutLogs(agentId: string) {
    try {
      const response = await fetchWithTimeout(
        `${GCP_BACKEND_URL}/api/v1/agent/${encodeURIComponent(agentId)}/scout-logs`,
        { method: 'GET' }
      )
      const raw = await handleAPIResponse<Array<{
        log_id: string
        scheduler_run_id: string | null
        agent_id: string
        run_at: number
        action: string
        reason_code: string
        metrics: { score: number | null; threshold_applied: number | null; agent_gas_balance: number | null }
        candidate_source: { title: string | null; url: string | null }
        reason_description: string | null
      }>>(response)
      return raw.map(r => ({
        logId: r.log_id,
        schedulerRunId: r.scheduler_run_id,
        agentId: r.agent_id,
        runAt: r.run_at,
        action: r.action as 'MINTED' | 'SKIPPED',
        reasonCode: r.reason_code,
        score: r.metrics?.score ?? null,
        thresholdApplied: r.metrics?.threshold_applied ?? null,
        agentGasBalance: r.metrics?.agent_gas_balance ?? null,
        candidateTitle: r.candidate_source?.title ? r.candidate_source.title.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'") : null,
        candidateUrl: r.candidate_source?.url ?? null,
        reasonDescription: r.reason_description,
      }))
    } catch (error) {
      console.warn('[cloudRunService] getAgentScoutLogs failed:', error)
      return []
    }
  },

  async getPublicFeaturedWisdom() {
    try {
      const response = await fetchWithTimeout(
        `${GCP_BACKEND_URL}/api/v1/public/featured-wisdom`,
        { method: 'GET' }
      )

      const raw = await handleAPIResponse<Array<{
        event_id: string
        event_title: string
        wisdom_summary: string
        agent_name: string
        agent_id: string
        niche: string
        platform: string
        chain_id: number
        attended_at: number
        tx_hash: string | null
        token_id: string | null
        wisdom_quality_score: number
        category: string
      }>>(response)

      const decodeHtml = (s: string) => s
        .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'")

      return raw.map(w => ({
        eventId: w.event_id,
        eventTitle: decodeHtml(w.event_title),
        wisdomSummary: decodeHtml(w.wisdom_summary),
        agentName: w.agent_name,
        agentId: w.agent_id,
        niche: w.niche,
        platform: w.platform,
        chainId: w.chain_id ?? 5003,
        attendedAt: w.attended_at,
        txHash: w.tx_hash ?? undefined,
        tokenId: w.token_id ?? undefined,
        wisdomQualityScore: w.wisdom_quality_score,
        category: w.category,
      }))
    } catch (error) {
      console.warn('[cloudRunService] getPublicFeaturedWisdom failed:', error)
      return []
    }
  },

  // ── Agent Management ────────────────────────────────────────────────────────

  async deleteAgent(agentId: string, walletAddress: string): Promise<void> {
    const response = await fetchWithTimeout(
      `${GCP_BACKEND_URL}/api/v1/agent/${encodeURIComponent(agentId)}?wallet=${encodeURIComponent(walletAddress)}`,
      { method: 'DELETE' },
    )
    await handleAPIResponse<{ status: string }>(response)
  },

  async retrySpawnBredAgent(agentId: string, walletAddress: string): Promise<{ status: string }> {
    const response = await fetchWithTimeout(
      `${GCP_BACKEND_URL}/api/v1/agent/${encodeURIComponent(agentId)}/retry-spawn?wallet=${encodeURIComponent(walletAddress)}`,
      { method: 'POST' },
    )
    return handleAPIResponse<{ status: string }>(response)
  },

  // ── HITL Proposals ──────────────────────────────────────────────────────────

  async generateProposal(agentId: string): Promise<BackendProposal> {
    const response = await fetchWithTimeout(
      `${GCP_BACKEND_URL}/api/v1/agent/${encodeURIComponent(agentId)}/propose`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    )
    return handleAPIResponse<BackendProposal>(response)
  },

  async getAgentProposals(agentId: string): Promise<BackendProposal[]> {
    const response = await fetchWithTimeout(
      `${GCP_BACKEND_URL}/api/v1/agent/${encodeURIComponent(agentId)}/proposals`,
      { method: 'GET' },
    )
    return handleAPIResponse<BackendProposal[]>(response)
  },

  async createProposalApprovalChallenge(
    proposalId: string,
    action: 'approve' | 'reject' = 'approve',
  ): Promise<{
    nonce: string
    message: string
    expires_at: number
  }> {
    const response = await fetchWithTimeout(
      `${GCP_BACKEND_URL}/api/v1/proposals/${encodeURIComponent(proposalId)}/approval-challenge?action=${action}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    )
    return handleAPIResponse<{ nonce: string; message: string; expires_at: number }>(response)
  },

  async approveProposal(
    proposalId: string,
    authorization: { nonce: string; signerWallet: string; signature: string },
  ): Promise<BackendProposal> {
    const response = await fetchWithTimeout(
      `${GCP_BACKEND_URL}/api/v1/proposals/${encodeURIComponent(proposalId)}/approve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nonce: authorization.nonce,
          signer_wallet: authorization.signerWallet,
          signature: authorization.signature,
        }),
      },
    )
    return handleAPIResponse<BackendProposal>(response)
  },

  async rejectProposal(
    proposalId: string,
    authorization: { nonce: string; signerWallet: string; signature: string },
  ): Promise<BackendProposal> {
    const response = await fetchWithTimeout(
      `${GCP_BACKEND_URL}/api/v1/proposals/${encodeURIComponent(proposalId)}/reject`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nonce: authorization.nonce,
          signer_wallet: authorization.signerWallet,
          signature: authorization.signature,
        }),
      },
    )
    return handleAPIResponse<BackendProposal>(response)
  },

  async createExecutionChallenge(
    proposalId: string,
  ): Promise<{ nonce: string; message: string; expires_at: number }> {
    const response = await fetchWithTimeout(
      `${GCP_BACKEND_URL}/api/v1/proposals/${encodeURIComponent(proposalId)}/execution-challenge`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    )
    return handleAPIResponse<{ nonce: string; message: string; expires_at: number }>(response)
  },

  async executeProposalTransfer(
    proposalId: string,
    authorization: { nonce: string; signerWallet: string; signature: string },
  ): Promise<BackendProposal> {
    const response = await fetchWithTimeout(
      `${GCP_BACKEND_URL}/api/v1/proposals/${encodeURIComponent(proposalId)}/execute`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nonce: authorization.nonce,
          signer_wallet: authorization.signerWallet,
          signature: authorization.signature,
        }),
      },
    )
    return handleAPIResponse<BackendProposal>(response)
  },

  async getMarketSnapshot(coins: string[] = ['bitcoin', 'ethereum', 'mantle']): Promise<MarketSnapshot> {
    const response = await fetchWithTimeout(
      `${GCP_BACKEND_URL}/api/v1/market/snapshot?coins=${encodeURIComponent(coins.join(','))}`,
      { method: 'GET' },
    )
    return handleAPIResponse<MarketSnapshot>(response)
  },

  async getMantleDexPools(): Promise<{ network: string; page: number; pools: DexPool[] }> {
    const response = await fetchWithTimeout(
      `${GCP_BACKEND_URL}/api/v1/market/dex-pools/mantle`,
      { method: 'GET' },
    )
    return handleAPIResponse<{ network: string; page: number; pools: DexPool[] }>(response)
  },

  async getOwnerInbox(wallet: string): Promise<{
    user_wallet: string
    generated_at: number
    counts: {
      pending_proposals: number
      low_gas_agents: number
      paused_agents: number
      recent_mints: number
      total: number
    }
    pending_proposals: Array<{
      proposal_id: string
      agent_id: string
      title: string
      category: string
      created_at: number | null
    }>
    low_gas_agents: Array<{
      agent_id: string
      agent_name: string
      agent_gas_balance: number
    }>
    paused_agents: Array<{
      agent_id: string
      agent_name: string
      reason: string
      paused_at: number | null
    }>
    recent_mints: Array<{
      agent_id: string
      log_id: string
      candidate_title: string | null
      candidate_url: string | null
      run_at: number | null
      score: number | null
    }>
  }> {
    const response = await fetchWithTimeout(
      `${GCP_BACKEND_URL}/api/v1/owner/inbox?user_wallet=${encodeURIComponent(wallet)}`,
      { method: 'GET' },
      15000,
    )
    return handleAPIResponse(response)
  },

}
