import { motion, useReducedMotion } from 'framer-motion'
import { ChartLineUp, Brain, Signature, ShieldCheck } from '@phosphor-icons/react'

const STEPS = [
  {
    icon: ChartLineUp,
    color: '#00F3FF',
    title: 'Reads the market',
    desc: 'Live prices, trending coins and market sentiment from CoinMarketCap and CoinGecko.',
  },
  {
    icon: Brain,
    color: '#9D00FF',
    title: 'Proposes a next step',
    desc: 'Blends what it learned from videos with that market context into one proposal — reasoning included.',
  },
  {
    icon: Signature,
    color: '#34d399',
    title: 'You decide',
    desc: 'Approve or reject with your wallet signature. The approval is recorded on-chain.',
  },
]

export function DecisionFlowSection() {
  const reduceMotion = useReducedMotion()

  return (
    <section className="max-w-screen-xl mx-auto px-4 sm:px-6 py-20">
      <div className="text-center mb-14">
        <p className="text-xs font-mono uppercase tracking-widest text-violet-400/60 mb-3">From signal to decision</p>
        <h2 className="text-2xl sm:text-4xl font-black mb-3 text-white">It thinks. You make the call.</h2>
        <p className="text-sm text-slate-400 max-w-xl mx-auto">
          Once it has learned enough, your agent starts suggesting what to do next — and shows you exactly why.
        </p>
      </div>

      <div className="relative grid md:grid-cols-3 gap-5">
        {/* Connector line with a travelling pulse (desktop only). */}
        <div className="hidden md:block absolute top-12 left-[16%] right-[16%] h-px bg-gradient-to-r from-cyan-400/30 via-violet-400/30 to-emerald-400/30">
          {!reduceMotion && (
            <motion.span
              className="absolute -top-1 w-2.5 h-2.5 rounded-full bg-white shadow-[0_0_12px_#fff]"
              animate={{ left: ['0%', '100%'], opacity: [0, 1, 1, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
        </div>

        {STEPS.map((step, i) => (
          <motion.div
            key={step.title}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.15 }}
            className="relative flex flex-col items-center text-center px-4"
          >
            <div
              className="relative z-10 w-24 h-24 rounded-2xl flex items-center justify-center border mb-5 bg-[#070815]"
              style={{ borderColor: `${step.color}50`, boxShadow: `0 0 30px ${step.color}25` }}
            >
              <step.icon size={40} weight="duotone" style={{ color: step.color }} />
              <span
                className="absolute -top-2 -left-2 w-6 h-6 rounded-full text-[11px] font-black flex items-center justify-center bg-[#070815] border"
                style={{ borderColor: `${step.color}60`, color: step.color }}
              >
                {i + 1}
              </span>
            </div>
            <h3 className="text-lg font-bold text-white mb-2">{step.title}</h3>
            <p className="text-sm text-slate-400 leading-relaxed max-w-xs">{step.desc}</p>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        className="mt-12 mx-auto max-w-xl flex items-center justify-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/[0.05] px-5 py-2.5 text-xs text-emerald-200"
      >
        <ShieldCheck size={16} weight="duotone" className="shrink-0" />
        No autonomous trading. Your agent never moves funds without your signature.
      </motion.div>
    </section>
  )
}
