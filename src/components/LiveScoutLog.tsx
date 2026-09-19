import { motion, AnimatePresence } from 'framer-motion'
import { Brain, Eye, Sparkle } from '@phosphor-icons/react'
import { Card } from '@/components/ui/card'
import type { ScoutLogFeedItem } from '@/lib/types'
import { fmtTimeAgo, isFiniteNum } from '@/lib/format'

interface LiveScoutLogProps {
  items: ScoutLogFeedItem[]
  emptyHint?: string
  limit?: number
}

/**
 * LiveScoutLog — compact feed of the agent's most recent attended events.
 *
 * The "live" comes from the backend re-fetching the agent doc whenever the
 * dashboard mounts / refreshes, so this view reflects what the agent has
 * actually watched and summarised — not a static showcase. Each row is a
 * plain Firestore event (title + niche + summary excerpt + timestamp); no LLM
 * post-processing is applied, so the row text is auditable.
 */
export function LiveScoutLog({ items, emptyHint, limit = 5 }: LiveScoutLogProps) {
  const visible = items.slice(0, limit)

  if (visible.length === 0) {
    return (
      <Card className="p-4 border border-border/30 bg-card/30">
        <div className="flex items-center gap-2 mb-1.5">
          <Eye size={14} weight="duotone" className="text-muted-foreground" />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Live scout log</p>
        </div>
        <p className="text-xs text-muted-foreground/70 leading-relaxed">
          {emptyHint ?? 'No events attended yet. Enable Auto Scout or submit a YouTube URL to see the agent learn live.'}
        </p>
      </Card>
    )
  }

  return (
    <Card className="p-4 border border-cyan-400/20 bg-cyan-400/[0.02]">
      <div className="flex items-center gap-2 mb-3">
        <span className="relative flex items-center justify-center w-2 h-2">
          <span className="absolute inset-0 rounded-full bg-cyan-400/40 animate-ping" />
          <span className="relative w-1.5 h-1.5 rounded-full bg-cyan-400" />
        </span>
        <p className="text-xs font-semibold text-cyan-200 uppercase tracking-wider">Live scout log</p>
        <span className="ml-auto text-[10px] text-muted-foreground/60 font-mono">{items.length} event{items.length === 1 ? '' : 's'}</span>
      </div>
      <ul className="space-y-2">
        <AnimatePresence initial={false}>
          {visible.map((item, idx) => (
            <motion.li
              key={item.event_id || `${item.title}-${item.attended_at}-${idx}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: idx * 0.04 }}
              className="group flex flex-col gap-1 rounded-md border border-border/30 bg-background/40 px-3 py-2 hover:border-cyan-400/30 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold truncate flex-1">{item.title}</p>
                <span className="text-[10px] font-mono text-muted-foreground/70 shrink-0 tabular-nums">
                  {isFiniteNum(item.attended_at) && (item.attended_at as number) > 0
                    ? fmtTimeAgo(item.attended_at as number)
                    : '—'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {item.niche && item.niche !== 'General' && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-400/10 border border-cyan-400/25 text-cyan-200 inline-flex items-center gap-1">
                    <Brain size={9} weight="duotone" />
                    {item.niche}
                  </span>
                )}
                {item.summary_excerpt && (
                  <p className="text-[10px] text-muted-foreground/80 leading-snug truncate flex-1" title={item.summary_excerpt}>
                    <Sparkle size={9} weight="duotone" className="inline-block mr-1 align-middle text-amber-300/70" />
                    {item.summary_excerpt}
                  </p>
                )}
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </Card>
  )
}
