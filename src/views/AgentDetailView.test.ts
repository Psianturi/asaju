import { describe, expect, it } from 'vitest'
import type { Agent, Event, NFT } from './types'

describe('AgentDetailView data shape', () => {
  const baseAgent: Agent = {
    id: 'a-1',
    name: 'Naruto',
    personality: 'Analytical',
    niche: 'Trading/Investment',
    walletAddress: '0xC9AE217e9E854b5e118BCacf48dCEaae3DbB818C',
    chainId: 5003,
    eventsAttended: 5,
    level: 3,
    status: 'active',
    createdAt: Date.now(),
    subAgents: [],
    wisdomUnlocked: true,
    agentGasBalance: 1.021,
    generation: 1,
    breedingCount: 0,
    heritageScore: 5,
  }

  it('required fields present', () => {
    expect(baseAgent.id).toBeTruthy()
    expect(baseAgent.eventsAttended).toBe(5)
    expect(baseAgent.level).toBe(3)
  })

  it('chainId can be undefined (older records)', () => {
    const legacy: Agent = { ...baseAgent, chainId: undefined }
    expect(legacy.chainId).toBeUndefined()
  })

  it('event list filters by agentId', () => {
    const events: Event[] = [
      { id: 'e-1', agentId: 'a-1', url: 'https://youtube.com', title: 'a', date: 1, summary: 'x', status: 'completed' },
      { id: 'e-2', agentId: 'a-2', url: 'https://youtube.com', title: 'b', date: 2, summary: 'y', status: 'completed' },
    ]
    const mine = events.filter(e => e.agentId === 'a-1')
    expect(mine.length).toBe(1)
    expect(mine[0].id).toBe('e-1')
  })

  it('nft list filters by agentId', () => {
    const nfts: NFT[] = [
      { id: 'n-1', agentId: 'a-1', eventId: 'e-1', eventTitle: 'x', summary: 's', date: 1, transactionHash: '0x0', tokenId: '1' },
      { id: 'n-2', agentId: 'a-2', eventId: 'e-2', eventTitle: 'y', summary: 's', date: 2, transactionHash: '0x1', tokenId: '2' },
    ]
    expect(nfts.filter(n => n.agentId === 'a-1').length).toBe(1)
  })

  it('low gas balance is detectable', () => {
    const depleted: Agent = { ...baseAgent, agentGasBalance: 0.01 }
    const low: Agent = { ...baseAgent, agentGasBalance: 0.1 }
    const healthy: Agent = { ...baseAgent, agentGasBalance: 1.0 }
    const status = (g: number) => g > 0.2 ? 'healthy' : g > 0.05 ? 'low' : 'depleted'
    expect(status(depleted.agentGasBalance!)).toBe('depleted')
    expect(status(low.agentGasBalance!)).toBe('low')
    expect(status(healthy.agentGasBalance!)).toBe('healthy')
  })
})