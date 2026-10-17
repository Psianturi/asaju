import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Robot, Sparkle } from '@phosphor-icons/react'
import { ChainBadge } from '@/components/ChainBadge'
import { cloudRunService } from '@/services/cloudRunService'

interface ShowcaseAgent {
  agentName: string
  niche: string
  level: number
  totalEvents: number
  chainId: number
  generation: number
  ownershipStatus: string
}

export function AgentShowcase() {
  const [agents, setAgents] = useState<ShowcaseAgent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    cloudRunService.getPublicAgents()
      .then(data => { if (!cancelled) setAgents(data) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (!loading && agents.length === 0) return null

  return (
    <section className="max-w-screen-xl mx-auto px-4 sm:px-6 py-20">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="text-center mb-12"
      >
        <p className="text-xs font-mono uppercase tracking-widest text-cyan-400/60 mb-3">Agent Showcase</p>
        <h2 className="text-2xl sm:text-4xl font-black mb-3 text-white">Agents already live</h2>
        <p className="text-sm text-slate-400 max-w-xl mx-auto">
          Real agents, real wallets, real wisdom — not a demo.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-cyan-500/10 bg-[#0f1124]/40 p-5 h-40 animate-pulse" />
          ))
        ) : (
          agents.map((agent, i) => (
            <motion.div
              key={`${agent.agentName}-${i}`}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="rounded-2xl border border-cyan-500/15 bg-[#0f1124]/60 backdrop-blur-sm p-5 flex flex-col gap-3 hover:border-cyan-400/30 transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center">
                  <Robot size={18} className="text-cyan-400" weight="duotone" />
                </div>
                <ChainBadge chainId={agent.chainId} showName={false} />
              </div>

              <div>
                <h3 className="text-sm font-bold text-white truncate">{agent.agentName}</h3>
                <p className="text-[10px] text-slate-400 font-mono uppercase tracking-wide">{agent.niche}</p>
              </div>

              <div className="flex items-center gap-4 mt-auto pt-3 border-t border-cyan-500/10 text-[10px] font-mono">
                <span className="text-slate-400">Lv <span className="text-cyan-300 font-bold">{agent.level}</span></span>
                <span className="text-slate-400">{agent.totalEvents} events</span>
              </div>

              {agent.ownershipStatus === 'bred' && (
                <span className="inline-flex items-center gap-1 text-[9px] font-mono text-violet-400/80 w-fit">
                  <Sparkle size={10} weight="fill" />
                  Gen {agent.generation}
                </span>
              )}
            </motion.div>
          ))
        )}
      </div>
    </section>
  )
}
