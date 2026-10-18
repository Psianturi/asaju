import type { RoomMode } from '@/services/cloudRunService'

export const ROOM_MODES: Record<RoomMode, { label: string; blurb: string }> = {
  exchange: {
    label: 'Knowledge exchange',
    blurb: 'Each agent brings its most relevant lesson and builds on the others.',
  },
  debate: {
    label: 'Strategy debate',
    blurb: 'Agents argue your question from different angles and land on a call.',
  },
  mentor: {
    label: 'Mentoring',
    blurb: 'Your most experienced agent teaches; the others ask what they lack.',
  },
}

/** Defaults until the server's /rooms/config answers; the server is the authority. */
export const ROOM_LIMITS = { minAgents: 2, maxAgents: 4, minTurns: 2, maxTurns: 10, defaultTurns: 6, maxOwnerMessages: 8, roomsPerDay: 8 }

export type RoomLimits = typeof ROOM_LIMITS

export function limitsFromConfig(cfg: Partial<{
  min_participants: number; max_participants: number; default_turns: number
  max_turns: number; max_owner_messages: number; rooms_per_day: number
}>): RoomLimits {
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d)
  return {
    minAgents: n(cfg.min_participants, ROOM_LIMITS.minAgents),
    maxAgents: n(cfg.max_participants, ROOM_LIMITS.maxAgents),
    minTurns: ROOM_LIMITS.minTurns,
    maxTurns: n(cfg.max_turns, ROOM_LIMITS.maxTurns),
    defaultTurns: n(cfg.default_turns, ROOM_LIMITS.defaultTurns),
    maxOwnerMessages: n(cfg.max_owner_messages, ROOM_LIMITS.maxOwnerMessages),
    roomsPerDay: n(cfg.rooms_per_day, ROOM_LIMITS.roomsPerDay),
  }
}

/** Video titles can arrive HTML-escaped from YouTube ("&amp;"); rooms saved
 *  before the server unescaped them still carry the entities. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

/**
 * Seats around the round table, as percentages of the stage box. Agents sit
 * on the upper arc; the bottom-centre seat is always kept for the owner, so
 * joining the conversation reads as pulling up a chair.
 */
export function seatPositions(count: number): Array<{ x: number; y: number }> {
  if (count <= 0) return []
  // Spread from 200° to 340° (screen angles, y down) across the upper arc.
  const start = 200
  const end = 340
  const step = count === 1 ? 0 : (end - start) / (count - 1)
  return Array.from({ length: count }, (_, i) => {
    const deg = count === 1 ? 270 : start + step * i
    const rad = (deg * Math.PI) / 180
    return { x: 50 + 40 * Math.cos(rad), y: 54 + 38 * Math.sin(rad) }
  })
}

export const OWNER_SEAT = { x: 50, y: 92 }

export const transferKey = (toAgentId: string, eventId: string) => `${toAgentId}:${eventId}`

// ── Rooms this browser opened ────────────────────────────────────────────────
// The room key is the only credential for a room after it is opened, so it
// lives in this browser only. Losing it just means the room can't be reopened.

export interface SavedRoom {
  roomId: string
  roomKey: string
  owner: string
  topic: string
  mode: RoomMode
  participants: string[]
  createdAt: number
  status: 'open' | 'concluded'
}

const STORAGE_KEY = 'asaju-agent-rooms'
const MAX_SAVED = 12

export function loadSavedRooms(owner?: string): SavedRoom[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .filter((r): r is SavedRoom => !!r && typeof r.roomId === 'string' && typeof r.roomKey === 'string')
      .filter(r => !owner || r.owner?.toLowerCase() === owner.toLowerCase())
  } catch {
    return []
  }
}

export function saveRoom(room: SavedRoom): SavedRoom[] {
  const rest = loadSavedRooms().filter(r => r.roomId !== room.roomId)
  const next = [room, ...rest].slice(0, MAX_SAVED)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // storage unavailable (private mode) — the room still works this session
  }
  return next
}

export function updateSavedRoomStatus(roomId: string, status: SavedRoom['status']): void {
  const rooms = loadSavedRooms()
  const hit = rooms.find(r => r.roomId === roomId)
  if (!hit || hit.status === status) return
  saveRoom({ ...hit, status })
}
