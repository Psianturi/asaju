import { memo, useId, useMemo } from 'react'
import { motion, useReducedMotion, type TargetAndTransition, type Transition } from 'framer-motion'
import { avatarDataUri } from '@/lib/agentAvatar'
import { fighterLook } from '@/lib/arena'
import { cn } from '@/lib/utils'

/**
 * A full-body "cyber knight" drawn as SVG around the agent's own avatar: the
 * portrait is the head, the armour and energy blade take its colours, so the
 * fighter is unmistakably the same character as the card in My Agents.
 *
 * Whole-body moves (lunge, knock-back, fall) are framer-motion on the wrapper;
 * the sword arm swings with a CSS keyframe so it stays in sync with the lunge.
 */

export type FighterPose = 'idle' | 'slash' | 'kick' | 'combo' | 'blast' | 'hit' | 'stumble' | 'ko' | 'win' | 'guard'

interface FighterProps {
  agentId: string
  name: string
  niche: string
  seed?: number | null
  side: 'left' | 'right'
  pose: FighterPose
  className?: string
}

const METAL = ['#8EA0CF', '#3B4877', '#171E45', '#090C22']

function poseAnimation(pose: FighterPose, dir: 1 | -1, reduce: boolean): { animate: TargetAndTransition; transition: Transition } {
  if (reduce) {
    return pose === 'ko'
      ? { animate: { rotate: dir * 80, y: 34, x: dir * 14, opacity: 0.7 }, transition: { duration: 0.2 } }
      : { animate: { x: 0, y: 0, rotate: 0, opacity: 1 }, transition: { duration: 0.2 } }
  }
  switch (pose) {
    case 'slash':
      return {
        animate: { x: [0, dir * 110, dir * 104, 0], y: [0, -14, -4, 0], rotate: [0, dir * 7, dir * 4, 0], opacity: 1 },
        transition: { duration: 0.9, times: [0, 0.32, 0.6, 1], ease: 'easeOut' },
      }
    case 'kick':
      // Leans back so the leg reaches.
      return {
        animate: { x: [0, dir * 120, dir * 112, 0], y: [0, -22, -8, 0], rotate: [0, -dir * 10, -dir * 6, 0], opacity: 1 },
        transition: { duration: 0.9, times: [0, 0.32, 0.6, 1], ease: 'easeOut' },
      }
    case 'combo':
      return {
        animate: { x: [0, dir * 100, dir * 86, dir * 112, 0], y: [0, -10, -2, -14, 0], rotate: [0, dir * 6, -dir * 3, dir * 9, 0], opacity: 1 },
        transition: { duration: 1.2, times: [0, 0.25, 0.5, 0.72, 1], ease: 'easeOut' },
      }
    case 'blast':
      // Braces, then pushes the energy out from where it stands.
      return {
        animate: { x: [0, -dir * 14, dir * 12, 0], y: [0, 2, -6, 0], rotate: [0, -dir * 4, dir * 3, 0], opacity: 1 },
        transition: { duration: 0.9, times: [0, 0.3, 0.55, 1], ease: 'easeOut' },
      }
    case 'stumble':
      return {
        animate: { x: [0, -dir * 22, -dir * 14, 0], y: [0, 4, 0, 0], rotate: [0, -dir * 8, dir * 3, 0], opacity: 1 },
        transition: { duration: 0.6, times: [0, 0.3, 0.6, 1], ease: 'easeOut' },
      }
    case 'hit':
      return {
        animate: { x: [0, -dir * 46, -dir * 34, 0], y: [0, -6, 0, 0], rotate: [0, -dir * 12, -dir * 7, 0], opacity: 1 },
        transition: { duration: 0.7, times: [0, 0.2, 0.5, 1], ease: 'easeOut' },
      }
    case 'ko':
      // Falls forward, toward the winner, so the body stays inside the stage.
      return {
        animate: { rotate: dir * 82, y: 34, x: dir * 14, opacity: 0.72 },
        transition: { duration: 1.1, ease: [0.4, 0, 1, 1] },
      }
    case 'win':
      return {
        animate: { y: [0, -30, 0, -18, 0], x: 0, rotate: 0, opacity: 1 },
        transition: { duration: 1.4, repeat: Infinity, repeatDelay: 0.6, ease: 'easeOut' },
      }
    case 'guard':
      return { animate: { x: -dir * 8, y: 0, rotate: -dir * 3, opacity: 1 }, transition: { duration: 0.3 } }
    default:
      return {
        animate: { x: 0, y: [0, -6, 0], rotate: 0, opacity: 1 },
        transition: { y: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }, x: { duration: 0.4 }, rotate: { duration: 0.4 }, opacity: { duration: 0.4 } },
      }
  }
}

