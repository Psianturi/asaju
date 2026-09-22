import { motion } from 'framer-motion'
import { Dna, Gavel } from '@phosphor-icons/react'

interface EvolutionShowcaseProps {
  totalBredAgents: number
  totalProposalsApproved: number
}

export function EvolutionShowcase({ totalBredAgents, totalProposalsApproved }: EvolutionShowcaseProps) {
  return (
    <section className="max-w-screen-xl mx-auto px-4 sm:px-6 py-20">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="text-center mb-12"
      >
        <p className="text-xs font-mono uppercase tracking-widest text-violet-400/60 mb-3">Beyond Attending</p>
        <h2 className="text-2xl sm:text-4xl font-black mb-3 text-white">Agents grow up on-chain</h2>
        <p className="text-sm text-slate-400 max-w-xl mx-auto">
          Minting learning proofs is the starting loop — not the ceiling. Agents also breed and govern themselves, verifiably.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="relative p-7 rounded-2xl border border-violet-500/25 bg-[#0f1124]/60 backdrop-blur-sm overflow-hidden"
        >
          <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full opacity-10 blur-2xl bg-violet-500" />
          <div className="relative z-10">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 border border-violet-500/40 bg-violet-500/10">
              <Dna size={24} className="text-violet-400" weight="duotone" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Breeding</h3>
            <p className="text-sm text-slate-400 leading-relaxed mb-4">
              Two agents combine on-chain into a new offspring — its own wallet, its own generation number, its own inherited wisdom heritage score. Not a copy, a lineage.
            </p>
            <div className="flex items-baseline gap-2 pt-3 border-t border-violet-500/10">
              <span className="text-2xl font-black font-mono text-violet-300">{totalBredAgents}</span>
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">agents bred on-chain</span>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="relative p-7 rounded-2xl border border-cyan-500/25 bg-[#0f1124]/60 backdrop-blur-sm overflow-hidden"
        >
          <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full opacity-10 blur-2xl bg-cyan-500" />
          <div className="relative z-10">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 border border-cyan-500/40 bg-cyan-500/10">
              <Gavel size={24} className="text-cyan-400" weight="duotone" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Strategic governance</h3>
            <p className="text-sm text-slate-400 leading-relaxed mb-4">
              An agent proposes a strategy from what it's learned. You approve or reject. Approved proposals are recorded on-chain — human-in-the-loop, not a black box.
            </p>
            <div className="flex items-baseline gap-2 pt-3 border-t border-cyan-500/10">
              <span className="text-2xl font-black font-mono text-cyan-300">{totalProposalsApproved}</span>
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">proposals approved on-chain</span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
