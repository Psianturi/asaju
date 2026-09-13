import { Brain, CheckCircle, Clock, ArrowSquareOut } from '@phosphor-icons/react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Event, NFT } from '@/lib/types'

interface WisdomTimelineProps {
  events: Event[]
  nfts: NFT[]
  limit?: number
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function WisdomTimeline({ events, nfts, limit = 6 }: WisdomTimelineProps) {
  const timeline = [...events]
    .sort((a, b) => b.date - a.date)
    .slice(0, limit)

  return (
    <Card className="glass-card-hover p-5 border border-accent/20">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center">
            <Brain size={19} className="text-accent" weight="duotone" />
          </div>
          <div>
            <h2 className="text-lg font-bold">Wisdom Timeline</h2>
            <p className="text-xs text-muted-foreground">Your agents' latest YouTube learning and proof status</p>
          </div>
        </div>
        <Badge variant="outline" className="text-[10px] border-accent/30 text-accent">
          {events.length} analyzed
        </Badge>
      </div>

      {timeline.length === 0 ? (
        <div className="py-8 text-center border border-dashed border-border/40 rounded-lg">
          <Clock size={24} className="mx-auto mb-2 text-muted-foreground/50" weight="duotone" />
          <p className="text-sm font-semibold">No wisdom recorded yet</p>
          <p className="text-xs text-muted-foreground mt-1">Analyze a YouTube video to start your timeline.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {timeline.map((event, index) => {
            const proof = nfts.find((nft) => nft.eventId === event.id)
            const isLast = index === timeline.length - 1

            return (
              <div key={event.id} className="relative flex gap-3">
                {!isLast && <div className="absolute left-[11px] top-7 bottom-[-4px] w-px bg-border/50" />}
                <div className="relative z-10 mt-1 w-6 h-6 rounded-full bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0">
                  {proof ? <CheckCircle size={13} className="text-emerald-400" weight="fill" /> : <Brain size={12} className="text-accent" weight="duotone" />}
                </div>
                <div className="min-w-0 flex-1 pb-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{event.title}</p>
                      <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                        {formatDate(event.date)} · {event.platform}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[9px] shrink-0 ${proof ? 'border-emerald-500/30 text-emerald-400' : 'border-amber-500/30 text-amber-400'}`}
                    >
                      {proof ? 'Proof minted' : event.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed mt-2 line-clamp-2">{event.summary}</p>
                  {proof?.explorerUrl && (
                    <a
                      href={proof.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[10px] text-primary/70 hover:text-primary mt-2"
                    >
                      <ArrowSquareOut size={10} />
                      View learning proof #{proof.tokenId}
                    </a>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}