/** Energy blade, drawn hilt-at-origin pointing up. */
function Blade({ kind, id, a, a2 }: { kind: 0 | 1 | 2; id: string; a: string; a2: string }) {
  const glow = `url(#${id}g)`
  if (kind === 1) {
    return (
      <g>
        <path d="M-3 -2 Q12 -66 5 -138 L-1 -141 Q-11 -66 -4 -2 Z" fill={a} opacity=".55" filter={glow} />
        <path d="M-3 -2 Q12 -66 5 -138 L-1 -141 Q-11 -66 -4 -2 Z" fill={`url(#${id}bl)`} />
        <path d="M-1 -6 Q9 -66 3 -132" fill="none" stroke="#fff" strokeWidth="1.4" opacity=".85" />
        <rect x="-9" y="-6" width="18" height="5" rx="2" fill={METAL[1]} stroke={a2} strokeWidth=".8" />
      </g>
    )
  }
  if (kind === 2) {
    return (
      <g>
        <rect x="-2.5" y="-150" width="5" height="150" rx="2" fill={`url(#${id}m)`} stroke={a2} strokeWidth=".5" />
        <path d="M2 -140 L38 -128 Q46 -108 38 -86 L2 -96 Z" fill={a} opacity=".5" filter={glow} />
        <path d="M2 -140 L38 -128 Q46 -108 38 -86 L2 -96 Z" fill={`url(#${id}bl)`} />
        <path d="M2 -142 L-14 -150 L-14 -86 L2 -94 Z" fill={`url(#${id}m)`} stroke={a2} strokeWidth=".6" />
        <path d="M0 -152 L0 -162" stroke={a} strokeWidth="3" strokeLinecap="round" filter={glow} />
      </g>
    )
  }
  return (
    <g>
      <path d="M-5 -6 L5 -6 L7 -124 L0 -140 L-7 -124 Z" fill={a} opacity=".55" filter={glow} />
      <path d="M-5 -6 L5 -6 L7 -124 L0 -140 L-7 -124 Z" fill={`url(#${id}bl)`} />
      <path d="M0 -8 V-130" stroke="#fff" strokeWidth="1.6" opacity=".9" />
      <rect x="-14" y="-8" width="28" height="6" rx="2" fill={METAL[1]} stroke={a2} strokeWidth=".8" />
      <rect x="-3" y="-2" width="6" height="22" rx="2" fill={METAL[2]} stroke={a2} strokeWidth=".6" />
      <circle cx="0" cy="23" r="3.5" fill={a2} filter={glow} />
    </g>
  )
}

function Emblem({ kind, a, id }: { kind: 0 | 1 | 2; a: string; id: string }) {
  const glow = `url(#${id}g)`
  if (kind === 1) return <g><path d="M100 136 L113 150 L100 164 L87 150 Z" fill={a} opacity=".9" filter={glow} /><path d="M100 140 L109 150 L100 160 L91 150 Z" fill="#0A0F2A" /><path d="M100 144 L105 150 L100 156 L95 150 Z" fill={a} /></g>
  if (kind === 2) return <g><circle cx="100" cy="150" r="12" fill="none" stroke={a} strokeWidth="2.2" filter={glow} /><circle cx="100" cy="150" r="5" fill={a} /><circle cx="100" cy="150" r="12" fill="none" stroke={a} strokeWidth="1" /></g>
  return <g><path d="M100 137 L111.5 143.5 V156.5 L100 163 L88.5 156.5 V143.5 Z" fill={a} opacity=".9" filter={glow} /><path d="M100 141 L108 145.5 V154.5 L100 159 L92 154.5 V145.5 Z" fill="#0A0F2A" /><path d="M100 146 L104 148.5 V153 L100 155.5 L96 153 V148.5 Z" fill={a} /></g>
}

