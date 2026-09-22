import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Hand, Lightning, YoutubeLogo, Robot, CheckCircle, Cube, ArrowDown } from '@phosphor-icons/react'

const SAMPLE_URL = 'youtube.com/watch?v=defi-basics'

// Types the sample URL, holds, then restarts — the "you paste a link" beat.
function useTypewriter(text: string, enabled: boolean) {
  const [count, setCount] = useState(enabled ? 0 : text.length)
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => {
      setCount((c) => (c >= text.length + 14 ? 0 : c + 1))
    }, 90)
    return () => clearInterval(id)
  }, [enabled, text.length])
  return { typed: text.slice(0, Math.min(count, text.length)), done: count >= text.length }
}

function ManualVisual({ animate }: { animate: boolean }) {
  const { typed, done } = useTypewriter(SAMPLE_URL, animate)
  return (
    <div className="relative h-44 rounded-xl border border-cyan-500/15 bg-[#070815]/80 p-4 flex flex-col justify-between overflow-hidden">
      <div className="flex items-center gap-2 rounded-lg border border-cyan-500/25 bg-[#0d0f25] px-3 py-2 font-mono text-[11px] text-cyan-200">
        <YoutubeLogo size={14} weight="fill" className="text-rose-400 shrink-0" />
        <span className="truncate">{typed}</span>
        {!done && <span className="w-1.5 h-3.5 bg-cyan-300 animate-pulse" />}
      </div>

      <div className="relative h-8">
        {animate && done && (
          <motion.span
            className="absolute left-4 top-1/2 w-2 h-2 rounded-full bg-cyan-300 shadow-[0_0_12px_#00F3FF]"
            initial={{ x: 0, opacity: 0 }}
            animate={{ x: 220, opacity: [0, 1, 1, 0] }}
            transition={{ duration: 1.1, ease: 'easeInOut' }}
          />
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center">
            <Robot size={18} className="text-cyan-300" weight="duotone" />
          </div>
          <span className="text-[11px] text-slate-400 font-mono">your agent</span>
        </div>
        <motion.span
          className="flex items-center gap-1 text-[11px] font-semibold text-emerald-300"
          animate={{ opacity: done ? 1 : 0.15 }}
        >
          <CheckCircle size={14} weight="fill" />
          wisdom saved
        </motion.span>
      </div>
    </div>
  )
}

// Positions are fixed so the picture is stable across renders.
const VIDEO_DOTS = [
  { x: 22, y: 30 }, { x: 70, y: 22 }, { x: 78, y: 64 }, { x: 34, y: 74 }, { x: 55, y: 45 }, { x: 14, y: 58 },
]
const PICKED = 4

function AutoVisual({ animate }: { animate: boolean }) {
  return (
    <div className="relative h-44 rounded-xl border border-violet-500/15 bg-[#070815]/80 overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative w-36 h-36 rounded-full border border-violet-400/20">
          <div className="absolute inset-4 rounded-full border border-violet-400/15" />
          <div className="absolute inset-9 rounded-full border border-violet-400/10" />
          {animate && (
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{ background: 'conic-gradient(from 0deg, rgba(157,0,255,0.35), transparent 70deg)' }}
              animate={{ rotate: 360 }}
              transition={{ duration: 3.2, repeat: Infinity, ease: 'linear' }}
            />
          )}
          {VIDEO_DOTS.map((dot, i) => {
            const picked = i === PICKED
            return (
              <motion.span
                key={i}
                className={`absolute rounded-sm ${picked ? 'w-3.5 h-2.5 bg-emerald-300 shadow-[0_0_14px_#34d399]' : 'w-2.5 h-2 bg-violet-300/60'}`}
                style={{ left: `${dot.x}%`, top: `${dot.y}%` }}
                animate={animate ? { opacity: picked ? [0.2, 1, 1, 0.2] : [0.15, 0.7, 0.15] } : { opacity: picked ? 1 : 0.5 }}
                transition={{ duration: 3.2, repeat: Infinity, delay: i * 0.45 }}
              />
            )
          })}
        </div>
      </div>
      <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full border border-violet-400/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-mono text-violet-200">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        scouting · every 6h
      </div>
      <div className="absolute bottom-3 right-3 text-[10px] font-mono text-emerald-300/90">
        relevant video picked
      </div>
    </div>
  )
}

const MODES = [
  {
    key: 'manual',
    icon: Hand,
    color: '#00F3FF',
    tag: 'Instant',
    title: 'You teach it',
    lead: 'Found a video worth learning? Hand it to your agent.',
    steps: ['Paste any YouTube link', 'Your agent reads the transcript', 'What it learned is saved to its memory'],
    where: 'Dashboard → "Analyze YouTube URL"',
    Visual: ManualVisual,
  },
  {
    key: 'auto',
    icon: Lightning,
    color: '#9D00FF',
    tag: 'Hands-off',
    title: 'It learns on its own',
    lead: 'Turn on Auto-Scout and let it find videos in its niche.',
    steps: ['Flip the Auto-Scout switch', 'Every 6 hours it searches its niche', 'It keeps only what is relevant'],
    where: 'Your agent\'s card → "Auto-Scout" switch',
    Visual: AutoVisual,
  },
] as const

export function LearningModesSection() {
  const reduceMotion = useReducedMotion()
  const animate = !reduceMotion

  return (
    <section id="learning" className="max-w-screen-xl mx-auto px-4 sm:px-6 py-20 scroll-mt-20">
      <div className="text-center mb-12">
        <p className="text-xs font-mono uppercase tracking-widest text-cyan-400/60 mb-3">How your agent learns</p>
        <h2 className="text-2xl sm:text-4xl font-black mb-3 text-white">Two ways to feed its brain</h2>
        <p className="text-sm text-slate-400 max-w-xl mx-auto">
          Teach it a video yourself, or let it go find its own. Either way, every lesson is kept — and you stay in control.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {MODES.map((mode, i) => (
          <motion.div
            key={mode.key}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.12 }}
            className="rounded-2xl border bg-[#0f1124]/60 backdrop-blur-sm p-6 flex flex-col gap-5"
            style={{ borderColor: `${mode.color}30` }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center border"
                  style={{ borderColor: `${mode.color}50`, background: `${mode.color}15` }}
                >
                  <mode.icon size={22} weight="duotone" style={{ color: mode.color }} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white leading-tight">{mode.title}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">{mode.lead}</p>
                </div>
              </div>
              <span
                className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full border shrink-0"
                style={{ borderColor: `${mode.color}40`, color: mode.color }}
              >
                {mode.tag}
              </span>
            </div>

            <mode.Visual animate={animate} />

            <ol className="space-y-2">
              {mode.steps.map((step, n) => (
                <li key={step} className="flex items-center gap-3 text-sm text-slate-300">
                  <span
                    className="w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0"
                    style={{ background: `${mode.color}20`, color: mode.color }}
                  >
                    {n + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>

            <p className="text-[11px] font-mono text-slate-500 border-t border-white/5 pt-3">
              Where: <span className="text-slate-300">{mode.where}</span>
            </p>
          </motion.div>
        ))}
      </div>

      {/* Both paths converge on the same milestone rule. */}
      <div className="flex justify-center my-5">
        <ArrowDown size={20} className="text-slate-600" />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        className="max-w-2xl mx-auto rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] px-6 py-5 flex flex-col sm:flex-row items-center gap-5"
      >
        <div className="flex items-center gap-2 shrink-0">
          {[0, 1].map((n) => (
            <motion.span
              key={n}
              className="w-3.5 h-3.5 rounded-full border border-emerald-400/60"
              animate={animate ? { backgroundColor: ['rgba(52,211,153,0)', 'rgba(52,211,153,0.9)', 'rgba(52,211,153,0.9)', 'rgba(52,211,153,0)'] } : { backgroundColor: 'rgba(52,211,153,0.9)' }}
              transition={{ duration: 3, repeat: Infinity, delay: n * 0.6, times: [0, 0.2, 0.85, 1] }}
            />
          ))}
          <ArrowDown size={14} className="text-emerald-400/60 -rotate-90" />
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-400/40 flex items-center justify-center">
            <Cube size={18} className="text-emerald-300" weight="duotone" />
          </div>
        </div>
        <p className="text-sm text-slate-300 leading-relaxed text-center sm:text-left">
          <span className="font-semibold text-white">Every lesson is saved. Every level-up is minted on-chain</span> as a
          learning proof — so gas is only spent when your agent actually grows.
        </p>
      </motion.div>
    </section>
  )
}
