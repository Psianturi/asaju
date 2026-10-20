import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { avatarDataUri } from '@/lib/agentAvatar'
import { Agent } from '@/lib/types'

interface NicheAvatarProps {
  agent: Pick<Agent, 'id' | 'name' | 'niche'> & { avatarSeed?: number | null }
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  showRing?: boolean
}

const SIZES = {
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
  lg: 'w-16 h-16',
  xl: 'w-24 h-24',
}

/**
 * The agent's bot avatar, drawn from its id and the owner's chosen seed
 * (see lib/agentAvatar). It is generated inline, so it never fails to load.
 */
export function NicheAvatar({ agent, size = 'md', className, showRing = true }: NicheAvatarProps) {
  const src = useMemo(
    () => avatarDataUri(agent.id, agent.niche, agent.avatarSeed ?? 0),
    [agent.id, agent.niche, agent.avatarSeed],
  )
  return (
    <img
      src={src}
      alt={agent.name}
      draggable={false}
      className={cn(SIZES[size], 'rounded-xl shrink-0 select-none', showRing && 'ring-2 ring-primary/30', className)}
    />
  )
}
