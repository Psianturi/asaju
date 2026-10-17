import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  UsersThree, BookOpen, ArrowRight, Play, Pause, FlagCheckered, PaperPlaneRight, Warning,
  CheckCircle, Sparkle, ArrowsLeftRight, ClockCounterClockwise, SignOut, Lightning, ShieldCheck,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Slider } from '@/components/ui/slider'
import { NicheAvatar } from '@/components/NicheAvatar'
import { Agent } from '@/lib/types'
import { cn } from '@/lib/utils'
import { mantleService } from '@/lib/blockchain/mantleService'
import {
  agentRoomService, type AgentRoom, type RoomMessage, type RoomMode, type RoomParticipant, type RoomCitation,
} from '@/services/cloudRunService'
import {
  OWNER_SEAT, ROOM_LIMITS, ROOM_MODES, loadSavedRooms, saveRoom, seatPositions, transferKey,
  updateSavedRoomStatus, type SavedRoom,
} from '@/lib/agentRoom'

interface AgentRoomViewProps {
  agents: Agent[]
  walletAddress?: string
  walletConnected: boolean
  onConnectWallet: () => void
}

// Each seat has its own colour: niches only have a few avatar designs, so two
// agents can share a face, and the colour is what tells them apart at the table.
const SEAT_STYLES = [
  { ring: 'ring-cyan-400/80', glow: 'shadow-[0_0_24px_rgba(34,211,238,0.55)]', text: 'text-cyan-300', chip: 'border-cyan-400/50 text-cyan-300', dot: 'bg-cyan-400' },
  { ring: 'ring-fuchsia-400/80', glow: 'shadow-[0_0_24px_rgba(232,121,249,0.55)]', text: 'text-fuchsia-300', chip: 'border-fuchsia-400/50 text-fuchsia-300', dot: 'bg-fuchsia-400' },
  { ring: 'ring-amber-300/80', glow: 'shadow-[0_0_24px_rgba(252,211,77,0.5)]', text: 'text-amber-200', chip: 'border-amber-300/50 text-amber-200', dot: 'bg-amber-300' },
  { ring: 'ring-emerald-400/80', glow: 'shadow-[0_0_24px_rgba(52,211,153,0.55)]', text: 'text-emerald-300', chip: 'border-emerald-400/50 text-emerald-300', dot: 'bg-emerald-400' },
]
const seatStyle = (i: number) => SEAT_STYLES[((i % SEAT_STYLES.length) + SEAT_STYLES.length) % SEAT_STYLES.length]

const asAvatar = (p: RoomParticipant) => ({ id: p.agent_id, name: p.name, niche: p.niche as Agent['niche'] })

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong')

export function AgentRoomView({ agents, walletAddress, walletConnected, onConnectWallet }: AgentRoomViewProps) {
  const [active, setActive] = useState<{ room: AgentRoom; key: string } | null>(null)

  if (!walletConnected || !walletAddress) {
    return (
      <RoomShell>
        <Card className="glass-card p-8 text-center">
          <UsersThree size={36} weight="duotone" className="mx-auto text-primary mb-3" />
          <p className="font-semibold mb-1">Connect your wallet to open a room</p>
          <p className="text-sm text-muted-foreground mb-4">Only the wallet that owns the agents can bring them together.</p>
          <Button onClick={onConnectWallet}>Connect wallet</Button>
        </Card>
      </RoomShell>
    )
  }

  return (
    <RoomShell>
      {active ? (
        <RoomStage
          room={active.room}
          roomKey={active.key}
          onRoomChange={(room) => setActive(a => (a ? { ...a, room } : a))}
          onLeave={() => setActive(null)}
        />
      ) : (
        <RoomSetup
          agents={agents}
          owner={walletAddress}
          onOpened={(room, key) => setActive({ room, key })}
        />
      )}
    </RoomShell>
  )
}

function RoomShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/10 border border-primary/30">
          <UsersThree size={22} weight="duotone" className="text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold tracking-tight">Agent Room</h2>
          <p className="text-sm text-muted-foreground">
            Seat your agents at one table. They speak from what each has actually learned, cite it, and hand
            useful lessons to each other. Pull up a chair whenever you want.
          </p>
        </div>
      </div>
      {children}
    </div>
  )
}

// ── Setup ────────────────────────────────────────────────────────────────────

function RoomSetup({ agents, owner, onOpened }: { agents: Agent[]; owner: string; onOpened: (room: AgentRoom, key: string) => void }) {
  const [selected, setSelected] = useState<string[]>([])
  const [topic, setTopic] = useState('')
  const [mode, setMode] = useState<RoomMode>('exchange')
  const [turns, setTurns] = useState(ROOM_LIMITS.defaultTurns)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<SavedRoom[]>(() => loadSavedRooms(owner))

  useEffect(() => setSaved(loadSavedRooms(owner)), [owner])

  const owned = useMemo(() => agents.filter(a => a.id), [agents])

  const toggle = (id: string) => setSelected(s => {
    if (s.includes(id)) return s.filter(x => x !== id)
    if (s.length >= ROOM_LIMITS.maxAgents) {
      toast.info(`A room seats up to ${ROOM_LIMITS.maxAgents} agents`)
      return s
    }
    return [...s, id]
  })

  const canOpen = selected.length >= ROOM_LIMITS.minAgents && topic.trim().length >= 4 && !busy

  const handleOpen = async () => {
    setBusy(true)
    try {
      const ch = await agentRoomService.requestChallenge({ owner, agentIds: selected, topic: topic.trim(), mode, maxTurns: turns })
      toast.info('Sign in your wallet to open the room', { description: 'Signing costs no gas and cannot move funds.' })
      const signed = await mantleService.signMessage(ch.message)
      const room = await agentRoomService.open(ch.nonce, signed.signature)
      const { room_key: key, rooms_left_today: left, ...rest } = room
      setSaved(saveRoom({
        roomId: rest.room_id, roomKey: key, owner, topic: rest.topic, mode: rest.mode,
        participants: rest.participants.map(p => p.name), createdAt: rest.created_at, status: rest.status,
      }).filter(r => r.owner.toLowerCase() === owner.toLowerCase()))
      toast.success('Room is open', { description: `${left} more room${left === 1 ? '' : 's'} available today.` })
      onOpened(rest, key)
    } catch (e) {
      toast.error('Could not open the room', { description: errorText(e).slice(0, 180) })
    } finally {
      setBusy(false)
    }
  }

  const reopen = async (r: SavedRoom) => {
    try {
      const room = await agentRoomService.get(r.roomId, r.roomKey)
      onOpened(room, r.roomKey)
    } catch (e) {
      toast.error('Could not reopen this room', { description: errorText(e).slice(0, 160) })
    }
  }

  if (owned.length < ROOM_LIMITS.minAgents) {
    return (
      <Card className="glass-card p-8 text-center">
        <p className="font-semibold mb-1">You need at least two agents</p>
        <p className="text-sm text-muted-foreground">
          A room is for agents with different experience. Spawn another agent and let it study a few videos first.
        </p>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <Card className="glass-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">1 · Seat your agents</p>
            <span className="text-xs font-mono text-muted-foreground">{selected.length}/{ROOM_LIMITS.maxAgents}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {owned.map(a => {
              const on = selected.includes(a.id)
              const seat = selected.indexOf(a.id) + 1
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggle(a.id)}
                  aria-pressed={on}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all',
                    on ? 'border-primary/60 bg-primary/10 shadow-[0_0_18px_rgba(0,243,255,0.12)]' : 'border-border/50 hover:border-primary/30 hover:bg-white/[0.03]',
                  )}
                >
                  <NicheAvatar agent={a} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{a.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{a.niche}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Lv {a.level} · {a.eventsAttended} lesson{a.eventsAttended === 1 ? '' : 's'}
                    </p>
                  </div>
                  {on && (
                    <span className={cn('text-[10px] font-mono border rounded px-1.5 py-0.5 shrink-0', seatStyle(seat - 1).chip)}>
                      seat {seat}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Agents with few lessons have little to share — the room works best when each has studied something different.
          </p>
        </Card>

        <Card className="glass-card p-5 space-y-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">2 · What should they talk about?</p>
            <Textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value.slice(0, 280))}
              placeholder="e.g. Which signals from what you've studied matter most for a BTC entry this week?"
              rows={3}
            />
            <p className="text-[10px] text-right text-muted-foreground font-mono">{topic.length}/280</p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">3 · Room format</p>
            <div className="grid gap-2">
              {(Object.keys(ROOM_MODES) as RoomMode[]).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  aria-pressed={mode === m}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-left transition-all',
                    mode === m ? 'border-secondary/60 bg-secondary/10' : 'border-border/50 hover:border-secondary/30',
                  )}
                >
                  <p className="text-sm font-semibold">{ROOM_MODES[m].label}</p>
                  <p className="text-[11px] text-muted-foreground">{ROOM_MODES[m].blurb}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Turns</p>
              <span className="text-xs font-mono">{turns}</span>
            </div>
            <Slider min={ROOM_LIMITS.minTurns} max={ROOM_LIMITS.maxTurns} step={1} value={[turns]} onValueChange={([v]) => setTurns(v)} />
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Lightning size={12} weight="fill" className="text-amber-400" />
              Up to {turns + 1} AI calls, including the wrap-up. Talk only — no trades, no signing.
            </p>
          </div>

          <Button className="w-full" disabled={!canOpen} onClick={handleOpen}>
            <ShieldCheck size={16} className="mr-1.5" />
            {busy ? 'Opening…' : 'Sign & open room'}
          </Button>
        </Card>
      </div>

      {saved.length > 0 && (
        <Card className="glass-card p-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <ClockCounterClockwise size={14} /> Recent rooms on this device
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            {saved.map(r => (
              <button
                key={r.roomId}
                type="button"
                onClick={() => reopen(r)}
                className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2 text-left hover:border-primary/30 hover:bg-white/[0.03]"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{r.topic}</p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {ROOM_MODES[r.mode]?.label ?? r.mode} · {r.participants.join(', ')}
                  </p>
                </div>
                <span className={cn('text-[10px] rounded px-1.5 py-0.5 border', r.status === 'concluded'
                  ? 'border-emerald-500/40 text-emerald-300' : 'border-primary/40 text-primary')}>
                  {r.status === 'concluded' ? 'wrapped up' : 'open'}
                </span>
                <ArrowRight size={14} className="text-muted-foreground" />
              </button>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

// ── Stage ────────────────────────────────────────────────────────────────────

interface StageProps {
  room: AgentRoom
  roomKey: string
  onRoomChange: (room: AgentRoom) => void
  onLeave: () => void
}

function RoomStage({ room, roomKey, onRoomChange, onLeave }: StageProps) {
  const [busy, setBusy] = useState<'turn' | 'say' | 'conclude' | null>(null)
  const [autoRun, setAutoRun] = useState(false)
  const [draft, setDraft] = useState('')
  const [transferring, setTransferring] = useState<string | null>(null)
  const roomRef = useRef(room)
  roomRef.current = room
  const feedEnd = useRef<HTMLDivElement>(null)

  const open = room.status === 'open'
  const turnsLeft = room.max_turns - room.turns_taken
  const agentTurns = room.messages.filter(m => m.speaker.type === 'agent').length
  const nextSpeaker = room.participants[agentTurns % room.participants.length]
  const lastMessage = room.messages[room.messages.length - 1]
  const speakingId = busy === 'turn' ? nextSpeaker?.agent_id : lastMessage?.speaker.agent_id
  const seats = seatPositions(room.participants.length)
  const seatOf = (agentId: string) => seats[room.participants.findIndex(p => p.agent_id === agentId)]

  useEffect(() => {
    feedEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [room.messages.length])

  const takeTurn = useCallback(async () => {
    const current = roomRef.current
    setBusy('turn')
    try {
      const { message } = await agentRoomService.turn(current.room_id, roomKey)
      onRoomChange({ ...current, messages: [...current.messages, message], turns_taken: current.turns_taken + 1 })
    } catch (e) {
      setAutoRun(false)
      toast.error('Turn failed', { description: errorText(e).slice(0, 160) })
    } finally {
      setBusy(null)
    }
  }, [roomKey, onRoomChange])

  // Auto-run plays the remaining turns one after another, and stops the
  // moment the owner pauses, speaks, or a turn fails.
  useEffect(() => {
    if (!autoRun || busy || !open) return
    if (turnsLeft <= 0) { setAutoRun(false); return }
    const t = setTimeout(takeTurn, 900)
    return () => clearTimeout(t)
  }, [autoRun, busy, open, turnsLeft, takeTurn])

  const say = async () => {
    const text = draft.trim()
    if (!text) return
    setAutoRun(false)
    setBusy('say')
    try {
      const { message } = await agentRoomService.say(room.room_id, roomKey, text)
      onRoomChange({ ...room, messages: [...room.messages, message], owner_messages: room.owner_messages + 1 })
      setDraft('')
    } catch (e) {
      toast.error('Message not sent', { description: errorText(e).slice(0, 160) })
    } finally {
      setBusy(null)
    }
  }

  const conclude = async () => {
    setAutoRun(false)
    setBusy('conclude')
    try {
      const { synthesis } = await agentRoomService.conclude(room.room_id, roomKey)
      onRoomChange({ ...room, synthesis, status: 'concluded' })
      updateSavedRoomStatus(room.room_id, 'concluded')
    } catch (e) {
      toast.error('Could not wrap up', { description: errorText(e).slice(0, 160) })
    } finally {
      setBusy(null)
    }
  }

  const handOver = async (eventId: string, toAgentId: string, toName: string) => {
    const key = transferKey(toAgentId, eventId)
    setTransferring(key)
    try {
      await agentRoomService.transfer(room.room_id, roomKey, eventId, toAgentId)
      onRoomChange({ ...room, transfers_done: [...(room.transfers_done ?? []), key] })
      toast.success(`${toName} learned it`, { description: 'It will draw on this lesson in future rooms.' })
    } catch (e) {
      toast.error('Hand-over failed', { description: errorText(e).slice(0, 160) })
    } finally {
      setTransferring(null)
    }
  }

  const ownerLeft = ROOM_LIMITS.maxOwnerMessages - room.owner_messages
  const transfers = room.synthesis?.transfers ?? []

  return (
    <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
      <div className="space-y-4 min-w-0">
        {/* Table */}
        <Card className="glass-card p-0 overflow-hidden">
          <div className="relative w-full aspect-[16/11] sm:aspect-[16/9] select-none">
            <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              <defs>
                <radialGradient id="room-table" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="rgba(0,243,255,0.10)" />
                  <stop offset="100%" stopColor="rgba(157,0,255,0.04)" />
                </radialGradient>
              </defs>
              <ellipse cx="50" cy="56" rx="30" ry="22" fill="url(#room-table)" stroke="rgba(0,243,255,0.25)" strokeWidth="0.3" />
              <ellipse cx="50" cy="56" rx="24" ry="17" fill="none" stroke="rgba(0,243,255,0.10)" strokeWidth="0.2" strokeDasharray="1 1" />
              {/* Lesson hand-overs proposed at wrap-up, drawn across the table. */}
              {transfers.map(t => {
                const a = seatOf(t.from_agent_id)
                const b = seatOf(t.to_agent_id)
                if (!a || !b) return null
                const done = room.transfers_done?.includes(transferKey(t.to_agent_id, t.event_id))
                // Bow the arc outward, away from the table centre, so it never
                // runs through the topic text.
                const mx = (a.x + b.x) / 2
                const my = (a.y + b.y) / 2
                const cx = mx + (mx - 50) * 0.6
                const cy = my + (my - 56) * 0.6
                return (
                  <path
                    key={`${t.from_agent_id}-${t.to_agent_id}-${t.event_id}`}
                    d={`M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`}
                    fill="none"
                    stroke={done ? 'rgba(52,211,153,0.8)' : 'rgba(192,132,252,0.7)'}
                    strokeWidth="0.45"
                    strokeDasharray={done ? undefined : '1.2 1'}
                    vectorEffect="non-scaling-stroke"
                  />
                )
              })}
            </svg>

            {/* Centre of the table: topic and progress */}
            <div className="absolute left-1/2 top-[56%] -translate-x-1/2 -translate-y-1/2 w-[46%] text-center">
              <p className="text-[10px] uppercase tracking-widest text-primary/80 font-mono">{ROOM_MODES[room.mode]?.label}</p>
              <p className="text-xs sm:text-sm font-medium leading-snug line-clamp-3 mt-1">{room.topic}</p>
              <p className="text-[10px] text-muted-foreground font-mono mt-1.5">
                {open ? `turn ${room.turns_taken}/${room.max_turns}` : 'wrapped up'}
              </p>
            </div>

            {room.participants.map((p, i) => {
              const seat = seats[i]
              const speaking = speakingId === p.agent_id
              const thinking = busy === 'turn' && nextSpeaker?.agent_id === p.agent_id
              return (
                <div
                  key={p.agent_id}
                  className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1 w-24"
                  style={{ left: `${seat.x}%`, top: `${seat.y}%` }}
                >
                  <motion.div
                    animate={speaking ? { scale: 1.08 } : { scale: 1 }}
                    className={cn('relative rounded-full p-0.5 transition-shadow ring-2', seatStyle(i).ring, speaking ? seatStyle(i).glow : 'opacity-90')}
                  >
                    <NicheAvatar agent={asAvatar(p)} size="md" showRing={false} />
                    <span className={cn('absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full text-[9px] font-bold text-background flex items-center justify-center', seatStyle(i).dot)}>
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                  </motion.div>
                  <p className={cn('text-[11px] font-semibold truncate max-w-full', seatStyle(i).text)}>{p.name}</p>
                  <p className="text-[9px] text-muted-foreground -mt-1">
                    {p.is_mentor ? 'mentor · ' : ''}Lv {p.level}
                  </p>
                  {thinking && <p className="text-[9px] text-primary font-mono animate-pulse">thinking…</p>}
                </div>
              )
            })}

            {/* The owner's chair */}
            <div
              className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
              style={{ left: `${OWNER_SEAT.x}%`, top: `${OWNER_SEAT.y}%` }}
            >
              <div className={cn('rounded-full px-2.5 py-1 text-[10px] font-semibold border',
                lastMessage?.speaker.type === 'owner' ? 'border-amber-400/70 text-amber-300 shadow-[0_0_16px_rgba(251,191,36,0.35)]' : 'border-border/50 text-muted-foreground')}>
                You
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border/40 px-4 py-3">
            {open ? (
              <>
                <Button size="sm" onClick={takeTurn} disabled={!!busy || autoRun || turnsLeft <= 0}>
                  <ArrowRight size={14} className="mr-1" />
                  {turnsLeft > 0 ? `Next: ${nextSpeaker?.name}` : 'No turns left'}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAutoRun(v => !v)} disabled={turnsLeft <= 0 || busy === 'conclude'}>
                  {autoRun ? <><Pause size={14} className="mr-1" />Pause</> : <><Play size={14} className="mr-1" />Auto-run</>}
                </Button>
                <Button size="sm" variant="outline" onClick={conclude} disabled={!!busy || agentTurns === 0} className="sm:ml-auto">
                  <FlagCheckered size={14} className="mr-1" />{busy === 'conclude' ? 'Wrapping up…' : 'Wrap up'}
                </Button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <CheckCircle size={14} weight="fill" className="text-emerald-400" /> This room is wrapped up.
              </p>
            )}
            <Button size="sm" variant="ghost" onClick={onLeave} className={open ? '' : 'ml-auto'}>
              <SignOut size={14} className="mr-1" />Leave
            </Button>
          </div>
        </Card>

        {/* Conversation */}
        <Card className="glass-card p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Conversation</p>
          <div className="space-y-3 max-h-[440px] overflow-y-auto pr-1">
            {room.messages.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nobody has spoken yet. Start with <span className="text-foreground">{nextSpeaker?.name}</span>, or set the scene yourself below.
              </p>
            )}
            <AnimatePresence initial={false}>
              {room.messages.map(m => (
                <MessageRow
                  key={m.id}
                  message={m}
                  participant={room.participants.find(p => p.agent_id === m.speaker.agent_id)}
                  seat={room.participants.findIndex(p => p.agent_id === m.speaker.agent_id)}
                />
              ))}
            </AnimatePresence>
            <div ref={feedEnd} />
          </div>
          {open && (
            <div className="space-y-1.5 pt-2 border-t border-border/40">
              <div className="flex gap-2">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.slice(0, 600))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (ownerLeft > 0) say() } }}
                  placeholder={ownerLeft > 0 ? 'Join in — ask a question or steer the discussion…' : 'You have used all your messages in this room'}
                  rows={2}
                  disabled={ownerLeft <= 0 || busy === 'say'}
                  className="text-sm"
                />
                <Button onClick={say} disabled={!draft.trim() || ownerLeft <= 0 || !!busy} className="self-end shrink-0" aria-label="Send">
                  <PaperPlaneRight size={16} />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground font-mono">{ownerLeft} of {ROOM_LIMITS.maxOwnerMessages} messages left</p>
            </div>
          )}
        </Card>
      </div>

      <div className="space-y-4 min-w-0">
        {room.synthesis && (
          <SynthesisCard room={room} transferring={transferring} onHandOver={handOver} />
        )}
        <KnowledgeBoard room={room} />
      </div>
    </div>
  )
}

function MessageRow({ message, participant, seat }: { message: RoomMessage; participant?: RoomParticipant; seat: number }) {
  const isOwner = message.speaker.type === 'owner'
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex gap-2.5', isOwner && 'flex-row-reverse')}
    >
      {participant ? (
        <div className={cn('rounded-full p-px ring-1 h-fit shrink-0', seatStyle(seat).ring)}>
          <NicheAvatar agent={asAvatar(participant)} size="sm" showRing={false} />
        </div>
      ) : (
        <div className="w-8 h-8 shrink-0 rounded-full border border-amber-400/50 text-amber-300 text-[10px] font-semibold flex items-center justify-center">You</div>
      )}
      <div className={cn('min-w-0 max-w-[85%] rounded-lg border px-3 py-2',
        isOwner ? 'border-amber-400/30 bg-amber-400/[0.06]' : 'border-border/50 bg-white/[0.02]')}>
        <p className={cn('text-[11px] font-semibold mb-0.5', participant ? seatStyle(seat).text : 'text-amber-300')}>{message.speaker.name}</p>
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{message.text}</p>
        {message.flagged && (
          <p className="mt-1.5 flex items-center gap-1 text-[10px] text-amber-300">
            <Warning size={12} weight="fill" /> A lesson contained an instruction-like passage; the agent ignored it.
          </p>
        )}
        {message.citations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.citations.map(c => <CitationChip key={c.event_id} citation={c} />)}
          </div>
        )}
      </div>
    </motion.div>
  )
}

