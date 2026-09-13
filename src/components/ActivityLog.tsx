import { Pulse, CheckCircle, Info, WarningCircle } from '@phosphor-icons/react'
import { Card } from '@/components/ui/card'
import { TerminalLog } from '@/lib/types'

interface ActivityLogProps {
  logs: TerminalLog[]
  limit?: number
}

const typeConfig = {
  info: { icon: Info, color: 'text-primary' },
  success: { icon: CheckCircle, color: 'text-emerald-400' },
  warning: { icon: WarningCircle, color: 'text-amber-400' },
  error: { icon: WarningCircle, color: 'text-rose-400' },
} as const

export function ActivityLog({ logs, limit = 8 }: ActivityLogProps) {
  const entries = [...logs].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit)

  return (
    <Card className="glass-card-hover p-5 border border-primary/20">
      <div className="flex items-start gap-3 mb-5">
        <div className="w-9 h-9 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
          <Pulse size={19} className="text-primary" weight="duotone" />
        </div>
        <div>
          <h2 className="text-lg font-bold">Activity Log</h2>
          <p className="text-xs text-muted-foreground">Recent activity from your agents and this session</p>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="py-8 text-center border border-dashed border-border/40 rounded-lg">
          <Pulse size={24} className="mx-auto mb-2 text-muted-foreground/50" weight="duotone" />
          <p className="text-sm font-semibold">No activity yet</p>
          <p className="text-xs text-muted-foreground mt-1">Agent actions will appear here as they happen.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {entries.map((entry) => {
            const config = typeConfig[entry.type]
            const Icon = config.icon
            return (
              <div key={entry.id} className="flex items-start gap-3 py-2.5 border-b border-border/20 last:border-0">
                <Icon size={15} className={`${config.color} mt-0.5 shrink-0`} weight="fill" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-relaxed">{entry.message}</p>
                  <p className="text-[10px] text-muted-foreground font-mono mt-1">
                    {new Date(entry.timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}