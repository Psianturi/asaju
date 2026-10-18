import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { UsersThree, ChatsCircle, GraduationCap, Wallet } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'

/**
 * What Agent Room is, shown before a wallet is connected: three agents around
 * a table take turns speaking while lessons travel between them — the whole
 * idea in one moving picture, then three steps and one button.
 */

const ORBS = [
  { x: 120, y: 120, color: '#3FD8EA', name: 'Analyst', lesson: 'Funding rates' },
  { x: 300, y: 62, color: '#E879F9', name: 'Trader', lesson: 'Stablecoin flows' },
  { x: 480, y: 120, color: '#FCD34D', name: 'Researcher', lesson: 'TVL rotation' },
]
// Lessons travel along these arcs (a → b), bowed above the table.
const LINKS = [
  { from: 0, to: 1, d: 'M120 120 Q 190 40 300 62' },
  { from: 1, to: 2, d: 'M300 62 Q 410 40 480 120' },
  { from: 2, to: 0, d: 'M480 120 Q 300 30 120 120' },
]

const STEPS = [
  { icon: UsersThree, title: 'Seat', text: 'Pick 2–4 of your agents and give them a question.' },
  { icon: ChatsCircle, title: 'Discuss', text: 'They debate using only what each has learned — and cite it.' },
  { icon: GraduationCap, title: 'Teach', text: 'Hand the best lessons from one agent to another.' },
]

export function RoomIntro({ onConnectWallet }: { onConnectWallet: () => void }) {
  const reduce = useReducedMotion()
  const [speaker, setSpeaker] = useState(0)

  useEffect(() => {
    if (reduce) return
    const t = setInterval(() => setSpeaker(s => (s + 1) % ORBS.length), 1800)
    return () => clearInterval(t)
  }, [reduce])

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="grid lg:grid-cols-[1.1fr_1fr] gap-0">
        {/* The scene */}
        <div className="bg-gradient-to-b from-primary/[0.06] to-transparent flex items-center p-4">
          {/* Same 2:1 box as the viewBox, so HTML labels line up with the drawing */}
          <div className="relative w-full aspect-[2/1]">
          <svg viewBox="0 0 600 300" className="absolute inset-0 w-full h-full" role="img" aria-label="Three agents around a table passing lessons to each other">
            <defs>
              <radialGradient id="intro-table" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(63,216,234,0.16)" />
                <stop offset="100%" stopColor="rgba(168,139,250,0.04)" />
              </radialGradient>
              <filter id="intro-glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            <ellipse cx="300" cy="190" rx="200" ry="70" fill="url(#intro-table)" stroke="rgba(63,216,234,0.3)" strokeWidth="1" />
            <ellipse cx="300" cy="190" rx="160" ry="52" fill="none" stroke="rgba(63,216,234,0.12)" strokeDasharray="4 5" />

            {LINKS.map((l, i) => (
              <g key={i}>
                <path d={l.d} fill="none" stroke="rgba(168,139,250,0.28)" strokeWidth="1.2" strokeDasharray="3 5" />
                {!reduce && (
                  <circle r="4" opacity="0" fill={ORBS[l.from].color} filter="url(#intro-glow)">
                    <animateMotion dur="3.6s" begin={`${i * 1.2}s`} repeatCount="indefinite" path={l.d} />
                    <animate attributeName="opacity" values="0;1;1;0" dur="3.6s" begin={`${i * 1.2}s`} repeatCount="indefinite" />
                  </circle>
                )}
              </g>
            ))}

            {ORBS.map((o, i) => (
              <g key={o.name}>
                {speaker === i && !reduce && (
                  <circle cx={o.x} cy={o.y} r="26" fill="none" stroke={o.color} strokeWidth="2" opacity="0.8">
                    <animate attributeName="r" values="26;44" dur="1.6s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.8;0" dur="1.6s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle cx={o.x} cy={o.y} r="26" fill="#0B1224" stroke={o.color} strokeWidth={speaker === i ? 3 : 1.5} />
                <circle cx={o.x} cy={o.y} r="9" fill={o.color} opacity={speaker === i ? 1 : 0.5} filter="url(#intro-glow)" />
              </g>
            ))}

            <rect x="272" y="262" width="56" height="22" rx="11" fill="#0B1224" stroke="rgba(252,211,77,0.6)" />
          </svg>
          {/* Labels as HTML so they use the app's fonts */}
          {ORBS.map((o, i) => (
            <p
              key={o.name}
              className="absolute -translate-x-1/2 text-[11px] font-semibold"
              style={{ left: `${(o.x / 600) * 100}%`, top: `${((o.y + 30) / 300) * 100}%`, color: o.color }}
            >
              {o.name}
            </p>
          ))}
          <p className="absolute -translate-x-1/2 -translate-y-1/2 text-[10px] font-semibold text-amber-300" style={{ left: '50%', top: `${(273 / 300) * 100}%` }}>You</p>
          <div className="absolute left-1/2 -translate-x-1/2" style={{ top: `${(170 / 300) * 100}%` }}>
            <AnimatePresence mode="wait">
              <motion.p
                key={speaker}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="whitespace-nowrap rounded-full border border-border/50 bg-background/70 px-3 py-1 text-[11px] text-muted-foreground"
              >
                <span style={{ color: ORBS[speaker].color }}>{ORBS[speaker].name}</span> cites “{ORBS[speaker].lesson}”
              </motion.p>
            </AnimatePresence>
          </div>
          </div>
        </div>

        {/* The pitch */}
        <div className="p-6 sm:p-8 flex flex-col justify-center gap-5">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <p className="text-[11px] font-mono uppercase tracking-widest text-primary/80">Agent Room</p>
            <h3 className="text-2xl sm:text-3xl font-bold tracking-tight mt-1">Let your agents think together</h3>
            <p className="text-sm text-muted-foreground mt-2">
              Each agent speaks only from what it has studied. You watch them agree, disagree and teach each other — and join in whenever you like.
            </p>
          </motion.div>
          <ol className="space-y-3">
            {STEPS.map((s, i) => (
              <motion.li
                key={s.title}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.12 }}
                className="flex gap-3 items-start"
              >
                <span className="h-9 w-9 shrink-0 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center">
                  <s.icon size={18} weight="duotone" className="text-primary" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{i + 1}. {s.title}</span>
                  <span className="block text-xs text-muted-foreground">{s.text}</span>
                </span>
              </motion.li>
            ))}
          </ol>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55 }} className="space-y-1.5">
            <Button onClick={onConnectWallet} className="w-full sm:w-auto">
              <Wallet size={16} className="mr-1.5" />Connect wallet to open a room
            </Button>
            <p className="text-[11px] text-muted-foreground">Only the wallet that owns the agents can seat them. Signing is free and can’t move funds.</p>
          </motion.div>
        </div>
      </div>
    </div>
  )
}
