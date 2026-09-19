import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkle, ArrowRight, Robot, Eye, Lightbulb, Database } from '@phosphor-icons/react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Agent } from '@/lib/types'
import { cloudRunService } from '@/services/cloudRunService'
import { NicheAvatar } from '@/components/NicheAvatar'
import { fmtTimeAgo } from '@/lib/format'

interface CurrentInsight {
  agent_id: string
  agent_name: string
  niche: string
  watching: string
  suggested_action: string
  sources: string[]
  generated_at: number
}

interface AgentInsightsSectionProps {
  agents: Agent[]
  isConnected: boolean
  onConnectWallet: () => void
  onOpenAgent: (agent: Agent) => void
}

export function AgentInsightsSection({
  agents,
  isConnected,
  onConnectWallet,
  onOpenAgent,
}: AgentInsightsSectionProps) {
  const primaryAgent = agents[0] ?? null
  const [insight, setInsight] = useState<CurrentInsight | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isConnected || !primaryAgent) {
      setInsight(null)
      return
    }
    let cancelled = false
    setLoading(true)
    cloudRunService
      .getCurrentInsight(primaryAgent.id)
      .then(data => { if (!cancelled) setInsight(data as CurrentInsight) })
      .catch(() => { if (!cancelled) setInsight(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [isConnected, primaryAgent?.id])

  // Visitor state — preview what they'll see + CTA
  if (!isConnected) {
    return (
      <Card className="border border-cyan-400/30 bg-gradient-to-br from-cyan-400/[0.06] via-transparent to-violet-400/[0.04] p-4 shadow-lg shadow-cyan-500/5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-400/15 border border-cyan-400/30 flex items-center justify-center shrink-0">
            <Robot size={18} className="text-cyan-300" weight="duotone" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">What your agent would propose, right now</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Live insight grounded in real CMC + CoinGecko data, tailored to your agent's niche.
            </p>
            <div className="mt-2.5 grid grid-cols-3 gap-2">
              <PreviewPill icon={Eye} label="Watching" hint="Live prices & sentiment" color="cyan" />
              <PreviewPill icon={Lightbulb} label="Suggested" hint="One human-approved action" color="amber" />
              <PreviewPill icon={Database} label="Grounded" hint="Raw data you can audit" color="violet" />
            </div>
          </div>
          <Button onClick={onConnectWallet} size="sm" className="bg-gradient-to-r from-primary to-accent hover:opacity-95 text-white shrink-0 self-start shadow-md shadow-primary/30">
            Connect <ArrowRight size={12} className="ml-1" weight="bold" />
        </Button>
      </div>
    </Card>
  )
}

interface PreviewPillProps {
  icon: typeof Eye
  label: string
  hint: string
  color: 'cyan' | 'amber' | 'violet'
}

function PreviewPill({ icon: Icon, label, hint, color }: PreviewPillProps) {
  const colorClasses = {
    cyan: 'bg-cyan-400/10 border-cyan-400/25 text-cyan-200',
    amber: 'bg-amber-400/10 border-amber-400/25 text-amber-200',
    violet: 'bg-violet-400/10 border-violet-400/25 text-violet-200',
  }[color]
  return (
    <div className={`flex items-start gap-1.5 rounded-md border px-2 py-1.5 ${colorClasses}`}>
      <Icon size={11} weight="duotone" className="shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wider leading-tight">{label}</p>
        <p className="text-[9px] leading-snug opacity-80 mt-0.5">{hint}</p>
      </div>
    </div>
  )
}

  // Connected but no agents
  if (!primaryAgent) {
    return (
      <Card className="border border-cyan-400/30 bg-gradient-to-br from-cyan-400/[0.05] via-transparent to-violet-400/[0.04] p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-400/15 border border-cyan-400/30 flex items-center justify-center shrink-0">
            <Robot size={18} className="text-cyan-300" weight="duotone" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">No agents yet</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Spawn an agent to receive market-informed proposals every time the market shifts.
            </p>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card className="border border-cyan-400/25 bg-gradient-to-br from-cyan-400/[0.05] via-transparent to-violet-400/[0.04] overflow-hidden">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkle size={13} className="text-amber-300" weight="fill" />
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground font-mono">
            Agent insight
          </p>
        </div>
        {insight && (
          <p className="text-[9px] text-muted-foreground/60 font-mono tabular-nums">
            {fmtTimeAgo(insight.generated_at * 1000)}
          </p>
        )}
      </div>

      <div className="px-4 pb-4 flex items-start gap-3">
        <NicheAvatar agent={primaryAgent} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <p className="font-bold text-sm">{insight?.agent_name ?? primaryAgent.name}</p>
            <p className="text-[10px] text-muted-foreground font-mono">
              {insight?.niche ?? primaryAgent.niche} · Lv {primaryAgent.level}
            </p>
          </div>

          {loading ? (
            <div className="mt-2 space-y-1.5">
              <div className="h-2.5 w-3/4 bg-white/5 rounded animate-pulse" />
              <div className="h-2.5 w-1/2 bg-white/5 rounded animate-pulse" />
            </div>
          ) : insight ? (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="mt-2 space-y-1.5"
            >
              <p className="text-xs leading-relaxed text-foreground/90">
                <span className="text-muted-foreground font-medium">Watching:</span> {insight.watching}
              </p>
              <p className="text-xs leading-relaxed">
                <span className="text-amber-300/90 font-medium">Suggested:</span> {insight.suggested_action}
              </p>
              <p className="text-[9px] text-muted-foreground/60 font-mono">
                Sources: {insight.sources.join(' · ')}
              </p>
            </motion.div>
          ) : (
            <p className="text-xs text-muted-foreground/70 mt-2">
              Live insight temporarily unavailable — your agent is still tracking the market.
            </p>
          )}
        </div>
        <Button
          onClick={() => onOpenAgent(primaryAgent)}
          size="sm"
          variant="outline"
          className="shrink-0 border-cyan-400/30 text-cyan-300 hover:bg-cyan-400/10"
        >
          Open agent <ArrowRight size={12} className="ml-1" />
        </Button>
      </div>
    </Card>
  )
}
