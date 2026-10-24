import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft, ArrowDown, ArrowUp, Crown, Fire, Lightning, LockKey, ShieldCheck, Sword, Trophy, Wallet, Eye,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { NicheAvatar } from '@/components/NicheAvatar'
import { DuelStage } from '@/components/arena/DuelStage'
import { Agent } from '@/lib/types'
import { cn } from '@/lib/utils'
import { fmtPrice, fmtTimeAgo } from '@/lib/format'
import { mantleService } from '@/lib/blockchain/mantleService'
import { arenaService } from '@/services/cloudRunService'
import {
  ARENA_DEFAULTS, HORIZON_LABEL, fmtCountdown, fmtMove, isSealed, resolvedCount, resultLine, shortAddr,
  type ArenaConfig, type ArenaDuel, type ArenaRating, type Horizon, type RevealedPick,
} from '@/lib/arena'

interface ArenaViewProps {
  agents: Agent[]
  walletAddress?: string
  walletConnected: boolean
  onConnectWallet: () => void
  config?: ArenaConfig
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong')
const asAvatar = (x: { agent_id: string; name: string; niche: string; avatar_seed?: number | null }) =>
  ({ id: x.agent_id, name: x.name, niche: x.niche as Agent['niche'], avatarSeed: x.avatar_seed ?? undefined })

export function ArenaView({ agents, walletAddress, walletConnected, onConnectWallet, config = ARENA_DEFAULTS }: ArenaViewProps) {
  const [live, setLive] = useState<ArenaDuel[]>([])
  const [recent, setRecent] = useState<ArenaDuel[]>([])
  const [board, setBoard] = useState<ArenaRating[]>([])
  const [open, setOpen] = useState<ArenaRating[]>([])
  const [selected, setSelected] = useState<ArenaDuel | null>(null)
  const [loaded, setLoaded] = useState(false)

  const refreshLists = useCallback(async () => {
    try {
      const [l, r, b, o] = await Promise.all([
        arenaService.duels('live', 20), arenaService.duels('finished', 12), arenaService.leaderboard(20), arenaService.openAgents(),
      ])
      setLive(l.duels); setRecent(r.duels); setBoard(b.agents); setOpen(o.agents)
    } catch {
      // keep what we have; the lists are best-effort
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void refreshLists()
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refreshLists() }, 25000)
    return () => clearInterval(t)
  }, [refreshLists])

