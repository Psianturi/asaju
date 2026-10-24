import type { Agent } from '@/lib/types'
import { DEFAULT_CHAIN_ID } from '@/lib/blockchain/chains'
import { mantleService } from '@/lib/blockchain/mantleService'
import { cloudRunService, type AgentAuth } from '@/services/cloudRunService'

/** Actions the backend gates behind a fresh owner signature. */
export type SignedAgentAction = 'update_config' | 'delete_agent'

/**
 * Ask the backend for a one-time challenge scoped to this agent + action, and
 * sign it with the connected wallet. The backend checks the signer against the
 * agent's *current on-chain* owner, so this fails cleanly for anyone else.
 */
export async function signAgentAction(agent: Agent, action: SignedAgentAction): Promise<AgentAuth> {
  const challenge = await cloudRunService.requestAgentAuthChallenge({
    agentId: agent.id,
    agentWallet: agent.walletAddress,
    action,
    chainId: agent.chainId ?? DEFAULT_CHAIN_ID,
  })
  const { signature } = await mantleService.signMessage(challenge.message)
  return { nonce: challenge.nonce, signature }
}