function CitationChip({ citation }: { citation: RoomCitation }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/[0.06] px-1.5 py-0.5 text-[10px] text-primary/90 max-w-full"
      title={citation.source === 'peer' && citation.from_agent_name ? `Learned from ${citation.from_agent_name}` : 'From its own study'}
    >
      <BookOpen size={11} weight="duotone" className="shrink-0" />
      <span className="truncate">{citation.title}</span>
      {citation.source === 'peer' && <ArrowsLeftRight size={10} className="shrink-0 text-secondary" />}
    </span>
  )
}

function KnowledgeBoard({ room }: { room: AgentRoom }) {
  const byAgent = room.participants.map((p, seat) => {
    const seen = new Map<string, RoomCitation>()
    for (const m of room.messages) {
      if (m.speaker.agent_id !== p.agent_id) continue
      for (const c of m.citations) if (!seen.has(c.event_id)) seen.set(c.event_id, c)
    }
    return { p, seat, lessons: [...seen.values()] }
  })
  const total = byAgent.reduce((n, a) => n + a.lessons.length, 0)

  return (
    <Card className="glass-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Knowledge on the table</p>
        <span className="text-[10px] font-mono text-muted-foreground">{total} cited</span>
      </div>
      {total === 0 && (
        <p className="text-xs text-muted-foreground">Lessons an agent cites from its memory appear here, grouped by who brought them.</p>
      )}
      {byAgent.filter(a => a.lessons.length > 0).map(({ p, seat, lessons }) => (
        <div key={p.agent_id} className="space-y-1.5">
          <div className="flex items-center gap-2">
            <NicheAvatar agent={asAvatar(p)} size="sm" showRing={false} className="!w-6 !h-6" />
            <p className={cn('text-xs font-semibold', seatStyle(seat).text)}>{p.name}</p>
          </div>
          <div className="grid gap-1.5 pl-8">
            {lessons.map(l => (
              <div key={l.event_id} className="rounded-md border border-border/50 bg-white/[0.02] px-2.5 py-1.5">
                <p className="text-xs leading-snug">{l.title}</p>
                <p className="text-[10px] text-muted-foreground">
                  {l.source === 'peer' && l.from_agent_name ? `learned from ${l.from_agent_name}` : 'own study'}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Card>
  )
}

function SynthesisCard({ room, transferring, onHandOver }: {
  room: AgentRoom
  transferring: string | null
  onHandOver: (eventId: string, toAgentId: string, toName: string) => void
}) {
  const s = room.synthesis!
  const section = (title: string, items: string[]) => items.length > 0 && (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      <ul className="space-y-1">
        {items.map((it, i) => <li key={i} className="text-sm leading-snug flex gap-1.5"><span className="text-primary">›</span>{it}</li>)}
      </ul>
    </div>
  )

  return (
    <Card className="glass-card p-4 space-y-4 border-secondary/30">
      <p className="text-xs font-semibold uppercase tracking-wider text-secondary flex items-center gap-1.5">
        <Sparkle size={14} weight="fill" /> What the room concluded
      </p>
      {s.summary && <p className="text-sm leading-relaxed">{s.summary}</p>}
      {section('Key insights', s.key_insights)}
      {section('Still disputed', s.disagreements)}
      {section('Next steps for you', s.next_steps)}

      <div className="space-y-2 pt-2 border-t border-border/40">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <ArrowsLeftRight size={13} /> Lesson hand-overs
        </p>
        {s.transfers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No hand-overs suggested — none of the cited lessons was clearly missing from another agent.</p>
        ) : s.transfers.map(t => {
          const key = transferKey(t.to_agent_id, t.event_id)
          const done = room.transfers_done?.includes(key)
          return (
            <div key={key} className="rounded-lg border border-border/50 px-3 py-2 space-y-1.5">
              <p className="text-xs">
                <span className="font-semibold">{t.from_name}</span>
                <ArrowRight size={11} className="inline mx-1 text-secondary" />
                <span className="font-semibold">{t.to_name}</span>
              </p>
              <p className="text-sm leading-snug flex items-start gap-1.5"><BookOpen size={14} className="text-primary mt-0.5 shrink-0" />{t.title}</p>
              {t.why && <p className="text-[11px] text-muted-foreground">{t.why}</p>}
              <Button
                size="sm"
                variant={done ? 'ghost' : 'outline'}
                disabled={done || transferring === key}
                onClick={() => onHandOver(t.event_id, t.to_agent_id, t.to_name)}
                className="h-7 text-xs"
              >
                {done ? <><CheckCircle size={13} weight="fill" className="mr-1 text-emerald-400" />Handed over</>
                  : transferring === key ? 'Handing over…' : `Teach ${t.to_name}`}
              </Button>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
