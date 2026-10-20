import { Brain, ChatCircle, Coins, Dna, PencilSimple, Target, UserCircle } from '@phosphor-icons/react'
import { Card } from '@/components/ui/card'
import { TermHint } from '@/components/TermHint'
import { cn, WISDOM_UNLOCK_THRESHOLD } from '@/lib/utils'
import type { Agent } from '@/lib/types'

const SUB_AGENTS = {
  secretary: { icon: UserCircle, label: 'Secretary' },
  scribe: { icon: PencilSimple, label: 'Scribe' },
  'social-lite': { icon: ChatCircle, label: 'Social-Lite' },
  'mint-master': { icon: Coins, label: 'Mint-Master' },
} as const

const SUB_STATUS: Record<string, string> = {
  active: 'bg-emerald-400', processing: 'bg-amber-400', error: 'bg-rose-500', idle: 'bg-slate-500',
}

/** How the agent is growing: comprehension, wisdom, skills, lineage and its helpers. */
export function AgentGrowthCard({ agent, videosAnalyzed }: { agent: Agent; videosAnalyzed: number }) {
  const hasComprehension = agent.comprehensionScore !== undefined
  const wisdom = Math.min(100, (videosAnalyzed / WISDOM_UNLOCK_THRESHOLD) * 100)
  const skills = Object.entries(agent.skillScores ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 6)

  return (
    <Card className="glass-card p-5 border border-border/30 gap-5">
      <div className="grid gap-5 md:grid-cols-2">
        {hasComprehension && (
          <div>
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-semibold">
                <Target size={14} weight="duotone" className="text-accent" />Comprehension <TermHint term="comprehension" />
              </span>
              <span className="font-mono tabular-nums text-accent">
                {agent.comprehensionScore}/100
                {agent.comprehensionNextMilestone != null && (
                  <span className="ml-1.5 text-muted-foreground">· {agent.comprehensionProgressToNext} to next mint</span>
                )}
              </span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-accent to-amber-400" style={{ width: `${Math.min(100, agent.comprehensionScore ?? 0)}%` }} />
              {[20, 40, 60, 80].map(m => <div key={m} aria-hidden className="absolute inset-y-0 w-px bg-background/70" style={{ left: `${m}%` }} />)}
            </div>
            {(agent.comprehensionSampledNiches ?? []).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {(agent.comprehensionSampledNiches ?? []).slice(0, 4).map(n => (
                  <span key={n} className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[10px] font-mono text-accent/80">{n}</span>
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-semibold"><Brain size={14} weight="duotone" className="text-primary" />Wisdom <TermHint term="wisdom" /></span>
            <span className="font-mono tabular-nums text-primary">
              {agent.wisdomUnlocked ? `${videosAnalyzed} videos · unlocked` : `${videosAnalyzed}/${WISDOM_UNLOCK_THRESHOLD}`}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div className={cn('h-full rounded-full', agent.wisdomUnlocked ? 'bg-gradient-to-r from-amber-400 to-orange-500' : 'bg-gradient-to-r from-primary via-accent to-secondary')} style={{ width: `${wisdom}%` }} />
          </div>
        </div>
      </div>

      {skills.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold text-muted-foreground">Skills earned from videos</p>
          <div className="flex flex-wrap gap-1.5">
            {skills.map(([category, score]) => (
              <span key={category} className="inline-flex items-center gap-1 rounded-full border border-accent/25 bg-accent/10 px-2 py-1 text-[11px] font-mono text-accent">
                {category}<span className="font-bold">{score}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {agent.lineageBiography && (agent.generation ?? 1) >= 2 && (
        <div className="rounded-lg border border-secondary/20 bg-secondary/5 p-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-secondary"><Dna size={13} weight="duotone" />Lineage</p>
          <p className="whitespace-pre-line text-xs italic leading-relaxed text-muted-foreground">{agent.lineageBiography}</p>
        </div>
      )}

      {agent.subAgents.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {agent.subAgents.map(sub => {
            const meta = SUB_AGENTS[sub.type]
            if (!meta) return null
            const Icon = meta.icon
            return (
              <span key={sub.type} title={sub.description} className="inline-flex items-center gap-1.5 rounded-lg border border-border/40 bg-white/[0.03] px-2.5 py-1.5 text-[11px]">
                <Icon size={14} weight="duotone" className="text-muted-foreground" />
                {meta.label}
                <span className={cn('h-1.5 w-1.5 rounded-full', SUB_STATUS[sub.status] ?? SUB_STATUS.idle)} aria-label={sub.status} />
              </span>
            )
          })}
        </div>
      )}
    </Card>
  )
}
