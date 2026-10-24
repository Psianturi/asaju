import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowDown, ArrowUp, Lightning, LockKey, ArrowCounterClockwise } from '@phosphor-icons/react'
import { Fighter, type FighterPose } from '@/components/arena/Fighter'
import {
  fighterLook, fmtCountdown, fmtMove, hpBefore, hpTone, isSealed, resolvedCount, strikeSteps,
  type ArenaDuel, type ArenaRound, type RevealedPick,
} from '@/lib/arena'
import { fmtPrice } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * The fight itself. Rounds settle on the server; this stage replays each
 * settled round as blows — reveal both calls, lunge, hit, HP drain, then the
 * K.O. or decision — and counts down to the next settlement in between.
 */

interface DuelStageProps {
  duel: ArenaDuel
  startHp?: number
  /** Ask the server to settle a due round. Called once the countdown hits zero. */
  onAdvance?: () => Promise<unknown>
}

interface Floater { id: number; side: 0 | 1; text: string; kind: 'hit' | 'recoil' | 'flat' | 'miss' }
interface Banner { text: string; sub?: string; sticky?: boolean }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Neon city backdrop, seeded by the duel so every fight has its own skyline. */
function Backdrop({ seed, left, right }: { seed: string; left: string; right: string }) {
  const towers = useMemo(() => {
    let h = 5381
    for (let i = 0; i < seed.length; i++) h = ((h * 33) ^ seed.charCodeAt(i)) >>> 0
    const r = prng(h)
    const far: Array<{ x: number; w: number; h: number }> = []
    const near: Array<{ x: number; w: number; h: number; lights: Array<[number, number]> }> = []
    for (let x = -10; x < 1010;) { const w = 24 + r() * 50; far.push({ x, w, h: 60 + r() * 120 }); x += w + 2 }
    for (let x = -20; x < 1020;) {
      const w = 36 + r() * 70; const hh = 40 + r() * 150
      const lights: Array<[number, number]> = []
      for (let ly = 8; ly < hh - 6; ly += 12) for (let lx = 6; lx < w - 6; lx += 10) if (r() < 0.2) lights.push([lx, ly])
      near.push({ x, w, h: hh, lights }); x += w + 6
    }
    return { far, near }
  }, [seed])

  return (
    <svg viewBox="0 0 1000 480" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 w-full h-full" aria-hidden="true">
      <defs>
        <linearGradient id="arena-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#03040C" /><stop offset=".55" stopColor="#0A0F2E" /><stop offset="1" stopColor="#141A4A" />
        </linearGradient>
        <radialGradient id="arena-moon" cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#E9F4FF" /><stop offset=".6" stopColor="#B8D7FF" stopOpacity=".9" /><stop offset="1" stopColor="#7AA7FF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="arena-floorg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0C1030" /><stop offset="1" stopColor="#05070F" />
        </linearGradient>
        <radialGradient id="arena-spot-l" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor={left} stopOpacity=".38" /><stop offset="1" stopColor={left} stopOpacity="0" /></radialGradient>
        <radialGradient id="arena-spot-r" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor={right} stopOpacity=".38" /><stop offset="1" stopColor={right} stopOpacity="0" /></radialGradient>
      </defs>
      <rect width="1000" height="480" fill="url(#arena-sky)" />
      <circle cx="760" cy="120" r="70" fill="url(#arena-moon)" opacity=".8" />
      <g opacity=".55">{towers.far.map((t, i) => <rect key={i} x={t.x} y={330 - t.h} width={t.w} height={t.h} fill="#0A0E2A" />)}</g>
      <g>
        {towers.near.map((t, i) => (
          <g key={i}>
            <rect x={t.x} y={340 - t.h} width={t.w} height={t.h} fill="#06081A" stroke="#1A2050" strokeWidth=".6" />
            {t.lights.map(([lx, ly], j) => <rect key={j} x={t.x + lx} y={340 - t.h + ly} width="3" height="4" fill={j % 2 ? left : right} opacity=".55" />)}
          </g>
        ))}
      </g>
      <rect x="0" y="338" width="1000" height="3" fill={left} opacity=".7" />
      <rect x="0" y="338" width="1000" height="3" fill={right} opacity=".4" />
      <rect x="0" y="340" width="1000" height="140" fill="url(#arena-floorg)" />
      <g stroke="#2BD9FF" strokeOpacity=".13" strokeWidth="1">
        {Array.from({ length: 13 }, (_, i) => <line key={i} x1="500" y1="340" x2={-300 + i * 133} y2="480" />)}
      </g>
      <ellipse cx="270" cy="440" rx="200" ry="34" fill="url(#arena-spot-l)" />
      <ellipse cx="730" cy="440" rx="200" ry="34" fill="url(#arena-spot-r)" />
      {Array.from({ length: 14 }, (_, i) => (
        <circle key={i} cx={40 + ((i * 173) % 920)} cy={30 + ((i * 97) % 260)} r={1 + (i % 3) * 0.6} fill={i % 2 ? left : right} opacity=".6">
          <animate attributeName="opacity" values=".15;.8;.15" dur={`${2.2 + (i % 5) * 0.7}s`} repeatCount="indefinite" />
        </circle>
      ))}
    </svg>
  )
}