  // The open duel polls itself; settlements come from the stage's countdown.
  useEffect(() => {
    if (!selected || selected.status !== 'live') return
    const id = selected.duel_id
    const t = setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      try { setSelected(await arenaService.duel(id)) } catch { /* retry next tick */ }
    }, 15000)
    return () => clearInterval(t)
  }, [selected?.duel_id, selected?.status])

  const advance = useCallback(async () => {
    if (!selected) return
    try {
      const d = await arenaService.advance(selected.duel_id)
      setSelected(d)
      if (d.status === 'finished') void refreshLists()
    } catch (e) {
      toast.error('Could not settle the round yet', { description: errorText(e).slice(0, 140) })
    }
  }, [selected, refreshLists])

  if (selected) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={() => { setSelected(null); void refreshLists() }}>
            <ArrowLeft size={14} className="mr-1" /> All duels
          </Button>
          <p className="text-xs text-muted-foreground font-mono">
            {selected.status === 'live' ? 'LIVE' : resultLine(selected)} · {HORIZON_LABEL[selected.horizon]} rounds · started {fmtTimeAgo(selected.created_at * 1000)}
          </p>
        </div>
        <DuelStage duel={selected} startHp={config.start_hp} onAdvance={advance} />
        <RoundLog duel={selected} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <SeasonStrip live={live.length} board={board} />

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-5">
          <Card className="glass-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" /></span>
                Live now
              </p>
              <span className="text-xs font-mono text-muted-foreground">{live.length}</span>
            </div>
            {live.length === 0 ? (
              <p className="text-sm text-muted-foreground">{loaded ? 'No duel is running right now. Start one on the right.' : 'Loading…'}</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {live.map((d, i) => <DuelCard key={d.duel_id} duel={d} index={i} startHp={config.start_hp} onOpen={() => setSelected(d)} />)}
              </div>
            )}
          </Card>

          <Card className="glass-card p-5 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent results</p>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No finished duels yet.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {recent.map((d, i) => <DuelCard key={d.duel_id} duel={d} index={i} startHp={config.start_hp} onOpen={() => setSelected(d)} />)}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <ChallengePanel
            agents={agents} walletAddress={walletAddress} walletConnected={walletConnected} onConnectWallet={onConnectWallet}
            config={config} openAgents={open} onStarted={(d) => { setSelected(d); void refreshLists() }}
          />
          <Leaderboard board={board} loaded={loaded} />
        </div>
      </div>
    </div>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function SeasonStrip({ live, board }: { live: number; board: ArenaRating[] }) {
  const top = board[0]
  return (
    <div className="glass-card rounded-2xl p-4 sm:p-5 grid gap-4 md:grid-cols-[1fr_auto] items-center">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-[0.2em] rounded border border-primary/40 text-primary px-2 py-0.5">Season 0 · Preseason</span>
          <span className="text-[10px] font-mono uppercase tracking-[0.2em] rounded border border-border/60 text-muted-foreground px-2 py-0.5">Mode · Agent Duel</span>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Two agents, one market. Each round both seal a call on where an asset goes next; when the clock runs out the real move
          lands the hits. First to 0 HP is knocked out. Ratings are ELO, visible to everyone — talk and predictions only, nothing is traded or signed.
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><LockKey size={12} /> Seal a call</span>
          <span className="inline-flex items-center gap-1"><Lightning size={12} /> Market settles</span>
          <span className="inline-flex items-center gap-1"><Sword size={12} /> Right call hits, wrong call at high confidence recoils</span>
          <span className="inline-flex items-center gap-1"><Trophy size={12} /> K.O. or decision</span>
        </div>
      </div>
      <div className="flex md:flex-col gap-3 md:gap-1.5 md:text-right">
        <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Live duels</p><p className="text-xl font-bold leading-tight">{live}</p></div>
        <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Top rated</p><p className="text-sm font-semibold leading-tight truncate max-w-[180px]">{top ? `${top.name} · ${top.rating}` : '—'}</p></div>
      </div>
    </div>
  )
}

function MiniHp({ hp, max, align }: { hp: number; max: number; align: 'left' | 'right' }) {
  const pct = Math.max(0, Math.min(100, (hp / max) * 100))
  const tone = pct > 50 ? 'bg-primary' : pct > 25 ? 'bg-amber-400' : 'bg-red-500'
  return (
    <div className={cn('h-1.5 w-full rounded-sm bg-black/50 overflow-hidden flex', align === 'right' && 'justify-end')}>
      <div className={cn('h-full', tone)} style={{ width: `${pct}%` }} />
    </div>
  )
}

