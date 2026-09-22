import { useEffect, useState, useRef, useCallback, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { ChainBadge } from '@/components/ChainBadge'
import { AgentShowcase } from '@/components/AgentShowcase'
import { EvolutionShowcase } from '@/components/EvolutionShowcase'
import { FAQSection } from '@/components/FAQSection'
import { LearningModesSection } from '@/components/LearningModesSection'
import { DecisionFlowSection } from '@/components/DecisionFlowSection'
import { cloudRunService } from '@/services/cloudRunService'
import { getSupportedChains } from '@/lib/blockchain/chains'
import type { WisdomFeedItem } from '@/components/FeaturedWisdomFeed'
import {
  Robot, ArrowRight, Brain, Dna, ShieldCheck,
  Signature, Binoculars, Cube, Pulse, Lightning, ChartLineUp,
} from '@phosphor-icons/react'
import maefLogo from '@/assets/maef-logo.png'

// Landing page is often visited before any wallet connection — defer the
// three.js hero visual so first paint isn't blocked by its bundle weight.
const AgentSphere = lazy(() => import('@/components/AgentSphere').then(m => ({ default: m.AgentSphere })))

// ── Types ─────────────────────────────────────────────────────────────────────
interface PlatformMetrics {
  total_agents: number
  total_wisdom_nfts: number
  total_events_attended: number
  average_agent_level: number
  total_bred_agents: number
  total_proposals_approved: number
}

interface ActivityEntry {
  id: string
  agentName: string
  action: string
  detail: string
  chainId: number
  timestamp: number
}

// ── Lifecycle stages (circular loop) ──────────────────────────────────────────
const LIFECYCLE_STAGES = [
  { icon: Robot, label: 'Spawn Agent', color: '#00F3FF', angle: 0 },
  { icon: Binoculars, label: 'Learn', color: '#9D00FF', angle: 60 },
  { icon: ChartLineUp, label: 'Read Market', color: '#00F3FF', angle: 120 },
  { icon: Brain, label: 'Propose', color: '#9D00FF', angle: 180 },
  { icon: Signature, label: 'You Sign', color: '#00F3FF', angle: 240 },
  { icon: Dna, label: 'Level Up & Mint', color: '#9D00FF', angle: 300 },
]

// ── Pillars ───────────────────────────────────────────────────────────────────
const PILLARS = [
  {
    icon: ShieldCheck,
    color: '#00F3FF',
    title: 'Owns its wallet',
    desc: 'Cryptographic identity, encrypted keys, gas reserve. It signs — not you.',
    badges: ['Encrypted key', 'No seed phrase shared', 'Signs its own transactions'],
  },
  {
    icon: Cube,
    color: '#9D00FF',
    title: 'Permanent proof',
    desc: 'Every level-up is minted as a verifiable on-chain NFT — gas is spent only when your agent actually grows.',
    badges: ['On-chain NFT', 'Mantle', 'Ethereum Sepolia'],
  },
  {
    icon: Dna,
    color: '#00F3FF',
    title: 'Evolves & breeds',
    desc: 'Levels up, proposes strategies, and produces offspring that inherit wisdom.',
    badges: ['Gemini', 'Skill Scores', 'Breeding'],
  },
]

// ── Animated counter ──────────────────────────────────────────────────────────
function AnimatedNumber({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    const duration = 1500
    const start = performance.now()
    let raf: number

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(value * eased)
      if (progress < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])

  return <>{display.toFixed(decimals)}</>
}

// ── Component ─────────────────────────────────────────────────────────────────
export function LandingPage() {
  const navigate = useNavigate()
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [activityLoading, setActivityLoading] = useState(true)
  const [wisdomPreview, setWisdomPreview] = useState<WisdomFeedItem[]>([])
  const [activeStage, setActiveStage] = useState(0)

  const supportedChains = getSupportedChains()

  // Fetch metrics
  useEffect(() => {
    cloudRunService.getPublicMetrics()
      .then(d => setMetrics(d))
      .catch(() => {})
  }, [])

  // Fetch real activity + wisdom preview
  useEffect(() => {
    let cancelled = false

    async function loadData() {
      try {
        const wisdom = await cloudRunService.getPublicFeaturedWisdom()
        if (cancelled) return
        setWisdomPreview(wisdom)

        const activity: ActivityEntry[] = wisdom.slice(0, 6).map((w, i) => ({
          id: `act-${w.agentId}-${i}`,
          agentName: w.agentName,
          action: 'minted',
          detail: `Minted learning proof for "${w.eventTitle}"`,
          chainId: w.chainId ?? 5003,
          timestamp: w.attendedAt * 1000,
        }))

        setActivity(activity)
        setActivityLoading(false)
      } catch {
        setActivityLoading(false)
      }
    }

    loadData()
    return () => { cancelled = true }
  }, [])

  // Cycle active lifecycle stage for the glow animation
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveStage(prev => (prev + 1) % LIFECYCLE_STAGES.length)
    }, 2500)
    return () => clearInterval(interval)
  }, [])

  const formatRelativeTime = useCallback((timestamp: number) => {
    const diff = Date.now() - timestamp
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  }, [])

  const radius = 140 // px from center for lifecycle circle

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#070815] text-slate-100">
      {/* Subtle radial glow background */}
      <div className="fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_top,rgba(0,243,255,0.06),transparent_50%)]" />
      <div className="fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(157,0,255,0.04),transparent_50%)]" />

      <div className="relative z-10">
        {/* ── Nav ──────────────────────────────────────────────────────────── */}
        <nav className="border-b border-cyan-500/10 bg-[#070815]/90 backdrop-blur-md sticky top-0 z-40">
          <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img src={maefLogo} alt="ASAJU AI" className="h-9 w-auto object-contain" />
              <div>
                <span className="text-sm font-black tracking-widest text-cyan-300">ASAJU AI</span>
                <p className="text-[9px] text-slate-500 font-mono hidden sm:block leading-none mt-0.5">Autonomous Agent Intelligence</p>
              </div>
            </div>
            <Button
              onClick={() => navigate('/dashboard')}
              className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:opacity-90 font-semibold shadow-lg shadow-cyan-500/20 h-9 px-5 text-sm text-white border border-cyan-400/30"
            >
              Launch App
              <ArrowRight className="ml-1.5" size={14} weight="bold" />
            </Button>
          </div>
        </nav>

        {/* ── Hero with 3D agent sphere ─────────────────────────────────────── */}
        <section className="relative overflow-hidden">
          <div className="max-w-screen-xl mx-auto px-4 sm:px-6 pt-16 pb-12">
            <div className="grid lg:grid-cols-2 gap-8 items-center">
              {/* Left: text */}
              <motion.div
                initial={{ opacity: 0, x: -30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6 }}
              >
                <div className="flex items-center gap-2 mb-6">
                  {supportedChains.map(chain => (
                    <ChainBadge key={chain.chainId} chainId={chain.chainId} />
                  ))}
                  <span className="text-[9px] uppercase tracking-widest text-amber-400/80 border border-amber-500/30 px-1.5 py-0.5 rounded font-mono">Testnet</span>
                </div>

                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight mb-5 leading-[1.1]">
                  <span className="text-white">Autonomous agents</span>
                  <br />
                  <span className="bg-gradient-to-r from-cyan-400 via-cyan-300 to-violet-400 bg-clip-text text-transparent">
                    that live on-chain
                  </span>
                </h1>

                <p className="text-base sm:text-lg text-slate-400 max-w-xl leading-relaxed mb-8">
                  Spawn an AI agent with its own wallet. It learns from YouTube — when you ask, or on its own — reads live crypto markets, and suggests what to do next. You approve. Every milestone is proven on-chain.
                </p>

                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-10">
                  <Button
                    onClick={() => navigate('/dashboard')}
                    size="lg"
                    className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:opacity-90 font-bold px-8 shadow-xl shadow-cyan-500/30 text-base text-white border border-cyan-400/40 h-12"
                  >
                    <Robot className="mr-2" weight="duotone" size={22} />
                    Spawn Your First Agent
                    <ArrowRight className="ml-2" size={18} weight="bold" />
                  </Button>
                  <a href="#learning" className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-cyan-400 transition-colors">
                    See how it works
                    <ArrowRight size={13} />
                  </a>
                </div>

                {/* Animated metrics */}
                {metrics && (
                  <div className="flex items-center gap-8">
                    {[
                      { label: 'agents', value: metrics.total_agents, decimals: 0 },
                      { label: 'NFTs', value: metrics.total_wisdom_nfts, decimals: 0 },
                      { label: 'avg level', value: metrics.average_agent_level, decimals: 1 },
                    ].map(({ label, value, decimals }) => (
                      <div key={label}>
                        <p className="text-2xl font-black font-mono text-cyan-300">
                          <AnimatedNumber value={value} decimals={decimals} />
                        </p>
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">{label}</p>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>

              {/* Right: 3D agent sphere */}
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.8, delay: 0.2 }}
                className="relative h-[400px] sm:h-[480px] lg:h-[520px]"
              >
                <Suspense fallback={<div className="w-full h-full rounded-full" style={{ background: 'radial-gradient(circle, rgba(0,243,255,0.1), transparent 60%)' }} />}>
                  <AgentSphere className="w-full h-full" />
                </Suspense>
                {/* Labels overlay */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none text-center">
                  <p className="text-[9px] font-mono uppercase tracking-widest text-cyan-400/40">core</p>
                  <p className="text-[9px] font-mono text-slate-600">agent identity</p>
                </div>
                {/* Orbit legend */}
                <div className="absolute bottom-4 right-4 space-y-1 text-[9px] font-mono text-slate-500">
                  <p className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-cyan-400" /> sub-agents</p>
                  <p className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-violet-400" /> event memory</p>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        <LearningModesSection />

        {/* ── Agent Lifecycle — circular animated loop ──────────────────────── */}
        <section id="lifecycle" className="max-w-screen-xl mx-auto px-4 sm:px-6 py-20 scroll-mt-20">
          <div className="text-center mb-16">
            <p className="text-xs font-mono uppercase tracking-widest text-cyan-400/60 mb-3">Agent Lifecycle</p>
            <h2 className="text-2xl sm:text-4xl font-black mb-3 text-white">The loop that makes it smarter</h2>
            <p className="text-sm text-slate-400 max-w-xl mx-auto">
              Spawn an agent, let it learn, watch it read the market and propose a move, sign what you agree with — and see it level up, with every milestone minted on-chain.
            </p>
          </div>

          {/* Circular loop */}
          <div className="flex justify-center">
            <div className="relative w-[340px] h-[340px] sm:w-[420px] sm:h-[420px]">
              {/* Circle track */}
              <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(0,243,255,0.1)" strokeWidth="0.4" strokeDasharray="2,2" />
              </svg>

              {/* Rotating glow arc */}
              <motion.div
                className="absolute inset-0"
                animate={{ rotate: 360 }}
                transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
              >
                <svg className="w-full h-full" viewBox="0 0 100 100">
                  <circle
                    cx="50" cy="50" r="45" fill="none"
                    stroke="url(#lifecycleGlow)" strokeWidth="1.5"
                    strokeLinecap="round" strokeDasharray="20,263"
                  />
                  <defs>
                    <linearGradient id="lifecycleGlow" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#00F3FF" stopOpacity="0" />
                      <stop offset="50%" stopColor="#00F3FF" stopOpacity="0.8" />
                      <stop offset="100%" stopColor="#9D00FF" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                </svg>
              </motion.div>

              {/* Center label */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
                <p className="text-[10px] font-mono uppercase tracking-widest text-slate-600">learning</p>
                <p className="text-[10px] font-mono uppercase tracking-widest text-slate-600">loop</p>
              </div>

              {/* Stage nodes positioned on circle */}
              {LIFECYCLE_STAGES.map((stage, i) => {
                const rad = (stage.angle - 90) * (Math.PI / 180)
                const x = Math.cos(rad) * radius
                const y = Math.sin(rad) * radius
                const isActive = activeStage === i

                return (
                  <motion.div
                    key={stage.label}
                    className="absolute top-1/2 left-1/2"
                    style={{ x, y }}
                    animate={{ scale: isActive ? 1.15 : 1 }}
                    transition={{ duration: 0.3 }}
                  >
                    <div
                      className="flex flex-col items-center gap-2 -translate-x-1/2 -translate-y-1/2"
                      style={{ width: 120 }}
                    >
                      <div
                        className="w-14 h-14 rounded-2xl flex items-center justify-center border transition-all duration-500"
                        style={{
                          borderColor: isActive ? `${stage.color}80` : `${stage.color}30`,
                          background: isActive ? `${stage.color}20` : `${stage.color}08`,
                          boxShadow: isActive ? `0 0 30px ${stage.color}50, 0 0 60px ${stage.color}20` : `0 0 10px ${stage.color}10`,
                        }}
                      >
                        <stage.icon
                          size={26}
                          style={{ color: stage.color, opacity: isActive ? 1 : 0.5 }}
                          weight={isActive ? 'fill' : 'duotone'}
                        />
                      </div>
                      <span
                        className="text-sm font-bold transition-colors duration-500"
                        style={{ color: isActive ? '#ffffff' : '#64748b' }}
                      >
                        {stage.label}
                      </span>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </div>
        </section>

        <DecisionFlowSection />

        <AgentShowcase />

        {/* ── Recent Activity + Dashboard Preview ───────────────────────────── */}
        <section className="max-w-screen-xl mx-auto px-4 sm:px-6 py-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-12"
          >
            <h2 className="text-2xl sm:text-3xl font-black mb-2 text-white">Agents are building knowledge</h2>
            <p className="text-sm text-slate-400">Real wisdom from real events — verified on-chain.</p>
          </motion.div>

          <div className="grid lg:grid-cols-3 gap-5">
            {/* Activity terminal */}
            <div className="rounded-2xl border border-cyan-500/15 bg-[#08091a]/90 backdrop-blur-md overflow-hidden font-mono">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-cyan-500/10 bg-[#0d0f25]/60">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500/60" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/60" />
                </div>
                <span className="text-[10px] text-slate-600">activity</span>
              </div>

              <div className="p-4 space-y-2.5 min-h-[280px]">
                {activityLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 animate-pulse">
                      <div className="w-2 h-2 rounded-full bg-slate-700" />
                      <div className="h-3 bg-slate-800 rounded w-full" />
                    </div>
                  ))
                ) : activity.length === 0 ? (
                  <div className="text-center py-12 text-slate-600 text-xs">
                    <Pulse size={28} className="mx-auto mb-3 text-slate-700" weight="duotone" />
                    No verified mints yet.
                  </div>
                ) : (
                  <AnimatePresence initial={false}>
                    {activity.map((entry) => (
                      <motion.div
                        key={entry.id}
                        initial={{ opacity: 0, x: -16 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-start gap-2 text-xs leading-relaxed"
                      >
                        <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 bg-emerald-400" />
                        <span className="text-slate-600 text-[10px] mt-0.5 flex-shrink-0 w-12">
                          {formatRelativeTime(entry.timestamp)}
                        </span>
                        <span className="text-slate-300 flex-1">
                          <span className="text-cyan-400 font-semibold">{entry.agentName}</span>
                          {' '}
                          <span className="text-slate-400">{entry.detail}</span>
                        </span>
                        <ChainBadge chainId={entry.chainId} showName={false} className="mt-0.5" />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )}
              </div>
            </div>

            {/* Wisdom preview cards — real data from backend */}
            <div className="lg:col-span-2 grid sm:grid-cols-2 gap-4">
              {wisdomPreview.length === 0 ? (
                <div className="sm:col-span-2 rounded-2xl border border-cyan-500/10 bg-[#0f1124]/40 p-8 text-center">
                  <Brain size={32} className="mx-auto mb-3 text-slate-700" weight="duotone" />
                  <p className="text-sm text-slate-500">Wisdom summaries appear here once agents analyze YouTube videos.</p>
                </div>
              ) : (
                wisdomPreview.slice(0, 4).map((w, i) => (
                  <motion.div
                    key={`${w.agentId}-${i}`}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.08 }}
                    className="rounded-2xl border border-cyan-500/15 bg-[#0f1124]/60 backdrop-blur-sm p-5 flex flex-col gap-3 hover:border-cyan-400/30 transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-cyan-400">{w.agentName}</span>
                      <ChainBadge chainId={w.chainId ?? 5003} showName={false} />
                    </div>
                    <h4 className="text-sm font-bold text-white line-clamp-2 leading-snug">{w.eventTitle}</h4>
                    <p className="text-xs text-slate-400 leading-relaxed line-clamp-3 flex-1">{w.wisdomSummary}</p>
                    <div className="flex items-center justify-between pt-2 border-t border-cyan-500/10">
                      <span className="text-[10px] font-mono text-slate-600">{w.platform}</span>
                      {w.txHash && (
                        <a
                          href={`${getSupportedChains().find(c => c.chainId === (w.chainId ?? 5003))?.explorerUrl}/tx/${w.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] font-mono text-cyan-400/60 hover:text-cyan-400 transition-colors"
                        >
                          view tx ↗
                        </a>
                      )}
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* ── Why On-Chain (3 Pillars) ─────────────────────────────────────── */}
        <section className="max-w-screen-xl mx-auto px-4 sm:px-6 py-20">
          <div className="text-center mb-14">
            <p className="text-xs font-mono uppercase tracking-widest text-violet-400/60 mb-3">Why On-Chain</p>
            <h2 className="text-2xl sm:text-4xl font-black mb-3 text-white">Not just AI. An agent with its own wallet.</h2>
            <p className="text-sm text-slate-400 max-w-xl mx-auto">
              Most AI agents live in a database. Yours live on a blockchain.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {PILLARS.map((pillar, i) => (
              <motion.div
                key={pillar.title}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="relative p-7 rounded-2xl border bg-[#0f1124]/60 backdrop-blur-sm overflow-hidden group transition-all"
                style={{ borderColor: `${pillar.color}25` }}
              >
                <div
                  className="absolute -top-12 -right-12 w-32 h-32 rounded-full opacity-10 blur-2xl group-hover:opacity-25 transition-opacity"
                  style={{ background: pillar.color }}
                />
                <div className="relative z-10">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 border"
                    style={{ borderColor: `${pillar.color}40`, background: `${pillar.color}10` }}
                  >
                    <pillar.icon size={24} style={{ color: pillar.color }} weight="duotone" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-2">{pillar.title}</h3>
                  <p className="text-sm text-slate-400 leading-relaxed mb-4">{pillar.desc}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {pillar.badges.map(badge => (
                      <span
                        key={badge}
                        className="text-[9px] font-mono px-2 py-0.5 rounded-full border"
                        style={{ borderColor: `${pillar.color}30`, color: `${pillar.color}cc`, background: `${pillar.color}0a` }}
                      >
                        {badge}
                      </span>
                    ))}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {metrics && (
          <EvolutionShowcase
            totalBredAgents={metrics.total_bred_agents}
            totalProposalsApproved={metrics.total_proposals_approved}
          />
        )}

        <FAQSection />

        {/* ── Final CTA ────────────────────────────────────────────────────── */}
        <section className="max-w-screen-xl mx-auto px-4 sm:px-6 py-20 pb-28">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="relative rounded-3xl overflow-hidden border border-cyan-500/20 p-10 sm:p-16 text-center"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-[#070815] to-violet-500/10" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,243,255,0.08),transparent_70%)]" />
            <div className="relative z-10">
              <div className="w-16 h-16 mx-auto mb-6 rounded-2xl border border-cyan-400/30 flex items-center justify-center bg-cyan-500/10">
                <Lightning size={32} className="text-cyan-400" weight="duotone" />
              </div>
              <h2 className="text-2xl sm:text-4xl font-black mb-4 text-white">Give your AI a wallet.</h2>
              <p className="text-sm text-slate-400 max-w-md mx-auto mb-10 leading-relaxed">
                Connect once, choose a chain, and spawn an agent that learns, reads the market, and proposes — while you make the call.
              </p>

              <div className="flex items-center justify-center gap-3 mb-8">
                {supportedChains.map(chain => (
                  <button
                    key={chain.chainId}
                    onClick={() => navigate('/dashboard')}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold border transition-all hover:scale-105"
                    style={{ borderColor: `${chain.color}30`, background: `${chain.color}10`, color: chain.color }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: chain.color }} />
                    {chain.name}
                  </button>
                ))}
              </div>

              <Button
                onClick={() => navigate('/dashboard')}
                size="lg"
                className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:opacity-90 font-bold px-12 shadow-xl shadow-cyan-500/30 text-base text-white border border-cyan-400/40 h-12"
              >
                <Robot className="mr-2" weight="duotone" size={20} />
                Launch App
                <ArrowRight className="ml-2" size={18} weight="bold" />
              </Button>
            </div>
          </motion.div>
        </section>

        {/* ── Footer ────────────────────────────────────────────────────────── */}
        <footer className="border-t border-cyan-500/10 bg-[#050610] py-8">
          <div className="max-w-screen-xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <img src={maefLogo} alt="ASAJU AI" className="h-7 w-auto object-contain" />
              <span className="text-xs font-bold tracking-widest text-slate-500">ASAJU AI</span>
            </div>

            <div className="flex items-center gap-3 text-[10px] font-mono">
              {supportedChains.map(chain => (
                <a
                  key={chain.chainId}
                  href={`${chain.explorerUrl}/address/${chain.contractAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-slate-500 hover:text-cyan-400 transition-colors"
                >
                  <span className="w-1 h-1 rounded-full" style={{ background: chain.color }} />
                  {chain.shortName} ↗
                </a>
              ))}
            </div>

            <p className="text-[10px] text-slate-600 font-mono">Testnet · Not financial advice</p>
          </div>
        </footer>
      </div>
    </div>
  )
}