function HpBar({ name, rating, level, hp, max, side, accent }: { name: string; rating?: number; level: number; hp: number; max: number; side: 0 | 1; accent: string }) {
  const pct = Math.max(0, Math.min(100, (hp / max) * 100))
  const tone = hpTone(hp, max)
  const fill = tone === 'high' ? `linear-gradient(90deg, ${accent}, #7CFFD4)` : tone === 'mid' ? 'linear-gradient(90deg, #FBBF24, #F59E0B)' : 'linear-gradient(90deg, #F87171, #DC2626)'
  return (
    <div className={cn('flex-1 min-w-0', side === 1 && 'text-right')}>
      <div className={cn('flex items-baseline gap-2 mb-1', side === 1 && 'flex-row-reverse')}>
        <p className="text-sm font-bold truncate drop-shadow">{name}</p>
        <p className="hidden sm:block text-[10px] font-mono text-white/70">Lv {level}{rating !== undefined && ` · ${rating}`}</p>
      </div>
      <div className={cn('relative h-3.5 rounded-sm bg-black/60 border border-white/15 overflow-hidden', side === 1 && 'scale-x-[-1]')}>
        <motion.div className="absolute inset-y-0 left-0 bg-white/60" animate={{ width: `${pct}%` }} transition={{ duration: 1.1, ease: 'easeOut', delay: 0.25 }} />
        <motion.div className="absolute inset-y-0 left-0" style={{ backgroundImage: fill }} animate={{ width: `${pct}%` }} transition={{ duration: 0.35, ease: 'easeOut' }} />
        <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent 0 9%, rgba(0,0,0,.5) 9% 10%)' }} />
      </div>
      <p className={cn('mt-0.5 text-[10px] font-mono text-white/80')}>{Math.max(0, Math.round(hp))} / {max}</p>
    </div>
  )
}

function Confidence({ n }: { n: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`confidence ${n} of 3`}>
      {[1, 2, 3].map(i => <Lightning key={i} size={12} weight="fill" className={i <= n ? 'text-amber-300' : 'text-white/20'} />)}
    </span>
  )
}

