import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export type StatTone = 'primary' | 'emerald' | 'accent' | 'amber' | 'slate'

const TONES: Record<StatTone, { icon: string; chip: string }> = {
  primary: { icon: 'text-primary', chip: 'from-primary/25' },
  emerald: { icon: 'text-emerald-400', chip: 'from-emerald-500/25' },
  accent: { icon: 'text-accent', chip: 'from-accent/25' },
  amber: { icon: 'text-amber-400', chip: 'from-amber-500/25' },
  slate: { icon: 'text-muted-foreground', chip: 'from-white/10' },
}

/** One headline number with its icon: the summary row on Dashboard and My Agents. */
export function StatTile({ label, value, icon, tone, sublabel, loading }: {
  label: string
  value: ReactNode
  icon: ReactNode
  tone: StatTone
  sublabel?: string
  loading?: boolean
}) {
  const t = TONES[tone]
  return (
    <Card className="glass-card relative overflow-hidden p-4 border border-border/30 flex-row items-center gap-3">
      <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br to-transparent', t.chip, t.icon)}>
        {icon}
      </div>
      <div className="min-w-0">
        {loading ? (
          <div className="h-6 w-12 rounded bg-muted/40 animate-pulse" />
        ) : (
          <p className={cn('font-black leading-none tabular-nums', typeof value === 'string' && value.length > 4 ? 'text-lg' : 'text-2xl')}>{value}</p>
        )}
        <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold leading-tight">{label}</p>
        {sublabel && <p className="mt-0.5 text-[10px] text-muted-foreground/80 truncate">{sublabel}</p>}
      </div>
    </Card>
  )
}