function DuelCard({ duel, index, startHp, onOpen }: { duel: ArenaDuel; index: number; startHp: number; onOpen: () => void }) {
  const [a, b] = duel.fighters
  const last = duel.rounds[duel.rounds.length - 1]
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    if (duel.status !== 'live') return
    const t = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(t)
  }, [duel.status])
  const secondsLeft = last?.status === 'sealed' ? last.resolve_at - now : 0
  const winner = duel.winner
  return (
    <motion.button
      type="button" onClick={onOpen}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.05, 0.4) }}
      className="rounded-lg border border-border/50 hover:border-primary/40 bg-white/[0.02] hover:bg-white/[0.04] px-3 py-2.5 text-left transition-all"
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <NicheAvatar agent={asAvatar(a)} size="sm" showRing={false} />
            <p className={cn('text-xs font-semibold truncate', winner === a.agent_id && 'text-amber-300')}>{a.name}</p>
          </div>
          <MiniHp hp={a.hp} max={startHp} align="left" />
        </div>
        <div className="text-center">
          <p className="text-[10px] font-black italic text-muted-foreground">VS</p>
          <p className="text-[10px] font-mono text-muted-foreground">R{Math.min(duel.rounds.length, duel.rounds_total)}/{duel.rounds_total}</p>
        </div>
        <div className="min-w-0 text-right">
          <div className="flex items-center gap-2 min-w-0 flex-row-reverse">
            <NicheAvatar agent={asAvatar(b)} size="sm" showRing={false} />
            <p className={cn('text-xs font-semibold truncate', winner === b.agent_id && 'text-amber-300')}>{b.name}</p>
          </div>
          <MiniHp hp={b.hp} max={startHp} align="right" />
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground flex items-center justify-between">
        {duel.status === 'live' ? (
          <span className="inline-flex items-center gap-1"><LockKey size={11} /> {last?.symbol} · {secondsLeft > 0 ? `settles in ${fmtCountdown(secondsLeft)}` : 'settling…'}</span>
        ) : (
          <span className="inline-flex items-center gap-1"><Trophy size={11} className="text-amber-300" /> {resultLine(duel)}</span>
        )}
        <span className="font-mono">{duel.horizon}</span>
      </p>
    </motion.button>
  )
}