function PickCard({ pick, name, side }: { pick: RevealedPick | undefined; name: string; side: 0 | 1 }) {
  if (!pick) return null
  const up = pick.direction === 'up'
  const tone = pick.result === 'hit' ? 'border-emerald-400/60' : pick.result === 'miss' ? 'border-red-400/50' : 'border-white/20'
  return (
    <motion.div
      initial={{ opacity: 0, x: side === 0 ? -24 : 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
      className={cn('rounded-lg border bg-black/60 backdrop-blur px-3 py-2 min-w-0', tone, side === 1 && 'text-right')}
    >
      <div className={cn('flex items-center gap-2', side === 1 && 'flex-row-reverse')}>
        <span className={cn('inline-flex items-center gap-1 text-xs font-bold', up ? 'text-emerald-300' : 'text-red-300')}>
          {up ? <ArrowUp size={14} weight="bold" /> : <ArrowDown size={14} weight="bold" />}{up ? 'UP' : 'DOWN'}
        </span>
        <Confidence n={pick.confidence} />
        {pick.fallback && <span className="text-[9px] uppercase tracking-wider text-white/50">momentum fallback</span>}
      </div>
      <p className="text-[11px] text-white/85 leading-snug mt-1 line-clamp-3">{name}: {pick.reasoning || '—'}</p>
      {pick.cited.length > 0 && (
        <p className="hidden sm:block text-[10px] text-white/50 mt-1 truncate">from: {pick.cited.join(' · ')}</p>
      )}
    </motion.div>
  )
}

export function DuelStage({ duel, startHp = 100, onAdvance }: DuelStageProps) {
  const reduce = !!useReducedMotion()
  const [a, b] = duel.fighters
  const lookA = useMemo(() => fighterLook(a.agent_id, a.niche, a.avatar_seed ?? 0), [a.agent_id, a.niche, a.avatar_seed])
  const lookB = useMemo(() => fighterLook(b.agent_id, b.niche, b.avatar_seed ?? 0), [b.agent_id, b.niche, b.avatar_seed])

  const initialPlayed = duel.status === 'finished' ? Math.max(0, resolvedCount(duel) - 1) : resolvedCount(duel)
  const [hp, setHp] = useState<[number, number]>(() => hpBefore(duel, initialPlayed, startHp))
  const [poses, setPoses] = useState<[FighterPose, FighterPose]>(['idle', 'idle'])
  const [reveal, setReveal] = useState<ArenaRound | null>(null)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [floaters, setFloaters] = useState<Floater[]>([])
  const [shake, setShake] = useState(false)
  const [now, setNow] = useState(() => Date.now() / 1000)
  const [replayKey, setReplayKey] = useState(0)
  const [playing, setPlaying] = useState(false)

  const duelRef = useRef(duel)
  duelRef.current = duel
  const playedRef = useRef(initialPlayed)
  const busyRef = useRef(false)
  const aliveRef = useRef(true)
  const floaterId = useRef(0)
  const advancingRef = useRef(0)

  // StrictMode mounts twice; the flag must come back on the second mount.
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false } }, [])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(t)
  }, [])

  const addFloater = useCallback((side: 0 | 1, text: string, kind: Floater['kind']) => {
    const id = ++floaterId.current
    setFloaters(f => [...f, { id, side, text, kind }])
    setTimeout(() => setFloaters(f => f.filter(x => x.id !== id)), 1500)
  }, [])

  const playRound = useCallback(async (d: ArenaDuel, index: number) => {
    const r = d.rounds[index]
    if (!r || r.status !== 'resolved') return
    const wait = (ms: number) => sleep(reduce ? Math.min(ms, 200) : ms)
    setBanner({ text: `ROUND ${r.round}`, sub: `${r.symbol} ${fmtMove(r.move)}` })
    await wait(1000)
    setBanner(null)
    setReveal(r)
    await wait(2200)
    for (const step of strikeSteps(r)) {
      if (!aliveRef.current) return
      if (step.kind === 'hit') {
        setPoses(p => { const n = [...p] as [FighterPose, FighterPose]; n[step.actor] = 'attack'; return n })
        await wait(300)
        setPoses(p => { const n = [...p] as [FighterPose, FighterPose]; n[step.target] = 'hit'; return n })
        setShake(true)
        addFloater(step.target, `-${step.amount}`, 'hit')
        setHp(h => { const n = [...h] as [number, number]; n[step.target] = Math.max(0, n[step.target] - step.amount); return n })
        await wait(750)
        setShake(false)
      } else if (step.kind === 'recoil') {
        setPoses(p => { const n = [...p] as [FighterPose, FighterPose]; n[step.actor] = 'hit'; return n })
        addFloater(step.actor, `-${step.amount} recoil`, 'recoil')
        setHp(h => { const n = [...h] as [number, number]; n[step.actor] = Math.max(0, n[step.actor] - step.amount); return n })
        await wait(750)
      } else if (step.kind === 'whiff') {
        setPoses(p => { const n = [...p] as [FighterPose, FighterPose]; n[step.actor] = 'attack'; return n })
        await wait(300)
        addFloater(step.target, 'MISS', 'miss')
        await wait(500)
      } else {
        addFloater(step.actor, 'FLAT', 'flat')
        await wait(500)
      }
      setPoses(['idle', 'idle'])
      await wait(250)
    }
    setReveal(null)
  }, [addFloater, reduce])

  const playEnd = useCallback(async (d: ArenaDuel) => {
    if (d.result === 'draw') {
      setPoses(['guard', 'guard'])
      setBanner({ text: 'DRAW', sub: 'Even on HP after the final round', sticky: true })
      return
    }
    const w = d.winner === d.fighters[0].agent_id ? 0 : 1
    setPoses(w === 0 ? ['win', 'ko'] : ['ko', 'win'])
    await sleep(reduce ? 100 : 500)
    setBanner({ text: d.result === 'ko' ? 'K.O.' : 'DECISION', sub: `${d.fighters[w].name} wins`, sticky: true })
  }, [reduce])

  // Replay every settled round the stage has not shown yet, in order.
  useEffect(() => {
    const run = async () => {
      if (busyRef.current) return
      busyRef.current = true
      setPlaying(true)
      try {
        while (aliveRef.current && playedRef.current < resolvedCount(duelRef.current)) {
          const idx = playedRef.current
          await playRound(duelRef.current, idx)
          playedRef.current = idx + 1
        }
        if (aliveRef.current && duelRef.current.status === 'finished') await playEnd(duelRef.current)
      } finally {
        busyRef.current = false
        if (aliveRef.current) setPlaying(false)
      }
    }
    void run()
  }, [duel, playRound, playEnd, replayKey])

  // Settle a due round: once right away, then every 20s while the server catches up.
  const sealed = duel.status === 'live' && duel.rounds[duel.rounds.length - 1]?.status === 'sealed' ? duel.rounds[duel.rounds.length - 1] : null
  const secondsLeft = sealed ? sealed.resolve_at - now : 0
  useEffect(() => {
    if (!sealed || secondsLeft > 0 || !onAdvance) return
    if (now - advancingRef.current < 20) return
    advancingRef.current = now
    void onAdvance()
  }, [sealed, secondsLeft, now, onAdvance])

  const replay = () => {
    if (busyRef.current) return
    playedRef.current = 0
    setHp([startHp, startHp])
    setPoses(['idle', 'idle'])
    setBanner(null)
    setReplayKey(k => k + 1)
  }

  const current = duel.rounds[duel.rounds.length - 1]
  const roundNo = Math.min(duel.rounds_total, Math.max(1, (reveal?.round ?? playedRef.current) || current?.round || 1))
  const revealPicks = (reveal?.picks || []).filter(p => !isSealed(p)) as RevealedPick[]

  return (
    <div className={cn('relative w-full aspect-[5/4] sm:aspect-[16/9] lg:aspect-[2/1] rounded-2xl overflow-hidden border border-primary/20 shadow-[0_0_40px_rgba(0,243,255,0.08)]', shake && !reduce && 'arena-shake')}>
      <Backdrop seed={duel.duel_id} left={lookA.accent} right={lookB.accent} />
      <div className="absolute inset-x-0 bottom-0 h-[29%] arena-floor opacity-70" />
      <div className="absolute inset-0 arena-scanlines pointer-events-none" />
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.55) 100%)' }} />

      {/* Fighters */}
      <div className="absolute left-[6%] sm:left-[9%] bottom-[9%] w-[32%] sm:w-[24%] max-w-[260px]">
        <Fighter agentId={a.agent_id} name={a.name} niche={a.niche} seed={a.avatar_seed} side="left" pose={poses[0]} />
      </div>
      <div className="absolute right-[6%] sm:right-[9%] bottom-[9%] w-[32%] sm:w-[24%] max-w-[260px]">
        <Fighter agentId={b.agent_id} name={b.name} niche={b.niche} seed={b.avatar_seed} side="right" pose={poses[1]} />
      </div>

      {/* Damage numbers */}
      {floaters.map(f => (
        <div
          key={f.id}
          className={cn(
            'absolute top-[38%] arena-float pointer-events-none font-black tracking-tight drop-shadow-[0_2px_0_rgba(0,0,0,.8)]',
            f.side === 0 ? 'left-[18%]' : 'right-[18%]',
            f.kind === 'hit' ? 'text-4xl text-red-400' : f.kind === 'recoil' ? 'text-2xl text-orange-300' : 'text-xl text-white/70',
          )}
        >
          {f.text}
        </div>
      ))}

      {/* HUD */}
      <div className="absolute inset-x-0 top-0 p-3 sm:p-4 flex items-start gap-3 sm:gap-6 text-white">
        <HpBar name={a.name} rating={a.rating_after ?? a.rating} level={a.level} hp={hp[0]} max={startHp} side={0} accent={lookA.accent} />
        <div className="shrink-0 text-center min-w-[88px]">
          <p className="text-[10px] uppercase tracking-[0.25em] text-white/60">Round</p>
          <p className="text-2xl font-black leading-none">{roundNo}<span className="text-sm text-white/50">/{duel.rounds_total}</span></p>
          <div className="flex justify-center gap-1 mt-1">
            {Array.from({ length: duel.rounds_total }, (_, i) => (
              <span key={i} className={cn('h-1.5 w-3 rounded-sm', i < playedRef.current ? 'bg-primary' : i < duel.rounds.length ? 'bg-amber-300/70' : 'bg-white/20')} />
            ))}
          </div>
        </div>
        <HpBar name={b.name} rating={b.rating_after ?? b.rating} level={b.level} hp={hp[1]} max={startHp} side={1} accent={lookB.accent} />
      </div>

      {/* Round status */}
      <div className="absolute left-1/2 -translate-x-1/2 top-[30%] sm:top-[19%] text-center text-white">
        {sealed ? (
          <div className="inline-flex flex-col items-center rounded-lg bg-black/55 backdrop-blur px-3 py-1.5 border border-white/10">
            <p className="text-[10px] uppercase tracking-widest text-white/60 flex items-center gap-1"><LockKey size={11} /> {sealed.symbol} · {duel.horizon} · calls sealed</p>
            <p className={cn('font-mono text-lg font-bold leading-tight', secondsLeft <= 0 && 'text-amber-300')}>
              {secondsLeft > 0 ? fmtCountdown(secondsLeft) : 'Settling…'}
            </p>
            <p className="text-[10px] text-white/60">open {fmtPrice(sealed.open_price)}</p>
          </div>
        ) : duel.status === 'finished' && !playing ? (
          <button type="button" onClick={replay} className="inline-flex items-center gap-1 rounded-lg bg-black/55 backdrop-blur px-3 py-1.5 border border-white/10 text-xs hover:border-primary/50">
            <ArrowCounterClockwise size={13} /> Replay
          </button>
        ) : null}
      </div>

      {/* Banner */}
      <AnimatePresence>
        {banner && (
          <motion.div key={banner.text + (banner.sub || '')} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-white">
            <p className={cn('arena-banner text-5xl sm:text-7xl font-black italic tracking-tighter drop-shadow-[0_0_24px_rgba(0,243,255,.6)]', banner.text === 'K.O.' && 'text-red-400 drop-shadow-[0_0_30px_rgba(248,113,113,.8)]')}>
              {banner.text}
            </p>
            {banner.sub && <p className="mt-1 text-sm font-semibold text-white/85 drop-shadow">{banner.sub}</p>}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reveal */}
      <AnimatePresence>
        {reveal && (
          <motion.div key={reveal.round} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} className="absolute inset-x-2 sm:inset-x-4 bottom-2 sm:bottom-3 grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-1.5 sm:gap-2 items-end text-white">
            <PickCard pick={revealPicks[0]} name={a.name} side={0} />
            <div className="rounded-lg bg-black/70 backdrop-blur px-3 py-1.5 sm:py-2 text-center border border-white/15 order-first sm:order-none">
              <p className="text-[10px] uppercase tracking-widest text-white/60">{reveal.symbol} · {duel.horizon}</p>
              <p className={cn('text-xl font-black', (reveal.move ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300')}>{fmtMove(reveal.move)}</p>
              <p className="text-[10px] font-mono text-white/60">{fmtPrice(reveal.open_price)} → {fmtPrice(reveal.close_price)}</p>
            </div>
            <PickCard pick={revealPicks[1]} name={b.name} side={1} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