export const Fighter = memo(function Fighter({ agentId, name, niche, seed, side, pose, className }: FighterProps) {
  const reduce = !!useReducedMotion()
  const id = `f${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const look = useMemo(() => fighterLook(agentId, niche, seed ?? 0), [agentId, niche, seed])
  const head = useMemo(() => avatarDataUri(agentId, niche, seed ?? 0), [agentId, niche, seed])
  const dir: 1 | -1 = side === 'left' ? 1 : -1
  const { animate, transition } = poseAnimation(pose, dir, reduce)
  const a = look.accent
  const a2 = look.accent2
  const ARM: Partial<Record<FighterPose, string>> = { slash: 'arena-arm--attack', combo: 'arena-arm--combo', blast: 'arena-arm--blast', idle: 'arena-arm--idle', win: 'arena-arm--idle' }
  const armClass = reduce ? '' : ARM[pose] ?? ''
  const legClass = reduce ? '' : pose === 'kick' ? 'arena-leg--kick' : ''

  return (
    <motion.div
      className={cn('relative select-none', className)}
      style={{ transformOrigin: '50% 95%' }}
      animate={animate}
      transition={transition}
      aria-label={`${name}, ${pose}`}
      role="img"
    >
      <svg viewBox="0 0 200 300" className="w-full h-full overflow-visible">
        <defs>
          <linearGradient id={`${id}m`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={METAL[0]} /><stop offset=".3" stopColor={METAL[1]} />
            <stop offset=".7" stopColor={METAL[2]} /><stop offset="1" stopColor={METAL[3]} />
          </linearGradient>
          <linearGradient id={`${id}bl`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor={a} /><stop offset=".55" stopColor="#ffffff" /><stop offset="1" stopColor={a2} />
          </linearGradient>
          <linearGradient id={`${id}cape`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={a2} stopOpacity=".85" /><stop offset="1" stopColor={look.bg} stopOpacity=".9" />
          </linearGradient>
          <radialGradient id={`${id}aura`} cx=".5" cy=".5" r=".5">
            <stop offset="0" stopColor={a} stopOpacity=".55" /><stop offset="1" stopColor={a} stopOpacity="0" />
          </radialGradient>
          <filter id={`${id}g`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="3.2" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <clipPath id={`${id}hc`}><circle cx="100" cy="70" r="36" /></clipPath>
        </defs>

        <g transform={side === 'right' ? 'translate(200 0) scale(-1 1)' : undefined}>
          {/* Ground: shadow and aura ring. */}
          <ellipse cx="100" cy="284" rx="62" ry="13" fill={`url(#${id}aura)`} />
          <ellipse cx="100" cy="283" rx="48" ry="8" fill="#000" opacity=".5" />
          <ellipse cx="100" cy="284" rx="58" ry="11" fill="none" stroke={a} strokeWidth="1" opacity=".55" />

          {/* Cape, waving behind the body. */}
          {look.cape && (
            <path fill={`url(#${id}cape)`} opacity=".92">
              <animate attributeName="d" dur="3.2s" repeatCount="indefinite"
                values="M70 118 L130 118 Q146 190 138 256 Q118 246 100 258 Q82 246 60 256 Q54 190 70 118 Z;M70 118 L130 118 Q150 184 146 252 Q122 240 100 254 Q78 242 54 250 Q50 186 70 118 Z;M70 118 L130 118 Q146 190 138 256 Q118 246 100 258 Q82 246 60 256 Q54 190 70 118 Z" />
            </path>
          )}

          {/* Back arm. */}
          <path d="M66 124 L48 184 L62 190 L80 134 Z" fill={`url(#${id}m)`} stroke={a2} strokeWidth=".7" strokeOpacity=".7" />
          <circle cx="55" cy="188" r="9" fill={`url(#${id}m)`} stroke={a} strokeWidth="1" />

          {/* Legs. */}
          <path d="M88 186 L72 252 L60 262 L80 270 L98 256 L104 192 Z" fill={`url(#${id}m)`} stroke={a2} strokeWidth=".7" strokeOpacity=".7" />
          <path d="M78 228 L92 224" stroke={a} strokeWidth="1.6" opacity=".9" />
          <path d="M60 262 L80 270" stroke={a} strokeWidth="1.2" opacity=".8" />
          {/* Front leg: swings from the hip for kicks. */}
          <g className={cn('arena-leg', legClass)}>
            <path d="M108 186 L112 254 L102 266 L134 270 L128 254 L126 192 Z" fill={`url(#${id}m)`} stroke={a2} strokeWidth=".7" strokeOpacity=".7" />
            <path d="M114 230 L128 232" stroke={a} strokeWidth="1.6" opacity=".9" />
            <path d="M102 266 L134 270" stroke={a} strokeWidth="1.2" opacity=".8" />
            {pose === 'kick' && <ellipse cx="118" cy="268" rx="20" ry="7" fill={a} opacity=".55" filter={`url(#${id}g)`} />}
          </g>

          {/* Belt and torso. */}
          <path d="M72 118 L128 118 L133 152 L125 188 L75 188 L67 152 Z" fill={`url(#${id}m)`} stroke={a} strokeWidth="1" />
          <path d="M80 124 L100 128 L120 124 L116 180 L84 180 Z" fill="#0B1030" opacity=".55" />
          <path d="M100 126 V182" stroke={a} strokeWidth=".9" opacity=".5" />
          <path d="M84 134 L92 142 M116 134 L108 142 M80 170 L88 164 M120 170 L112 164" stroke={a2} strokeWidth=".9" opacity=".7" />
          <rect x="76" y="182" width="48" height="10" rx="3" fill={`url(#${id}m)`} stroke={a2} strokeWidth=".7" />
          <circle cx="100" cy="187" r="3.2" fill={a} filter={`url(#${id}g)`} />
          <Emblem kind={look.emblem} a={a} id={id} />

          {/* Pauldrons and collar. */}
          <path d="M58 114 Q68 94 94 108 L88 134 Q66 136 58 114 Z" fill={`url(#${id}m)`} stroke={a} strokeWidth="1" />
          <path d="M142 114 Q132 94 106 108 L112 134 Q134 136 142 114 Z" fill={`url(#${id}m)`} stroke={a} strokeWidth="1" />
          <path d="M64 118 Q70 106 88 112 M136 118 Q130 106 112 112" fill="none" stroke={a2} strokeWidth="1.1" opacity=".8" />
          <path d="M80 120 Q100 104 120 120" fill="none" stroke={a} strokeWidth="1.6" opacity=".85" />

          {/* Head: the agent's portrait. */}
          <circle cx="100" cy="70" r="38" fill={look.bg} />
          <image href={head} x="45.5" y="24.2" width="109" height="109" clipPath={`url(#${id}hc)`} preserveAspectRatio="xMidYMid slice" />
          <circle cx="100" cy="70" r="37.5" fill="none" stroke={a} strokeWidth="2.2" opacity=".9" filter={`url(#${id}g)`} />
          <circle cx="100" cy="70" r="37.5" fill="none" stroke={a} strokeWidth="1.2" />
          <path d="M70 92 Q100 118 130 92" fill="none" stroke={a2} strokeWidth="1" opacity=".6" strokeDasharray="3 3" />

          {/* Sword arm, swinging from the shoulder. */}
          <g className={cn('arena-arm', armClass)}>
            <path d="M128 120 L162 150 L154 160 L120 134 Z" fill={`url(#${id}m)`} stroke={a2} strokeWidth=".7" strokeOpacity=".7" />
            <path d="M154 150 L178 168 L170 180 L146 162 Z" fill={`url(#${id}m)`} stroke={a2} strokeWidth=".7" strokeOpacity=".7" />
            <circle cx="172" cy="174" r="10" fill={`url(#${id}m)`} stroke={a} strokeWidth="1.1" />
            {pose === 'blast' && (
              <circle cx="172" cy="174" r="16" fill={a} opacity=".85" filter={`url(#${id}g)`} className="arena-charge" />
            )}
            <g transform="translate(172 174) rotate(34)">
              <Blade kind={look.blade} id={id} a={a} a2={a2} />
            </g>
          </g>
        </g>
      </svg>
      {pose === 'hit' && !reduce && (
        <div className="pointer-events-none absolute inset-0 rounded-full bg-red-500/40 mix-blend-screen" style={{ animation: 'arena-flash .45s ease-out forwards' }} />
      )}
    </motion.div>
  )
})