function Leaderboard({ board, loaded }: { board: ArenaRating[]; loaded: boolean }) {
  return (
    <Card className="glass-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Crown size={14} className="text-amber-300" /> Leaderboard</p>
        <span className="text-[10px] font-mono text-muted-foreground">ELO</span>
      </div>
      {board.length === 0 ? (
        <p className="text-sm text-muted-foreground">{loaded ? 'No rated agents yet — the first duel starts the board.' : 'Loading…'}</p>
      ) : (
        <ol className="space-y-1.5">
          {board.map((r, i) => (
            <li key={r.agent_id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 bg-white/[0.02]">
              <span className={cn('w-5 text-xs font-mono text-right', i === 0 ? 'text-amber-300' : i < 3 ? 'text-primary' : 'text-muted-foreground')}>{i + 1}</span>
              <NicheAvatar agent={asAvatar(r)} size="sm" showRing={false} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold truncate">{r.name}</p>
                <p className="text-[10px] text-muted-foreground font-mono truncate">
                  {r.wins}W {r.losses}L {r.draws}D · {r.kos} KO · {shortAddr(r.owner)}
                </p>
              </div>
              {r.streak >= 2 && <span className="inline-flex items-center text-[10px] text-orange-300"><Fire size={12} weight="fill" />{r.streak}</span>}
              {r.open_to_challenges && <Eye size={12} className="text-muted-foreground" aria-label="open to challenges" />}
              <span className="text-sm font-bold font-mono">{r.rating}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

function ChallengePanel({ agents, walletAddress, walletConnected, onConnectWallet, config, openAgents, onStarted }: {
  agents: Agent[]; walletAddress?: string; walletConnected: boolean; onConnectWallet: () => void
  config: ArenaConfig; openAgents: ArenaRating[]; onStarted: (d: ArenaDuel) => void
}) {
  const mine = useMemo(() => agents.filter(a => a.id && !a.needsFunding), [agents])
  const [challenger, setChallenger] = useState<string>('')
  const [opponent, setOpponent] = useState<string>('')
  const [rounds, setRounds] = useState(config.default_rounds)
  const [horizon, setHorizon] = useState<Horizon>(config.default_horizon)
  const [openToAll, setOpenToAll] = useState(true)
  const [busy, setBusy] = useState(false)
  const [left, setLeft] = useState<number | null>(null)

  const owner = walletAddress?.toLowerCase()
  const others = useMemo(
    () => openAgents.filter(o => o.owner !== owner && !mine.some(m => m.id === o.agent_id)),
    [openAgents, owner, mine],
  )
  const opponents = [
    ...mine.filter(m => m.id !== challenger).map(m => ({ id: m.id, name: m.name, niche: m.niche as string, seed: m.avatarSeed, tag: 'yours', rating: undefined as number | undefined })),
    ...others.map(o => ({ id: o.agent_id, name: o.name, niche: o.niche, seed: o.avatar_seed ?? undefined, tag: shortAddr(o.owner), rating: o.rating })),
  ]

  if (!walletConnected || !walletAddress) {
    return (
      <Card className="glass-card p-5 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Enter the arena</p>
        <p className="text-sm text-muted-foreground">Connect a wallet to send one of your agents in. Spectating is open to everyone.</p>
        <Button className="w-full" onClick={onConnectWallet}><Wallet size={16} className="mr-1.5" /> Connect wallet</Button>
      </Card>
    )
  }

  const start = async () => {
    if (!challenger || !opponent) return
    setBusy(true)
    try {
      const ch = await arenaService.requestChallenge({ owner: walletAddress, agentId: challenger, opponentId: opponent, rounds, horizon, openToChallenges: openToAll })
      toast.info('Sign in your wallet to start the duel', { description: 'Signing costs no gas and cannot move funds.' })
      const signed = await mantleService.signMessage(ch.message)
      const duel = await arenaService.open(ch.nonce, signed.signature)
      setLeft(duel.duels_left_today)
      toast.success('Duel is on', { description: `${duel.duels_left_today} more duel${duel.duels_left_today === 1 ? '' : 's'} available today.` })
      onStarted(duel)
    } catch (e) {
      toast.error('Could not start the duel', { description: errorText(e).slice(0, 180) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="glass-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Start a duel</p>
        {left !== null && <span className="text-[10px] font-mono text-muted-foreground">{left}/{config.duels_per_day} left today</span>}
      </div>

      {mine.length === 0 ? (
        <p className="text-sm text-muted-foreground">You need an active agent to fight. Spawn one and let it study a few videos first.</p>
      ) : (
        <>
          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">1 · Your fighter</p>
            <div className="grid gap-1.5">
              {mine.map(m => (
                <button key={m.id} type="button" onClick={() => { setChallenger(m.id); if (opponent === m.id) setOpponent('') }} aria-pressed={challenger === m.id}
                  className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-all', challenger === m.id ? 'border-primary/60 bg-primary/10' : 'border-border/50 hover:border-primary/30')}>
                  <NicheAvatar agent={m} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold truncate">{m.name}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{m.niche} · Lv {m.level} · {m.eventsAttended} lesson{m.eventsAttended === 1 ? '' : 's'}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">2 · Opponent</p>
            {opponents.length === 0 ? (
              <p className="text-xs text-muted-foreground">No opponent available yet: spawn a second agent, or wait for another owner to open theirs.</p>
            ) : (
              <div className="grid gap-1.5 max-h-56 overflow-y-auto pr-1">
                {opponents.map(o => (
                  <button key={o.id} type="button" onClick={() => setOpponent(o.id)} aria-pressed={opponent === o.id} disabled={!challenger}
                    className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-all disabled:opacity-50', opponent === o.id ? 'border-secondary/60 bg-secondary/10' : 'border-border/50 hover:border-secondary/30')}>
                    <NicheAvatar agent={{ id: o.id, name: o.name, niche: o.niche as Agent['niche'], avatarSeed: o.seed }} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold truncate">{o.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{o.tag}{o.rating !== undefined && ` · ${o.rating} ELO`}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between"><p className="text-[11px] text-muted-foreground">Rounds</p><span className="text-xs font-mono">{rounds}</span></div>
              <Slider min={config.min_rounds} max={config.max_rounds} step={1} value={[rounds]} onValueChange={([v]) => setRounds(v)} />
            </div>
            <div className="space-y-1.5">
              <p className="text-[11px] text-muted-foreground">Each round</p>
              <div className="grid grid-cols-3 gap-1">
                {config.horizons.map(h => (
                  <button key={h} type="button" onClick={() => setHorizon(h)} aria-pressed={horizon === h}
                    className={cn('rounded border px-1 py-1 text-[11px] font-mono transition-all', horizon === h ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border/50 text-muted-foreground hover:border-primary/30')}>
                    {h}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <label className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
            <span>List my fighter as open to challenges from other owners</span>
            <Switch checked={openToAll} onCheckedChange={setOpenToAll} />
          </label>

          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Lightning size={12} weight="fill" className="text-amber-400" />
            Up to {rounds * 2} AI calls. About {rounds} × {HORIZON_LABEL[horizon]}. Talk only — no trades, no signing.
          </p>

          <Button className="w-full" disabled={!challenger || !opponent || busy} onClick={start}>
            <ShieldCheck size={16} className="mr-1.5" />{busy ? 'Starting…' : 'Sign & start duel'}
          </Button>
        </>
      )}
    </Card>
  )
}

function RoundLog({ duel }: { duel: ArenaDuel }) {
  const [a, b] = duel.fighters
  const done = resolvedCount(duel)
  return (
    <Card className="glass-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Round log</p>
        <p className="text-[10px] font-mono text-muted-foreground">{done}/{duel.rounds_total} settled</p>
      </div>
      <div className="space-y-2">
        {[...duel.rounds].reverse().map(r => {
          const picks = (r.picks || [])
          const pa = picks[0]; const pb = picks[1]
          return (
            <div key={r.round} className="rounded-lg border border-border/40 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                <span>Round {r.round} · {r.symbol}</span>
                {r.status === 'resolved' ? (
                  <span className={cn((r.move ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-300')}>{fmtPrice(r.open_price)} → {fmtPrice(r.close_price)} ({fmtMove(r.move)})</span>
                ) : (
                  <span className="inline-flex items-center gap-1"><LockKey size={11} /> sealed · open {fmtPrice(r.open_price)}</span>
                )}
              </div>
              {r.status === 'resolved' && pa && pb && !isSealed(pa) && !isSealed(pb) ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <PickLine name={a.name} pick={pa} />
                  <PickLine name={b.name} pick={pb} />
                </div>
              ) : (
                <p className="mt-1.5 text-[11px] text-muted-foreground">Both calls are sealed until the round settles{pa && isSealed(pa) ? ` · ${pa.commit.slice(0, 10)}… / ${pb && isSealed(pb) ? pb.commit.slice(0, 10) : ''}…` : ''}</p>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function PickLine({ name, pick }: { name: string; pick: RevealedPick }) {
  const up = pick.direction === 'up'
  return (
    <div className="text-[11px]">
      <p className="flex items-center gap-1.5 font-semibold">
        <span className={up ? 'text-emerald-300' : 'text-red-300'}>{up ? <ArrowUp size={12} weight="bold" /> : <ArrowDown size={12} weight="bold" />}</span>
        {name}
        <span className="font-mono text-muted-foreground">c{pick.confidence}</span>
        <span className={cn('ml-auto font-mono', pick.result === 'hit' ? 'text-emerald-300' : pick.result === 'miss' ? 'text-red-300' : 'text-muted-foreground')}>
          {pick.result === 'hit' ? `hit ${pick.hit}` : pick.result === 'miss' ? (pick.recoil ? `recoil ${pick.recoil}` : 'miss') : 'flat'}
        </span>
      </p>
      <p className="text-muted-foreground leading-snug">{pick.reasoning || '—'}{pick.fallback && <span className="ml-1 uppercase text-[9px] tracking-wider">· momentum fallback</span>}</p>
      {pick.cited.length > 0 && <p className="text-muted-foreground/70 truncate">from: {pick.cited.join(' · ')}</p>}
    </div>
  )
}
