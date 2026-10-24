import { Agent, Event, Niche, ScoutedEvent } from '@/lib/types'

export const NICHE_SCOUT_KEYWORDS: Record<Niche, string[]> = {
  'Blockchain/DeFi': ['blockchain', 'defi', 'mantle', 'layer 2', 'rollup', 'smart contract', 'on-chain'],
  'Trading/Investment': ['trading', 'investment', 'market', 'portfolio', 'analysis', 'quant', 'risk'],
  'Technology': ['technology', 'ai', 'agent', 'developer', 'infrastructure', 'architecture', 'automation'],
  'Security': ['security', 'exploit', 'hack', 'audit', 'vulnerability', 'phishing', 'postmortem'],
}

export function tokenizeScoutText(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4)
}

export function computeScoutRelevance(agent: Agent, source: Event): number {
  const base = 55
  const nicheKeywords = NICHE_SCOUT_KEYWORDS[agent.niche] || []
  const agendaKeywords = tokenizeScoutText(agent.customAgenda || '')
  const queryKeywords = [...new Set([...nicheKeywords, ...agendaKeywords])]
  const searchable = `${source.title} ${source.summary} ${source.url} ${source.platform}`.toLowerCase()

  const keywordHits = queryKeywords.reduce((acc, keyword) => (
    searchable.includes(keyword.toLowerCase()) ? acc + 1 : acc
  ), 0)

  const recencyDays = Math.max(0, Math.floor((Date.now() - source.date) / (24 * 60 * 60 * 1000)))
  const recencyBoost = Math.max(0, 12 - Math.min(12, recencyDays))

  return Math.min(98, base + (keywordHits * 7) + recencyBoost)
}

export function buildScoutedOpportunities(agent: Agent, eventPool: Event[]): ScoutedEvent[] {
  const existingUrls = new Set(
    eventPool
      .filter((evt) => evt.agentId === agent.id)
      .map((evt) => evt.url.trim().toLowerCase())
  )

  const dedupedByUrl = new Map<string, Event>()
  eventPool.forEach((evt) => {
    const key = evt.url.trim().toLowerCase()
    if (!key) return
    const previous = dedupedByUrl.get(key)
    if (!previous || evt.date > previous.date) {
      dedupedByUrl.set(key, evt)
    }
  })

  const ranked = Array.from(dedupedByUrl.values())
    .filter((evt) => !existingUrls.has(evt.url.trim().toLowerCase()))
    .map((evt) => ({
      source: evt,
      relevance: computeScoutRelevance(agent, evt),
    }))
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 5)

  const now = Date.now()
  return ranked.map(({ source, relevance }, idx) => ({
    id: `scouted-${agent.id}-${source.id}-${idx}`,
    title: source.title,
    platform: source.platform,
    url: source.url,
    date: now + ((idx + 1) * 2 * 24 * 60 * 60 * 1000),
    description: source.summary,
    relevanceScore: relevance,
    scoutedAt: now,
    approved: false,
  }))
}
