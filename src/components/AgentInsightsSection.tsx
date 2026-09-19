import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Sparkle, ArrowRight, Robot } from '@phosphor-icons/react'
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

  // Visitor state — pure CTA
  if (!isConnected) {
    return (
      <Card className="border border-cyan-400/25 bg-gradient-to-br from-cyan-400/[0.05] via-transparent to-violet-400/[0.04] p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-400/15 border border-cyan-400/30 flex items-center justify-center shrink-0">
            <Robot size={18} className="text-cyan-300" weight="duotone" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">What would your agent propose right now?</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Connect your wallet to see insights tailored to your agent's niche and the current market state.
            </p>
          </div>
          <Button onClick={onConnectWallet} size="sm" className="bg-primary hover:bg-primary/90 shrink-0">
            Connect <ArrowRight size={12} className="ml-1" />
          </Button>
        </div>
      </Card>
    )
  }

  // Connected but no agents
  if (!primaryAgent) {
    return (
      <Card className="border border-cyan-400/25 bg-gradient-to-br from-cyan-400/[0.05] via-transparent to-violet-400/[0.04] p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-400/15 border border-cyan-400/30 flex items-center justify-center shrink-0">
            <Robot size={18} className="text-cyan-300" weight="duotone" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">No agents yet</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Spawn an agent to receive market-informed proposals.
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
