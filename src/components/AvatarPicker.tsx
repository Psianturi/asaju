import { useState } from 'react'
import { Shuffle, Check } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { avatarDataUri, AVATAR_SEED_MAX } from '@/lib/agentAvatar'
import type { Agent } from '@/lib/types'

const CHOICES = 8

const freshSeeds = (keep: number) => {
  const seeds = new Set<number>([keep])
  while (seeds.size < CHOICES) seeds.add(1 + Math.floor(Math.random() * AVATAR_SEED_MAX))
  return [...seeds]
}

/** Pick one of the agent's generated avatars; Shuffle draws a new set. */
export function AvatarPicker({ agent, value, onChange }: {
  agent: Pick<Agent, 'id' | 'name' | 'niche'>
  value: number
  onChange: (seed: number) => void
}) {
  const [seeds, setSeeds] = useState(() => {
    const s = freshSeeds(value)
    return value === 0 ? s : [0, ...s.slice(0, CHOICES - 1)]
  })

  return (
    <div className="flex flex-col sm:flex-row gap-4 items-center sm:items-start">
      <img
        src={avatarDataUri(agent.id, agent.niche, value)}
        alt={`${agent.name} avatar`}
        className="w-28 h-28 rounded-2xl ring-2 ring-primary/40 shadow-[0_0_40px_-8px] shadow-primary/40 shrink-0"
      />
      <div className="flex-1 min-w-0 w-full space-y-2">
        <div role="radiogroup" aria-label="Avatar" className="grid grid-cols-4 gap-2">
          {seeds.map(seed => (
            <button
              key={seed}
              type="button"
              role="radio"
              aria-checked={seed === value}
              aria-label={seed === 0 ? 'Original avatar' : `Avatar option ${seed}`}
              onClick={() => onChange(seed)}
              className={cn(
                'relative rounded-xl overflow-hidden ring-2 transition focus-visible:outline-none focus-visible:ring-primary',
                seed === value ? 'ring-primary' : 'ring-transparent hover:ring-border',
              )}
            >
              <img src={avatarDataUri(agent.id, agent.niche, seed)} alt="" className="w-full aspect-square" />
              {seed === value && (
                <span className="absolute top-1 right-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                  <Check size={10} weight="bold" />
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">Same avatar on every page, for everyone.</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSeeds(freshSeeds(value))} className="text-xs text-primary">
            <Shuffle size={14} className="mr-1.5" />Shuffle
          </Button>
        </div>
      </div>
    </div>
  )
}
