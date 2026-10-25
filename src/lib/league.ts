/**
 * Prediction League — types mirrored from backend/services/league.py and the
 * pure helpers the view uses to describe a window's state and a pick's score.
 */

export type Direction = 'up' | 'down'
export type WindowStatus = 'upcoming' | 'sealed' | 'resolved' | 'void'
export type WindowKind = 'official' | 'private'

export interface LeagueConfig {
  enabled: boolean
  horizon_seconds: number
  cadence_seconds: number
  assets: string[]
  max_participants: number
  picks_per_day: number
  points_per_confidence: number
  wrong_penalty_per_confidence: number
  magnitude_bonus_max: number
  ai_calls_per_pick: number
  season_id: string
}

export interface PickIdentity { agent_id: string; name?: string; niche?: string; avatar_seed?: number | null }
export interface SealedLeaguePick extends PickIdentity { commit: string; sealed: true }
export interface RevealedLeaguePick extends PickIdentity {
  direction: Direction
  confidence: 1 | 2 | 3
  reasoning: string
  cited: string[]
  fallback: boolean
  salt: string
  commit: string
  points?: number
  correct?: boolean | null
  counted?: boolean
  status?: string
}
export type LeaguePick = SealedLeaguePick | RevealedLeaguePick

export interface LeagueWindow {
  window_id: string
  kind: WindowKind
  owner?: string | null
  asset: string
  symbol: string
  horizon_seconds: number
  open_ts: number
  resolve_ts: number
  status: WindowStatus
  open_price: number | null
  close_price: number | null
  move: number | null
  void_reason: string | null
  season_id: string
  participants: string[]
  picks: LeaguePick[]
}

export interface LeagueStanding {
  agent_id: string
  name: string
  niche: string
  avatar_seed?: number | null
  owner: string
  level: number
  rating: number
  peak_rating?: number
  matches: number
  wins: number
  losses: number
  points: number
  accuracy?: number | null
  streak: number
  voids?: number
}

export interface LeagueRecord {
  agent_id: string
  matches: number
  wins: number
  losses: number
  voids: number
  fallbacks: number
  points: number
  accuracy: number | null
  streak: number
  best_streak: number
  last: number[]
}

export const LEAGUE_DEFAULTS: LeagueConfig = {
  enabled: false, horizon_seconds: 1800, cadence_seconds: 1800, assets: ['BTC', 'ETH', 'SOL', 'BNB', 'MNT'],
  max_participants: 8, picks_per_day: 8, points_per_confidence: 10, wrong_penalty_per_confidence: 2,
  magnitude_bonus_max: 10, ai_calls_per_pick: 1, season_id: '',
}

export const isRevealed = (p: LeaguePick): p is RevealedLeaguePick => (p as SealedLeaguePick).sealed !== true

/** Where a window is in its life, as a spectator sees it at `now` (seconds). */
export type WindowPhase = 'open' | 'locked' | 'settling' | 'resolved' | 'void'

export function windowPhase(w: Pick<LeagueWindow, 'status' | 'open_ts' | 'resolve_ts'>, now: number): WindowPhase {
  if (w.status === 'resolved') return 'resolved'
  if (w.status === 'void') return 'void'
  if (now < w.open_ts) return 'open'
  if (now < w.resolve_ts) return 'locked'
  return 'settling'
}

export const PHASE_LABEL: Record<WindowPhase, string> = {
  open: 'Picks open', locked: 'Locked · waiting for the candle', settling: 'Settling…', resolved: 'Settled', void: 'Void',
}

export const VOID_REASON: Record<string, string> = {
  flat: 'the price barely moved',
  price_unavailable: 'no final price arrived in time',
  no_participants: 'nobody entered',
}

/** Points a call earns under the league rules; mirrors score_pick() on the server. */
export function pointsFor(direction: Direction, confidence: number, move: number, cfg: LeagueConfig = LEAGUE_DEFAULTS): number {
  const c = Math.max(1, Math.min(3, Math.round(confidence)))
  const correct = move > 0 === (direction === 'up')
  if (correct) return cfg.points_per_confidence * c + Math.min(cfg.magnitude_bonus_max, Math.floor(Math.abs(move) * 2000))
  const penalty = cfg.wrong_penalty_per_confidence * (c - 1)
  return penalty ? -penalty : 0
}

/** "14:30–15:00 UTC" */
export function fmtWindowSpan(openTs: number, resolveTs: number): string {
  const hm = (t: number) => new Date(t * 1000).toISOString().slice(11, 16)
  return `${hm(openTs)}–${hm(resolveTs)} UTC`
}

/** Season ids are ISO weeks: "2026-W43" -> "Week 43 · 2026". */
export function seasonLabel(seasonId: string): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(seasonId)
  return m ? `Week ${Number(m[2])} · ${m[1]}` : seasonId || 'Season'
}

/** Last results as a short form line, newest last: "W W L W". */
export const formLine = (last: number[] | undefined, n = 8) => (last ?? []).slice(-n).map(x => (x ? 'W' : 'L')).join(' ')

export const fmtAccuracy = (a: number | null | undefined) => (a === null || a === undefined ? '—' : `${Math.round(a * 100)}%`)

export const fmtPoints = (p: number | undefined | null) => (p === undefined || p === null ? '—' : p > 0 ? `+${p}` : String(p))
