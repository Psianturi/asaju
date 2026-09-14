import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { RarityTier, Agent, Event } from './types'

export const WISDOM_UNLOCK_THRESHOLD = 5

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Agents are never marked 'active' by any loader, so auto-scout is the only
// real signal that an agent works on its own. Shared so views can't drift apart.
export function isAgentAutoScouting(agent: Agent): boolean {
  return agent.autoScoutEnabled === true
}

// agent.eventsAttended is a counter that can start inflated for bred offspring
// (inherited via formula, not backed 1:1 by real event docs — see agents.py).
// Counting the actual docs is the source of truth; shared so every view agrees.
export function countActualVideosAnalyzed(agents: Agent[], events: Event[]): number {
  const agentIds = new Set(agents.map(a => a.id))
  return events.filter(e => agentIds.has(e.agentId)).length
}

export function calculateRarityTier(agent: Agent): RarityTier {
  const generation = agent.generation ?? 1
  const level = agent.level
  const eventsAttended = agent.eventsAttended
  const wisdomUnlocked = agent.wisdomUnlocked

  if (generation >= 5 || (generation >= 4 && wisdomUnlocked && level >= 8)) {
    return 'mythic'
  }
  
  if (generation >= 4 || (generation === 3 && wisdomUnlocked && level >= 6)) {
    return 'legendary'
  }
  
  if (generation >= 3 || (wisdomUnlocked && level >= 5)) {
    return 'epic'
  }
  
  if (generation === 2 || level >= 3) {
    return 'rare'
  }
  
  return 'common'
}

export function getRarityStyles(rarity: RarityTier): {
  borderClass: string
  glowClass: string
  badgeClass: string
  textClass: string
  bgClass: string
} {
  switch (rarity) {
    case 'mythic':
      return {
        borderClass: 'border-2 border-amber-400/60',
        glowClass: 'animate-glow-pulse-gold',
        badgeClass: 'bg-gradient-to-r from-amber-400 to-yellow-500 text-black',
        textClass: 'text-amber-400',
        bgClass: 'bg-gradient-to-br from-amber-500/10 to-yellow-500/10'
      }
    case 'legendary':
      return {
        borderClass: 'border-2 border-orange-400/50',
        glowClass: 'animate-glow-pulse-orange',
        badgeClass: 'bg-gradient-to-r from-orange-400 to-red-500 text-white',
        textClass: 'text-orange-400',
        bgClass: 'bg-gradient-to-br from-orange-500/10 to-red-500/10'
      }
    case 'epic':
      return {
        borderClass: 'border-2 border-secondary/50',
        glowClass: 'animate-glow-pulse-purple',
        badgeClass: 'bg-gradient-to-r from-secondary to-accent text-white',
        textClass: 'text-secondary',
        bgClass: 'bg-gradient-to-br from-secondary/10 to-accent/10'
      }
    case 'rare':
      return {
        borderClass: 'border-2 border-primary/40',
        glowClass: 'animate-glow-pulse',
        badgeClass: 'bg-gradient-to-r from-primary to-accent text-white',
        textClass: 'text-primary',
        bgClass: 'bg-gradient-to-br from-primary/10 to-accent/10'
      }
    default:
      return {
        borderClass: 'border border-border/30',
        glowClass: '',
        badgeClass: 'bg-muted text-muted-foreground',
        textClass: 'text-muted-foreground',
        bgClass: 'bg-muted/5'
      }
  }
}

export function getRarityLabel(rarity: RarityTier): string {
  switch (rarity) {
    case 'mythic':
      return '✨ MYTHIC'
    case 'legendary':
      return '🔥 LEGENDARY'
    case 'epic':
      return '💎 EPIC'
    case 'rare':
      return '⚡ RARE'
    default:
      return 'COMMON'
  }
}
