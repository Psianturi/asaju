import { useState } from 'react'
import { cn } from '@/lib/utils'
import { getAgentNicheAvatar, getAgentAvatar } from '@/lib/avatarUtils'
import { Agent } from '@/lib/types'

interface NicheAvatarProps {
  agent: Pick<Agent, 'id' | 'name' | 'niche'>
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  showRing?: boolean
}

/**
 * Renders the niche-themed avatar for an agent.
 *
 * Order:
 *   1. Static PNG from /public/avatars/{niche}/{variant}.png (deterministic by
 *      agent id) — once a designer has exported the artwork, this is the
 *      canonical look.
 *   2. Inline SVG fallback with the niche's accent color — guarantees no blank
 *      image before the PNGs are uploaded.
 *   3. Initials on a colored ring — used only when both above are unavailable
 *      AND the niche is unknown.
 */
export function NicheAvatar({ agent, size = 'md', className, showRing = true }: NicheAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false)
  const nichePick = getAgentNicheAvatar(agent.id, agent.niche)
  const fallback = getAgentAvatar(agent.id, agent.name)

  const sizeMap = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-16 h-16 text-lg',
    xl: 'w-24 h-24 text-2xl',
  }

  const sizeClass = sizeMap[size]

  if (!imageFailed) {
    return (
      <img
        src={nichePick.src}
        alt={agent.name}
        onError={() => setImageFailed(true)}
        className={cn(
          sizeClass,
          showRing && 'ring-2 ring-primary/30',
          'rounded-xl object-cover bg-background/50',
          nichePick.isPlaceholder && 'p-1',
          className,
        )}
      />
    )
  }

  // Tertiary fallback: initials. Reached only if the niche is unknown
  // (so the SVG icon path also won't exist) AND the niche PNG is missing.
  return (
    <div
      className={cn(
        sizeClass,
        'rounded-xl flex items-center justify-center font-bold ring-2',
        fallback.bgColor,
        fallback.textColor,
        showRing && fallback.ringColor,
        className,
      )}
    >
      {fallback.initials || 'AI'}
    </div>
  )
}
