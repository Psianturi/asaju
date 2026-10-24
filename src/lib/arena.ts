/**
 * Arena (Agent Duel) — types mirrored from backend/services/arena.py and the
 * pure helpers the stage uses to turn a settled round into a fight sequence.
 */
import { avatarParts, paletteKey } from '@/lib/agentAvatar'

export type Horizon = '15m' | '1h' | '4h'

export interface ArenaConfig {
  enabled: boolean
  start_hp: number
  min_rounds: number
  max_rounds: number
  default_rounds: number
  horizons: Horizon[]
  default_horizon: Horizon
  assets: string[]
  hit: Record<string, number>
  recoil: Record<string, number>
  duels_per_day: number
}

export interface ArenaFighter {
  agent_id: string
  name: string
  niche: string
  personality: string
  level: number
  lessons: number
  chain_id: number
  avatar_seed?: number | null
  owner: string
  hp: number
  rating?: number
  rating_before?: number
  rating_after?: number
}

export interface SealedPick { agent_id: string; commit: string; sealed: true }
export interface RevealedPick {
  agent_id: string
  direction: 'up' | 'down'
  confidence: 1 | 2 | 3
  reasoning: string
  cited: string[]
  fallback: boolean
  commit: string
  hit?: number
  recoil?: number
  result?: 'hit' | 'miss' | 'flat'
}
export type ArenaPick = SealedPick | RevealedPick

export interface ArenaRound {
  round: number
  asset: string
  symbol: string
  open_price: number
  opened_at: number
  resolve_at: number
  status: 'sealed' | 'resolved'
  close_price?: number
  move?: number
  resolved_at?: number
  hp_after?: [number, number]
  picks?: ArenaPick[]
  market?: { price: number; change_24h: number; fear_greed?: number | null; fear_greed_label?: string | null }
}

export interface ArenaDuel {
  duel_id: string
  status: 'live' | 'finished'
  owner: string
  rounds_total: number
  horizon: Horizon
  horizon_seconds: number
  fighters: [ArenaFighter, ArenaFighter]
  rounds: ArenaRound[]
  winner: string | null
  result: 'ko' | 'decision' | 'draw' | null
  created_at: number
  updated_at: number
  finished_at?: number
}

export interface ArenaRating {
  agent_id: string
  name: string
  niche: string
  avatar_seed?: number | null
  owner: string
  chain_id: number
  level: number
  rating: number
  wins: number
  losses: number
  draws: number
  kos: number
  streak: number
  open_to_challenges: boolean
  duels?: number
}

export const ARENA_DEFAULTS: ArenaConfig = {
  enabled: false, start_hp: 100, min_rounds: 3, max_rounds: 7, default_rounds: 5,
  horizons: ['15m', '1h', '4h'], default_horizon: '15m', assets: ['BTC', 'ETH', 'SOL', 'BNB', 'MNT'],
  hit: { 1: 14, 2: 22, 3: 30 }, recoil: { 1: 0, 2: 6, 3: 12 }, duels_per_day: 6,
}

export const HORIZON_LABEL: Record<Horizon, string> = { '15m': '15 minutes', '1h': '1 hour', '4h': '4 hours' }

export const isSealed = (p: ArenaPick): p is SealedPick => (p as SealedPick).sealed === true

/** HP of both fighters going into round `index` (0-based). */
export function hpBefore(duel: Pick<ArenaDuel, 'rounds'>, index: number, startHp = 100): [number, number] {
  for (let i = index - 1; i >= 0; i--) {
    const after = duel.rounds[i]?.hp_after
    if (after) return [after[0], after[1]]
  }
  return [startHp, startHp]
}

export const resolvedCount = (duel: Pick<ArenaDuel, 'rounds'>) => duel.rounds.filter(r => r.status === 'resolved').length

/** "12:34" countdown; "0:00" once due. */
export function fmtCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

export function fmtMove(move: number | undefined): string {
  if (move === undefined || Number.isNaN(move)) return '—'
  const pct = move * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(Math.abs(pct) < 0.1 ? 3 : 2)}%`
}

export const shortAddr = (a: string | undefined) => (a && a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || '')

/** One blow in the replay of a settled round, in the order it lands. */
export interface StrikeStep {
  actor: 0 | 1
  target: 0 | 1
  kind: 'hit' | 'recoil' | 'flat' | 'whiff'
  amount: number
}

export function strikeSteps(round: ArenaRound): StrikeStep[] {
  const picks = (round.picks || []) as ArenaPick[]
  if (round.status !== 'resolved' || picks.length < 2) return []
  const steps: StrikeStep[] = []
  picks.forEach((p, i) => {
    if (isSealed(p)) return
    const actor = i as 0 | 1
    const target = (1 - i) as 0 | 1
    if (p.result === 'flat') steps.push({ actor, target, kind: 'flat', amount: 0 })
    else if (p.result === 'hit') steps.push({ actor, target, kind: 'hit', amount: p.hit || 0 })
    else if ((p.recoil || 0) > 0) steps.push({ actor, target: actor, kind: 'recoil', amount: p.recoil || 0 })
    else steps.push({ actor, target, kind: 'whiff', amount: 0 })
  })
  return steps
}

export function resultLine(duel: ArenaDuel): string {
  if (duel.status !== 'finished') return 'Live'
  if (duel.result === 'draw') return 'Draw'
  const w = duel.fighters.find(f => f.agent_id === duel.winner)
  return `${w?.name ?? 'Winner'} wins by ${duel.result === 'ko' ? 'K.O.' : 'decision'}`
}

export function hpTone(hp: number, max = 100): 'high' | 'mid' | 'low' {
  const r = hp / max
  return r > 0.5 ? 'high' : r > 0.25 ? 'mid' : 'low'
}

// ── Fighter look ─────────────────────────────────────────────────────────────
// The full-body rig borrows the agent's avatar colours so a fighter is
// recognisably the same character as its portrait.

export interface FighterLook {
  accent: string
  accent2: string
  bg: string
  blade: 0 | 1 | 2
  emblem: 0 | 1 | 2
  cape: boolean
  palette: ReturnType<typeof paletteKey>
}

const BG: Record<string, string> = {
  trading: '#0A2C44', defi: '#2A1060', tech: '#43103F', security: '#3D0A12', general: '#1B2152',
}

function hash(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h >>> 0
}

export function fighterLook(agentId: string, niche: string | undefined, seed = 0): FighterLook {
  const p = avatarParts(agentId, niche, seed)
  const h = hash(`fighter:${agentId}:${seed}`)
  return {
    accent: p.accent,
    accent2: p.accent2,
    bg: BG[p.palette] ?? BG.general,
    blade: (h % 3) as 0 | 1 | 2,
    emblem: ((h >>> 3) % 3) as 0 | 1 | 2,
    cape: ((h >>> 6) % 4) !== 0,
    palette: p.palette,
  }
}
