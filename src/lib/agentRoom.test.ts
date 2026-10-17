import { beforeEach, describe, expect, it } from 'vitest'
import { OWNER_SEAT, loadSavedRooms, saveRoom, seatPositions, updateSavedRoomStatus, type SavedRoom } from './agentRoom'

// Tests run under node, which has no localStorage.
const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size },
} as Storage

const room = (id: string, owner = '0xAbC'): SavedRoom => ({
  roomId: id, roomKey: `key-${id}`, owner, topic: 't', mode: 'exchange',
  participants: ['A', 'B'], createdAt: 1, status: 'open',
})

describe('seatPositions', () => {
  it('keeps every agent on the upper arc, clear of the owner seat', () => {
    for (let n = 1; n <= 4; n++) {
      const seats = seatPositions(n)
      expect(seats).toHaveLength(n)
      for (const s of seats) {
        expect(s.y).toBeLessThan(OWNER_SEAT.y - 20)
        expect(s.x).toBeGreaterThanOrEqual(5)
        expect(s.x).toBeLessThanOrEqual(95)
      }
    }
  })

  it('is symmetric left to right', () => {
    const [a, , , d] = seatPositions(4)
    expect(a.x + d.x).toBeCloseTo(100)
    expect(a.y).toBeCloseTo(d.y)
  })
})

describe('saved rooms', () => {
  beforeEach(() => localStorage.clear())

  it('saves newest first, dedupes, and filters by owner case-insensitively', () => {
    saveRoom(room('1'))
    saveRoom(room('2', '0xother'))
    saveRoom(room('1'))
    expect(loadSavedRooms().map(r => r.roomId)).toEqual(['1', '2'])
    expect(loadSavedRooms('0xabc').map(r => r.roomId)).toEqual(['1'])
  })

  it('survives corrupt storage', () => {
    localStorage.setItem('asaju-agent-rooms', '{not json')
    expect(loadSavedRooms()).toEqual([])
    localStorage.setItem('asaju-agent-rooms', JSON.stringify([{ roomId: 1 }, room('ok')]))
    expect(loadSavedRooms().map(r => r.roomId)).toEqual(['ok'])
  })

  it('updates status in place', () => {
    saveRoom(room('1'))
    updateSavedRoomStatus('1', 'concluded')
    expect(loadSavedRooms()[0].status).toBe('concluded')
  })
})
