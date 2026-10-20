import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  UsersThree, BookOpen, ArrowRight, Play, Pause, FlagCheckered, PaperPlaneRight, Warning,
  CheckCircle, Sparkle, ArrowsLeftRight, PencilLine, ClockCounterClockwise, SignOut, Lightning, ShieldCheck,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Slider } from '@/components/ui/slider'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { NicheAvatar } from '@/components/NicheAvatar'
import { RoomWhiteboard } from '@/components/RoomWhiteboard'
import { RoomIntro } from '@/components/RoomIntro'
import { Agent } from '@/lib/types'
import { cn } from '@/lib/utils'
import { mantleService } from '@/lib/blockchain/mantleService'
import {
  agentRoomService, type AgentRoom, type RoomClaimCheck, type RoomMessage, type RoomMode, type RoomParticipant, type RoomCitation,
} from '@/services/cloudRunService'
import {
  OWNER_SEAT, ROOM_LIMITS, ROOM_MODES, decodeEntities, limitsFromConfig, loadSavedRooms, saveRoom, seatPositions, transferKey,
  updateSavedRoomStatus, type RoomLimits, type SavedRoom,
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

const asAvatar = (p: RoomParticipant) => ({ id: p.agent_id, name: p.name, niche: p.niche as Agent['niche'], avatarSeed: p.avatar_seed })

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong')

export function AgentRoomView({ agents, walletAddress, walletConnected, onConnectWallet }: AgentRoomViewProps) {
  const [active, setActive] = useState<{ room: AgentRoom; key: string } | null>(null)
  const [limits, setLimits] = useState<RoomLimits>(ROOM_LIMITS)

  useEffect(() => {
    let cancelled = false
    agentRoomService.config()
      .then(cfg => { if (!cancelled) setLimits(limitsFromConfig(cfg)) })
      .catch(() => { /* keep the defaults; the server still enforces its own caps */ })
    return () => { cancelled = true }
  }, [])

  if (!walletConnected || !walletAddress) {
    return (
      <RoomShell>
        <RoomIntro onConnectWallet={onConnectWallet} />
      </RoomShell>
    )
  }

  return (
    <RoomShell>
      {active ? (
        <RoomStage
          room={active.room}
          roomKey={active.key}
          limits={limits}
          onRoomChange={(room) => setActive(a => (a ? { ...a, room } : a))}
          onLeave={() => setActive(null)}
        />
      ) : (
        <RoomSetup
          agents={agents}
          owner={walletAddress}
          limits={limits}
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

function RoomSetup({ agents, owner, limits, onOpened }: {
  agents: Agent[]; owner: string; limits: RoomLimits; onOpened: (room: AgentRoom, key: string) => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [topic, setTopic] = useState('')
  const [mode, setMode] = useState<RoomMode>('exchange')
  const [turns, setTurns] = useState(limits.defaultTurns)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<SavedRoom[]>(() => loadSavedRooms(owner))

  useEffect(() => setSaved(loadSavedRooms(owner)), [owner])

  const owned = useMemo(() => agents.filter(a => a.id), [agents])

  const toggle = (id: string) => setSelected(s => {
    if (s.includes(id)) return s.filter(x => x !== id)
    if (s.length >= limits.maxAgents) {
      toast.info(`A room seats up to ${limits.maxAgents} agents`)
      return s
    }
    return [...s, id]
  })

  const canOpen = selected.length >= limits.minAgents && topic.trim().length >= 4 && !busy

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

  if (owned.length < limits.minAgents) {
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
            <span className="text-xs font-mono text-muted-foreground">{selected.length}/{limits.maxAgents}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {owned.map((a, idx) => {
              const on = selected.includes(a.id)
              const seat = selected.indexOf(a.id) + 1
              return (
                <motion.button
                  key={a.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(idx * 0.05, 0.4) }}
                  whileTap={{ scale: 0.98 }}
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
                </motion.button>
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
            <Slider min={limits.minTurns} max={limits.maxTurns} step={1} value={[turns]} onValueChange={([v]) => setTurns(v)} />
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <Lightning size={12} weight="fill" className="text-amber-400" />
              Up to {turns + 2} AI calls, including the wrap-up and its fact-check. Talk only — no trades, no signing.
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
  limits: RoomLimits
  onRoomChange: (room: AgentRoom) => void
  onLeave: () => void
}

function RoomStage({ room, roomKey, limits, onRoomChange, onLeave }: StageProps) {
  const [busy, setBusy] = useState<'turn' | 'say' | 'conclude' | null>(null)
  const [autoRun, setAutoRun] = useState(false)
  const [draft, setDraft] = useState('')
  const [transferring, setTransferring] = useState<string | null>(null)
  const [boardOpen, setBoardOpen] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [sketchUrl, setSketchUrl] = useState<string | null>(null)
  const [sideTab, setSideTab] = useState<'lessons' | 'summary'>(room.synthesis ? 'summary' : 'lessons')
  // The agent whose newest message is still being "spoken" (typed out).
  const [talking, setTalking] = useState<{ id: string; agentId: string } | null>(null)
  const doneTalking = useCallback(() => setTalking(null), [])
  const roomRef = useRef(room)
  roomRef.current = room
  const feedRef = useRef<HTMLDivElement>(null)

  const open = room.status === 'open'
  const turnsLeft = room.max_turns - room.turns_taken
  const agentTurns = room.messages.filter(m => m.speaker.type === 'agent').length
  const nextSpeaker = room.participants[agentTurns % room.participants.length]
  const nextSeat = agentTurns % room.participants.length
  const lastMessage = room.messages[room.messages.length - 1]
  const speakingId = busy === 'turn' ? nextSpeaker?.agent_id : lastMessage?.speaker.agent_id
  const ownerLeft = limits.maxOwnerMessages - room.owner_messages
  const transfers = room.synthesis?.transfers ?? []
  const transfersLeft = transfers.filter(t => !room.transfers_done?.includes(transferKey(t.to_agent_id, t.event_id))).length

  // Keep the newest message (or the thinking bubble) in view, also while it types out.
  const scrollFeed = useCallback(() => {
    const el = feedRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [])
  useEffect(scrollFeed, [room.messages.length, busy, scrollFeed])

  const takeTurn = useCallback(async () => {
    const current = roomRef.current
    setBusy('turn')
    try {
      const { message } = await agentRoomService.turn(current.room_id, roomKey)
      onRoomChange({ ...current, messages: [...current.messages, message], turns_taken: current.turns_taken + 1 })
      if (message.speaker.agent_id) setTalking({ id: message.id, agentId: message.speaker.agent_id })
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
    if (!autoRun || busy || !open || talking) return
    if (turnsLeft <= 0) { setAutoRun(false); return }
    const t = setTimeout(takeTurn, 900)
    return () => clearTimeout(t)
  }, [autoRun, busy, open, turnsLeft, takeTurn, talking])

  // A reopened room shows the sketch its agents are looking at.
  useEffect(() => {
    if (!room.sketch_at || sketchUrl) return
    agentRoomService.getSketch(room.room_id, roomKey).then(r => setSketchUrl(r.image)).catch(() => {})
  }, [room.room_id, room.sketch_at, roomKey, sketchUrl])

  const shareSketch = async (image: string, note: string) => {
    setAutoRun(false)
    setSharing(true)
    try {
      const { message } = await agentRoomService.shareSketch(room.room_id, roomKey, image, note)
      onRoomChange({ ...room, messages: [...room.messages, message], owner_messages: room.owner_messages + 1, sketch_at: message.at })
      setSketchUrl(image)
      setBoardOpen(false)
      toast.success('Sketch is on the table', { description: 'Your agents will see it from their next turn.' })
    } catch (e) {
      toast.error('Could not share the sketch', { description: errorText(e).slice(0, 160) })
    } finally {
      setSharing(false)
    }
  }

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
      setSideTab('summary')
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

  // Which of the three steps the owner is on — one clear "what now".
  const step: 0 | 1 | 2 = !open ? 2 : turnsLeft <= 0 ? 1 : 0
  const wrapIsPrimary = open && turnsLeft <= 0

  return (
    <div className="space-y-4">
      {/* Header: what this room is about and where you are in it */}
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card rounded-xl px-4 py-3 flex flex-col gap-3 lg:flex-row lg:items-center"
      >
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-widest text-primary/80 font-mono">{ROOM_MODES[room.mode]?.label}</p>
          <p className="text-base sm:text-lg font-semibold leading-snug line-clamp-2">{room.topic}</p>
        </div>
        <RoomStepper step={step} turns={`${room.turns_taken}/${room.max_turns}`} transfersLeft={transfersLeft} />
        <Button size="sm" variant="ghost" onClick={onLeave} className="self-start lg:self-center">
          <SignOut size={14} className="mr-1" />Leave
        </Button>
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Main: the conversation, read top to bottom */}
        <Card className="glass-card p-0 overflow-hidden flex flex-col h-[min(680px,75vh)] min-w-0">
          <div ref={feedRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {room.messages.length === 0 && busy !== 'turn' && (
              <EmptyFeed nextName={nextSpeaker?.name} />
            )}
            <AnimatePresence initial={false}>
              {room.messages.map(m => (
                <MessageRow
                  key={m.id}
                  message={m}
                  participant={room.participants.find(p => p.agent_id === m.speaker.agent_id)}
                  seat={room.participants.findIndex(p => p.agent_id === m.speaker.agent_id)}
                  sketchUrl={m.kind === 'sketch' && m.at === room.sketch_at ? sketchUrl : null}
                  speaking={talking?.id === m.id}
                  onSpoken={doneTalking}
                  onGrow={scrollFeed}
                />
              ))}
              {busy === 'turn' && nextSpeaker && (
                <ThinkingBubble key="thinking" participant={nextSpeaker} seat={nextSeat} />
              )}
            </AnimatePresence>
            {!open && (
              <motion.button
                type="button"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => setSideTab('summary')}
                className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-sm text-emerald-200 flex items-center justify-center gap-2"
              >
                <CheckCircle size={16} weight="fill" /> Room wrapped up — see the summary
                {transfersLeft > 0 && <span className="text-emerald-300/80">· {transfersLeft} lesson{transfersLeft === 1 ? '' : 's'} to hand over</span>}
              </motion.button>
            )}
          </div>

          {open && (
            <div className="border-t border-border/40 bg-background/40 px-3 py-3 space-y-2.5">
              {/* One primary action at a time */}
              <div className="flex flex-wrap items-center gap-2">
                {!wrapIsPrimary ? (
                  <Button size="sm" onClick={takeTurn} disabled={!!busy || autoRun}>
                    <ArrowRight size={14} className="mr-1" />Next: {nextSpeaker?.name}
                  </Button>
                ) : (
                  <Button size="sm" onClick={conclude} disabled={!!busy} className="bg-secondary hover:bg-secondary/90">
                    <FlagCheckered size={14} className="mr-1" />{busy === 'conclude' ? 'Wrapping up…' : 'Wrap up the room'}
                  </Button>
                )}
                {!wrapIsPrimary && (
                  <Button size="sm" variant="outline" onClick={() => setAutoRun(v => !v)} disabled={busy === 'conclude'}>
                    {autoRun ? <><Pause size={14} className="mr-1" />Pause</> : <><Play size={14} className="mr-1" />Auto-run</>}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setBoardOpen(true)} disabled={ownerLeft <= 0}>
                  <PencilLine size={14} className="mr-1" />Whiteboard
                </Button>
                {!wrapIsPrimary && (
                  <Button size="sm" variant="ghost" onClick={conclude} disabled={!!busy || agentTurns === 0} className="ml-auto text-muted-foreground">
                    <FlagCheckered size={14} className="mr-1" />{busy === 'conclude' ? 'Wrapping up…' : 'Wrap up'}
                  </Button>
                )}
              </div>
              <div className="flex gap-2 items-end">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.slice(0, 600))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (ownerLeft > 0) say() } }}
                  placeholder={ownerLeft > 0 ? 'Join in — ask a question or steer the discussion…' : 'You have used all your messages in this room'}
                  rows={1}
                  disabled={ownerLeft <= 0 || busy === 'say'}
                  className="text-sm min-h-[40px] resize-none"
                />
                <Button onClick={say} disabled={!draft.trim() || ownerLeft <= 0 || !!busy} className="shrink-0" aria-label="Send">
                  <PaperPlaneRight size={16} />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground font-mono">
                {turnsLeft} turn{turnsLeft === 1 ? '' : 's'} left · {ownerLeft} of {limits.maxOwnerMessages} messages left
              </p>
            </div>
          )}
        </Card>

        {/* Side: who is at the table, then one panel at a time */}
        <div className="space-y-4 min-w-0">
          <RoomTable
            room={room}
            speakingId={speakingId}
            talkingId={talking?.agentId}
            thinkingId={busy === 'turn' ? nextSpeaker?.agent_id : undefined}
          />
          <Card className="glass-card p-0 overflow-hidden">
            <div className="flex border-b border-border/40" role="tablist">
              {([['lessons', `Lessons`], ['summary', 'Summary']] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={sideTab === id}
                  disabled={id === 'summary' && !room.synthesis}
                  onClick={() => setSideTab(id)}
                  className={cn('relative flex-1 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors disabled:opacity-40',
                    sideTab === id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
                >
                  {label}
                  {id === 'summary' && transfersLeft > 0 && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-secondary align-middle" />}
                  {sideTab === id && <motion.span layoutId="room-side-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary to-secondary" />}
                </button>
              ))}
            </div>
            <div className="p-4 max-h-[min(520px,60vh)] overflow-y-auto">
              {sideTab === 'summary' && room.synthesis
                ? <SynthesisPanel room={room} transferring={transferring} onHandOver={handOver} />
                : <LessonsPanel room={room} />}
            </div>
          </Card>
        </div>
      </div>

      <Dialog open={boardOpen} onOpenChange={setBoardOpen}>
        <DialogContent className="max-w-4xl sm:max-w-4xl glass-card border-primary/30">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><PencilLine size={18} className="text-primary" />Whiteboard</DialogTitle>
            <DialogDescription>Draw levels, flows or ideas. Your agents see the latest shared sketch in every turn after you share it.</DialogDescription>
          </DialogHeader>
          <RoomWhiteboard disabled={ownerLeft <= 0} sharing={sharing} onShare={shareSketch} />
        </DialogContent>
      </Dialog>
    </div>
  )
}

const STEPS = ['Discuss', 'Wrap up', 'Hand over'] as const

function RoomStepper({ step, turns, transfersLeft }: { step: 0 | 1 | 2; turns: string; transfersLeft: number }) {
  return (
    <ol className="flex items-center gap-1.5 text-[11px]" aria-label="Room progress">
      {STEPS.map((label, i) => {
        const done = i < step || (i === 2 && step === 2 && transfersLeft === 0)
        const current = i === step && !done
        return (
          <li key={label} className="flex items-center gap-1.5">
            {i > 0 && <span className={cn('h-px w-5', i <= step ? 'bg-primary/60' : 'bg-border')} />}
            <span
              aria-current={current ? 'step' : undefined}
              className={cn('flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium transition-colors',
                done ? 'border-emerald-500/40 text-emerald-300' : current ? 'border-primary/60 text-primary bg-primary/10' : 'border-border/50 text-muted-foreground')}
            >
              {done ? <CheckCircle size={11} weight="fill" /> : current ? <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" /> : null}
              {label}{i === 0 && step === 0 ? ` · ${turns}` : ''}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function EmptyFeed({ nextName }: { nextName?: string }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full min-h-[240px] flex flex-col items-center justify-center text-center gap-2 text-muted-foreground">
      <UsersThree size={32} weight="duotone" className="text-primary/70" />
      <p className="text-sm">Everyone is seated.</p>
      <p className="text-xs">Press <span className="text-foreground font-medium">Next: {nextName}</span> to start, or set the scene yourself below.</p>
    </motion.div>
  )
}

function ThinkingBubble({ participant, seat }: { participant: RoomParticipant; seat: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex gap-2.5 items-center">
      <div className={cn('rounded-full p-px ring-1 shrink-0', seatStyle(seat).ring)}>
        <NicheAvatar agent={asAvatar(participant)} size="sm" showRing={false} />
      </div>
      <div className="rounded-2xl border border-border/50 bg-white/[0.03] px-3 py-2 flex items-center gap-2">
        <span className={cn('text-xs font-semibold', seatStyle(seat).text)}>{participant.name}</span>
        <span className="text-xs text-muted-foreground">is thinking</span>
        <span className="flex gap-0.5" aria-hidden>
          {[0, 1, 2].map(i => (
            <motion.span
              key={i}
              className={cn('h-1.5 w-1.5 rounded-full', seatStyle(seat).dot)}
              animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
            />
          ))}
        </span>
      </div>
    </motion.div>
  )
}

/** The compact table: who is seated, who speaks, and lessons moving between them. */
function RoomTable({ room, speakingId, talkingId, thinkingId }: {
  room: AgentRoom; speakingId?: string; talkingId?: string; thinkingId?: string
}) {
  const reduce = useReducedMotion()
  const seats = seatPositions(room.participants.length)
  const seatOf = (agentId: string) => seats[room.participants.findIndex(p => p.agent_id === agentId)]
  const transfers = room.synthesis?.transfers ?? []
  const lastIsOwner = room.messages[room.messages.length - 1]?.speaker.type === 'owner'

  return (
    <Card className="glass-card p-0 overflow-hidden">
      <div className="relative w-full aspect-[4/3] select-none">
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <defs>
            <radialGradient id="room-table" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(0,243,255,0.12)" />
              <stop offset="100%" stopColor="rgba(157,0,255,0.04)" />
            </radialGradient>
          </defs>
          <motion.ellipse
            cx="50" cy="56" rx="30" ry="22" fill="url(#room-table)" stroke="rgba(0,243,255,0.25)" strokeWidth="0.3"
            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }}
            style={{ transformOrigin: '50% 56%' }}
          />
          <ellipse cx="50" cy="56" rx="24" ry="17" fill="none" stroke="rgba(0,243,255,0.10)" strokeWidth="0.2" strokeDasharray="1 1" />
          {transfers.map((t, i) => {
            const a = seatOf(t.from_agent_id)
            const b = seatOf(t.to_agent_id)
            if (!a || !b) return null
            const done = room.transfers_done?.includes(transferKey(t.to_agent_id, t.event_id))
            // Bow outward, away from the table centre.
            const mx = (a.x + b.x) / 2
            const my = (a.y + b.y) / 2
            const cx = mx + (mx - 50) * 0.6
            const cy = my + (my - 56) * 0.6
            return (
              <motion.path
                key={`${t.from_agent_id}-${t.to_agent_id}-${t.event_id}`}
                d={`M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`}
                fill="none"
                stroke={done ? 'rgba(52,211,153,0.85)' : 'rgba(192,132,252,0.75)'}
                strokeWidth="0.5"
                strokeDasharray={done ? undefined : '1.2 1'}
                vectorEffect="non-scaling-stroke"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ duration: 0.9, delay: 0.2 + i * 0.25 }}
              />
            )
          })}
        </svg>

        <div className="absolute left-1/2 top-[56%] -translate-x-1/2 -translate-y-1/2 text-center">
          <p className="text-[10px] text-muted-foreground font-mono">
            {room.status === 'open' ? `turn ${room.turns_taken}/${room.max_turns}` : 'wrapped up'}
          </p>
        </div>

        {room.participants.map((p, i) => {
          const seat = seats[i]
          const speaking = speakingId === p.agent_id
          const talking = talkingId === p.agent_id
          const thinking = thinkingId === p.agent_id
          // Talking: a lively bob. Thinking: a slow tilt. Otherwise: breathing,
          // each seat on its own rhythm so the table never moves in lockstep.
          const body = reduce ? {} : talking
            ? { y: [0, -4, 0, -2, 0], rotate: [0, -2, 0, 2, 0], transition: { duration: 0.9, repeat: Infinity } }
            : thinking
              ? { rotate: [0, -6, 0], transition: { duration: 1.6, repeat: Infinity, ease: 'easeInOut' as const } }
              : { scale: [1, 1.035, 1], transition: { duration: 3 + i * 0.45, repeat: Infinity, ease: 'easeInOut' as const } }
          return (
            <motion.div
              key={p.agent_id}
              className="absolute flex flex-col items-center gap-0.5 w-24"
              style={{ left: `${seat.x}%`, top: `${seat.y}%`, x: '-50%', y: '-50%' }}
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 220, damping: 18, delay: 0.1 + i * 0.12 }}
            >
              <AnimatePresence>
                {thinking && (
                  <motion.div
                    initial={{ opacity: 0, y: 4, scale: 0.8 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="absolute -top-6 rounded-full border border-border/60 bg-background/90 px-2 py-0.5 flex gap-0.5"
                    aria-hidden
                  >
                    {[0, 1, 2].map(d => (
                      <motion.span
                        key={d}
                        className={cn('h-1.5 w-1.5 rounded-full', seatStyle(i).dot)}
                        animate={reduce ? {} : { y: [0, -2, 0], opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 0.9, repeat: Infinity, delay: d * 0.15 }}
                      />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="relative">
                {(talking || thinking) && !reduce && (
                  <motion.span
                    className={cn('absolute inset-0 rounded-full ring-2', seatStyle(i).ring)}
                    initial={{ scale: 1, opacity: 0.8 }}
                    animate={{ scale: 1.7, opacity: 0 }}
                    transition={{ duration: talking ? 0.9 : 1.4, repeat: Infinity, ease: 'easeOut' }}
                  />
                )}
                <motion.div
                  animate={body}
                  className={cn('relative rounded-full p-0.5 ring-2 transition-shadow', seatStyle(i).ring,
                    talking || speaking ? seatStyle(i).glow : 'opacity-85')}
                >
                  <NicheAvatar agent={asAvatar(p)} size="md" showRing={false} />
                  <span className={cn('absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full text-[9px] font-bold text-background flex items-center justify-center', seatStyle(i).dot)}>
                    {p.name.charAt(0).toUpperCase()}
                  </span>
                </motion.div>
              </div>
              <p className={cn('text-[11px] font-semibold truncate max-w-full', seatStyle(i).text)}>{p.name}</p>
              {talking ? <VoiceWave seat={i} /> : (
                <p className="text-[9px] text-muted-foreground -mt-0.5">{p.is_mentor ? 'mentor · ' : ''}Lv {p.level}</p>
              )}
            </motion.div>
          )
        })}

        <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${OWNER_SEAT.x}%`, top: `${OWNER_SEAT.y}%` }}>
          <div className={cn('rounded-full px-2.5 py-0.5 text-[10px] font-semibold border transition-shadow',
            lastIsOwner ? 'border-amber-400/70 text-amber-300 shadow-[0_0_16px_rgba(251,191,36,0.35)]' : 'border-border/50 text-muted-foreground')}>
            You
          </div>
        </div>
      </div>
    </Card>
  )
}

/** A small equalizer under a seat while that agent is speaking. */
function VoiceWave({ seat }: { seat: number }) {
  const reduce = useReducedMotion()
  return (
    <span className="flex items-end gap-[2px] h-2.5" aria-label="speaking">
      {[0.5, 1, 0.7, 0.9, 0.4].map((h, k) => (
        <motion.span
          key={k}
          className={cn('w-[3px] rounded-full', seatStyle(seat).dot)}
          style={{ height: `${h * 100}%` }}
          animate={reduce ? {} : { scaleY: [0.3, 1, 0.5, 0.9, 0.3] }}
          transition={{ duration: 0.7 + k * 0.08, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </span>
  )
}

/** Reveals an agent's newest message word by word, as if it were speaking.
 *  Click to show it all at once; reduced motion shows it immediately. */
function useTypewriter(text: string, active: boolean, onDone?: () => void, onStep?: () => void) {
  const reduce = useReducedMotion()
  const words = useMemo(() => text.split(/(\s+)/), [text])
  const [shown, setShown] = useState(active && !reduce ? 0 : words.length)
  const finish = useCallback(() => { setShown(words.length) }, [words.length])

  useEffect(() => {
    if (!active || reduce) { setShown(words.length); return }
    setShown(0)
    const t = setInterval(() => setShown(n => {
      if (n >= words.length) { clearInterval(t); return n }
      return n + 2  // a word and the space after it
    }), 45)
    return () => clearInterval(t)
  }, [active, reduce, words.length])

  useEffect(() => {
    if (!active) return
    if (shown >= words.length) onDone?.()
    else if (shown % 20 === 0) onStep?.()
  }, [shown, words.length, active, onDone, onStep])

  return { text: shown >= words.length ? text : words.slice(0, shown).join(''), typing: shown < words.length, finish }
}

function MessageRow({ message, participant, seat, sketchUrl, speaking = false, onSpoken, onGrow }: {
  message: RoomMessage; participant?: RoomParticipant; seat: number; sketchUrl?: string | null
  speaking?: boolean; onSpoken?: () => void; onGrow?: () => void
}) {
  const isOwner = message.speaker.type === 'owner'
  const spoken = useTypewriter(message.text, speaking, onSpoken, onGrow)
  const [showSources, setShowSources] = useState(false)
  const n = message.citations.length
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn('flex gap-2.5', isOwner && 'flex-row-reverse')}
    >
      {participant ? (
        <div className={cn('rounded-full p-px ring-1 h-fit shrink-0', seatStyle(seat).ring)}>
          <NicheAvatar agent={asAvatar(participant)} size="sm" showRing={false} />
        </div>
      ) : (
        <div className="w-8 h-8 shrink-0 rounded-full border border-amber-400/50 text-amber-300 text-[10px] font-semibold flex items-center justify-center">You</div>
      )}
      <div className={cn('min-w-0 max-w-[88%]', isOwner && 'text-right')}>
        <p className={cn('text-[11px] font-semibold mb-1', participant ? seatStyle(seat).text : 'text-amber-300')}>
          {message.speaker.name}
          {message.kind === 'sketch' && <span className="ml-1.5 font-normal text-amber-300/70">shared a sketch</span>}
        </p>
        <div className={cn('inline-block text-left rounded-2xl px-3.5 py-2.5',
          isOwner ? 'rounded-tr-sm bg-amber-400/[0.08] border border-amber-400/25' : 'rounded-tl-sm bg-white/[0.035] border border-border/40')}>
          {sketchUrl && (
            <img src={sketchUrl} alt="The sketch the owner shared with the agents" className="mb-2 w-full max-w-[300px] rounded-lg border border-amber-400/30" />
          )}
          <p
            className="text-sm leading-relaxed whitespace-pre-wrap break-words"
            onClick={spoken.typing ? spoken.finish : undefined}
            title={spoken.typing ? 'Click to show the whole message' : undefined}
          >
            {spoken.text}
            {spoken.typing && <span className={cn('inline-block w-1.5 h-3.5 ml-0.5 align-middle animate-pulse', participant ? seatStyle(seat).dot : 'bg-amber-300')} />}
          </p>
          {message.flagged && (
            <p className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-300">
              <Warning size={12} weight="fill" /> A lesson held an instruction-like passage; the agent ignored it.
            </p>
          )}
        </div>
        {n > 0 && !spoken.typing && (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => setShowSources(v => !v)}
              aria-expanded={showSources}
              className="inline-flex items-center gap-1 text-[11px] text-primary/80 hover:text-primary"
            >
              <BookOpen size={12} weight="duotone" /> Based on {n} lesson{n === 1 ? '' : 's'} {showSources ? '▴' : '▾'}
            </button>
            <AnimatePresence initial={false}>
              {showSources && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {message.citations.map(c => <CitationChip key={c.event_id} citation={c} />)}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
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
      <span className="truncate">{decodeEntities(citation.title)}</span>
      {citation.source === 'peer' && <ArrowsLeftRight size={10} className="shrink-0 text-secondary" />}
    </span>
  )
}

/** Cited lessons per agent, collapsed to a count until opened. */
function LessonsPanel({ room }: { room: AgentRoom }) {
  const byAgent = room.participants.map((p, seat) => {
    const seen = new Map<string, RoomCitation>()
    for (const m of room.messages) {
      if (m.speaker.agent_id !== p.agent_id) continue
      for (const c of m.citations) if (!seen.has(c.event_id)) seen.set(c.event_id, c)
    }
    return { p, seat, lessons: [...seen.values()] }
  })
  const total = byAgent.reduce((n, a) => n + a.lessons.length, 0)
  const [openId, setOpenId] = useState<string | null>(null)

  if (total === 0) {
    return <p className="text-xs text-muted-foreground">Lessons an agent draws on show up here, grouped by who brought them.</p>
  }
  return (
    <div className="space-y-1.5">
      {byAgent.map(({ p, seat, lessons }) => {
        const isOpen = openId === p.agent_id
        return (
          <div key={p.agent_id} className="rounded-lg border border-border/40">
            <button
              type="button"
              onClick={() => setOpenId(isOpen ? null : p.agent_id)}
              aria-expanded={isOpen}
              disabled={lessons.length === 0}
              className="w-full flex items-center gap-2 px-2.5 py-2 text-left disabled:opacity-50"
            >
              <span className={cn('h-2 w-2 rounded-full', seatStyle(seat).dot)} />
              <span className={cn('text-xs font-semibold flex-1', seatStyle(seat).text)}>{p.name}</span>
              <span className="text-[10px] font-mono text-muted-foreground">{lessons.length} lesson{lessons.length === 1 ? '' : 's'} {lessons.length > 0 && (isOpen ? '▴' : '▾')}</span>
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.ul
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden px-2.5 pb-2 space-y-1"
                >
                  {lessons.map(l => (
                    <li key={l.event_id} className="text-xs leading-snug text-foreground/90 flex gap-1.5">
                      <BookOpen size={12} className="text-primary/70 shrink-0 mt-0.5" />
                      <span>
                        {decodeEntities(l.title)}
                        {l.source === 'peer' && l.from_agent_name && <span className="text-muted-foreground"> · from {l.from_agent_name}</span>}
                      </span>
                    </li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
        )
      })}
    </div>
  )
}

function SynthesisPanel({ room, transferring, onHandOver }: {
  room: AgentRoom
  transferring: string | null
  onHandOver: (eventId: string, toAgentId: string, toName: string) => void
}) {
  const s = room.synthesis!
  const section = (title: string, items: string[], checks?: RoomClaimCheck[]) => items.length > 0 && (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="text-sm leading-snug flex gap-1.5">
            <span className="text-primary">›</span>
            <span className="min-w-0">
              {it}
              {checks?.[i] && <CheckBadge check={checks[i]} />}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {s.summary && (
        <p className="text-sm leading-relaxed flex gap-2">
          <Sparkle size={16} weight="fill" className="text-secondary shrink-0 mt-0.5" />{s.summary}
        </p>
      )}
      {section('Key insights', s.key_insights, s.insight_checks)}
      {section('Still disputed', s.disagreements)}
      {section('Next steps for you', s.next_steps, s.next_step_checks)}

      <div className="space-y-2 pt-3 border-t border-border/40">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <ArrowsLeftRight size={13} /> Hand over lessons
        </p>
        {s.transfers.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing to hand over — no cited lesson was clearly missing from another agent.</p>
        ) : s.transfers.map((t, i) => {
          const key = transferKey(t.to_agent_id, t.event_id)
          const done = room.transfers_done?.includes(key)
          return (
            <motion.div
              key={key}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 + i * 0.08 }}
              className={cn('rounded-lg border px-3 py-2 space-y-1.5 transition-colors', done ? 'border-emerald-500/30 bg-emerald-500/[0.05]' : 'border-border/50')}
            >
              <p className="text-xs">
                <span className="font-semibold">{t.from_name}</span>
                <ArrowRight size={11} className="inline mx-1 text-secondary" />
                <span className="font-semibold">{t.to_name}</span>
              </p>
              <p className="text-sm leading-snug">{decodeEntities(t.title)}</p>
              {t.why && <p className="text-[11px] text-muted-foreground">{t.why}</p>}
              <Button
                size="sm"
                variant={done ? 'ghost' : 'default'}
                disabled={done || transferring === key}
                onClick={() => onHandOver(t.event_id, t.to_agent_id, t.to_name)}
                className="h-7 text-xs"
              >
                {done ? <><CheckCircle size={13} weight="fill" className="mr-1 text-emerald-400" />Handed over</>
                  : transferring === key ? 'Handing over…' : `Teach ${t.to_name}`}
              </Button>
            </motion.div>
          )
        })}
      </div>
    </motion.div>
  )
}

const CHECK_STYLE: Record<RoomClaimCheck['verdict'], { label: string; cls: string }> = {
  supported: { label: 'backed by lessons', cls: 'border-emerald-500/40 text-emerald-300' },
  partial: { label: 'partly backed', cls: 'border-amber-400/40 text-amber-300' },
  unsupported: { label: 'not from lessons', cls: 'border-border/60 text-muted-foreground' },
}

/** Result of the wrap-up fact-check: whether a claim rests on cited lessons
 *  or on the model's general knowledge. */
function CheckBadge({ check }: { check: RoomClaimCheck }) {
  const style = CHECK_STYLE[check.verdict] ?? CHECK_STYLE.unsupported
  const sources = check.refs.map(r => r.title).join(', ')
  return (
    <span
      className={cn('ml-1.5 inline-flex items-center rounded border px-1 py-px text-[9px] font-mono align-middle', style.cls)}
      title={sources ? `From: ${sources}` : 'None of the cited lessons backs this. Treat it as the agents\' opinion.'}
    >
      {style.label}
    </span>
  )
}
