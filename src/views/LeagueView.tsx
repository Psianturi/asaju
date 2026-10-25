import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowDown, ArrowLeft, ArrowSquareOut, ArrowUp, ChartLineUp, Clock, Crown, Fire, Lightning, LockKey, Question, ShieldCheck,
  Target, Trophy, Wallet, X, Users,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { NicheAvatar } from '@/components/NicheAvatar'
import { useLocalStorage } from '@/hooks/useLocalStorage'
import { Agent } from '@/lib/types'
import { cn } from '@/lib/utils'
import { fmtPrice } from '@/lib/format'
import { mantleService } from '@/lib/blockchain/mantleService'
import { leagueService } from '@/services/cloudRunService'
import { fmtCountdown, fmtMove, shortAddr } from '@/lib/arena'
import {
  LEAGUE_DEFAULTS, PHASE_LABEL, VOID_REASON, fmtAccuracy, fmtPoints, fmtWindowSpan, formLine, isRevealed, pointsFor, seasonLabel, windowPhase,
  type LeagueConfig, type LeaguePick, type LeagueRecord, type LeagueStanding, type LeagueWindow,
} from '@/lib/league'

interface LeagueViewProps {
  agents: Agent[]
  walletAddress?: string
  walletConnected: boolean
  onConnectWallet: () => void
  config?: LeagueConfig
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong')
const asAvatar = (x: { agent_id: string; name?: string; niche?: string; avatar_seed?: number | null }) =>
  ({ id: x.agent_id, name: x.name ?? x.agent_id, niche: (x.niche ?? 'General') as Agent['niche'], avatarSeed: x.avatar_seed ?? undefined })

function useNow() {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

export function LeagueView({ agents, walletAddress, walletConnected, onConnectWallet, config = LEAGUE_DEFAULTS }: LeagueViewProps) {
  const [upcoming, setUpcoming] = useState<LeagueWindow[]>([])
  const [locked, setLocked] = useState<LeagueWindow[]>([])
  const [recent, setRecent] = useState<LeagueWindow[]>([])
  const [board, setBoard] = useState<LeagueStanding[]>([])
  const [seasonId, setSeasonId] = useState(config.season_id)
  const [selected, setSelected] = useState<LeagueWindow | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [guideDismissed, setGuideDismissed] = useLocalStorage('asaju.league.guide.v1', false)
  const [guideOpen, setGuideOpen] = useState(false)
  const now = useNow()

  const refresh = useCallback(async () => {
    try {
      const [u, s, all, b] = await Promise.all([
        leagueService.windows('upcoming', 4), leagueService.windows('sealed', 10), leagueService.windows(undefined, 20), leagueService.standings(),
      ])
      setUpcoming(u.windows); setLocked(s.windows)
      setRecent(all.windows.filter(w => w.status === 'resolved' || (w.status === 'void' && w.void_reason !== 'no_participants')).slice(0, 12))
      setBoard(b.agents); setSeasonId(b.season_id)
    } catch {
      // best-effort lists; keep what we have
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 20000)
    return () => clearInterval(t)
  }, [refresh])

  // An open window keeps itself fresh until it settles.
  useEffect(() => {
    if (!selected || selected.status === 'resolved' || selected.status === 'void') return
    const id = selected.window_id
    const t = setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      try { setSelected(await leagueService.window(id)) } catch { /* retry next tick */ }
    }, 15000)
    return () => clearInterval(t)
  }, [selected?.window_id, selected?.status])

  const openWindow = async (w: LeagueWindow) => {
    setSelected(w)
    try { setSelected(await leagueService.window(w.window_id)) } catch { /* show the list copy */ }
  }

  if (selected) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => { setSelected(null); void refresh() }}>
          <ArrowLeft size={14} className="mr-1" /> All windows
        </Button>
        <WindowDetail w={selected} now={now} config={config} />
      </div>
    )
  }

  const next = upcoming[0]
  return (
    <div className="space-y-5">
      <LeagueStrip next={next} now={now} seasonId={seasonId} liveCount={locked.length} board={board} onHelp={() => setGuideOpen(true)} />
      {(!guideDismissed || guideOpen) && <LeagueGuide config={config} onDismiss={() => { setGuideDismissed(true); setGuideOpen(false) }} />}

      <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-5">
          <Card className="glass-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Clock size={14} className="text-primary" /> Opening next</p>
              <span className="text-[10px] font-mono text-muted-foreground">picks close at the bell</span>
            </div>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">{loaded ? 'The schedule is being prepared — check back in a minute.' : 'Loading…'}</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {upcoming.map((w, i) => <WindowCard key={w.window_id} w={w} now={now} index={i} max={config.max_participants} onOpen={() => void openWindow(w)} />)}
              </div>
            )}
          </Card>

          <Card className="glass-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" /></span>
                Locked · waiting for the market
              </p>
              <span className="text-xs font-mono text-muted-foreground">{locked.length}</span>
            </div>
            {locked.length === 0 ? (
              <p className="text-sm text-muted-foreground">{loaded ? 'No window is waiting on a candle right now.' : 'Loading…'}</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {locked.map((w, i) => <WindowCard key={w.window_id} w={w} now={now} index={i} max={config.max_participants} onOpen={() => void openWindow(w)} />)}
              </div>
            )}
          </Card>

          <Card className="glass-card p-5 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Settled</p>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No settled window yet — the first one lands 30 minutes after the first pick.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {recent.map((w, i) => <WindowCard key={w.window_id} w={w} now={now} index={i} max={config.max_participants} onOpen={() => void openWindow(w)} />)}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <EnterPanel
            agents={agents} walletAddress={walletAddress} walletConnected={walletConnected} onConnectWallet={onConnectWallet}
            config={config} upcoming={upcoming} now={now} onSealed={(id) => { void refresh(); void leagueService.window(id).then(setSelected).catch(() => undefined) }}
          />
          <Standings board={board} loaded={loaded} seasonId={seasonId} />
          {walletConnected && <MyRecord agents={agents} />}
        </div>
      </div>
    </div>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function LeagueStrip({ next, now, seasonId, liveCount, board, onHelp }: {
  next?: LeagueWindow; now: number; seasonId: string; liveCount: number; board: LeagueStanding[]; onHelp: () => void
}) {
  const top = board[0]
  return (
    <div className="glass-card rounded-2xl p-4 sm:p-5 grid gap-4 md:grid-cols-[1fr_auto] items-center">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-[0.2em] rounded border border-primary/40 text-primary px-2 py-0.5">{seasonLabel(seasonId)}</span>
          <span className="text-[10px] font-mono uppercase tracking-[0.2em] rounded border border-border/60 text-muted-foreground px-2 py-0.5">30-min windows</span>
          <button type="button" onClick={onHelp} className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.2em] rounded border border-primary/40 text-primary px-2 py-0.5 hover:bg-primary/10">
            <Question size={11} weight="bold" /> How it works
          </button>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          {next
            ? <>Next up: <b className="text-foreground">{next.symbol}</b> · picks close in <b className="text-foreground font-mono">{fmtCountdown(next.open_ts - now)}</b> · {next.participants.length} agent{next.participants.length === 1 ? '' : 's'} in so far. Settles 30 minutes after the bell.</>
            : 'Agents call where a coin goes in the next 30 minutes. Calls are sealed, the real price settles them, and every result can be checked.'}
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Lightning size={12} weight="fill" className="text-amber-400" /> 1 AI call per pick</span>
          <span className="inline-flex items-center gap-1"><LockKey size={12} /> Sealed until settled</span>
          <span className="inline-flex items-center gap-1"><ChartLineUp size={12} /> Real candle decides</span>
          <span className="inline-flex items-center gap-1"><ShieldCheck size={12} /> Proof published</span>
        </div>
      </div>
      <div className="flex md:flex-col gap-3 md:gap-1.5 md:text-right">
        <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Waiting on the market</p><p className="text-xl font-bold leading-tight">{liveCount}</p></div>
        <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Top rated</p><p className="text-sm font-semibold leading-tight truncate max-w-[180px]">{top ? `${top.name} · ${top.rating}` : '—'}</p></div>
      </div>
    </div>
  )
}

const STEPS = [
  { icon: Clock, title: 'A window opens', text: 'Every 30 minutes, on one coin (BTC, ETH, SOL, BNB, MNT in turn). Up to 8 agents can enter until the bell.' },
  { icon: Lightning, title: 'One sealed call', text: 'Your agent reads its own lessons and the market once — the only AI step — and calls UP or DOWN with confidence 1–3. Nobody sees it yet.' },
  { icon: ChartLineUp, title: 'The market settles it', text: '30 minutes later the real candle close decides. If the price barely moves or no data arrives, the window is void: nothing gained, nothing lost.' },
  { icon: Trophy, title: 'Points, proof, rating', text: 'Picks are revealed with their salt so anyone can recompute the seal. Season ratings reset weekly; career record stays.' },
]

function LeagueGuide({ config, onDismiss }: { config: LeagueConfig; onDismiss: () => void }) {
  const ex = (c: number, dir: 'up' | 'down', move: number) => pointsFor(dir, c, move, config)
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card rounded-2xl p-5 sm:p-6 space-y-5 relative">
      <button type="button" onClick={onDismiss} aria-label="Hide the guide" className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-white/5"><X size={16} /></button>
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/10 border border-primary/30"><Target size={20} weight="duotone" className="text-primary" /></div>
        <div>
          <h3 className="text-lg font-bold tracking-tight">How the League works</h3>
          <p className="text-sm text-muted-foreground">The one game the market itself referees. No trades, no gas — just whether your agent reads the next 30 minutes right.</p>
        </div>
      </div>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <motion.li key={s.title} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 * i }} className="rounded-lg border border-border/50 bg-white/[0.02] p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="h-6 w-6 rounded-full bg-primary/15 text-primary text-xs font-bold grid place-items-center">{i + 1}</span>
              <s.icon size={16} className="text-primary" />
              <p className="text-sm font-semibold">{s.title}</p>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">{s.text}</p>
          </motion.li>
        ))}
      </ol>
      <div className="grid gap-3 md:grid-cols-[1fr_auto] items-end">
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Scoring · right calls earn, confident wrong calls cost</p>
          <div className="flex flex-wrap gap-2 text-[11px]">
            {[
              ['Right, confidence 1, small move', ex(1, 'up', 0.001)], ['Right, confidence 3, +0.5% move', ex(3, 'up', 0.005)],
              ['Wrong, confidence 1', ex(1, 'down', 0.003)], ['Wrong, confidence 3', ex(3, 'down', 0.003)],
            ].map(([label, pts]) => (
              <span key={label as string} className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-black/20 px-2 py-1">
                <span className={cn('font-mono font-bold', (pts as number) > 0 ? 'text-emerald-300' : (pts as number) < 0 ? 'text-red-300' : 'text-muted-foreground')}>{fmtPoints(pts as number)}</span>
                <span className="text-muted-foreground">{label}</span>
              </span>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">A pick the model could not make (fallback) scores 0 and never counts toward accuracy. {config.picks_per_day} picks per owner per day.</p>
        </div>
        <Button variant="outline" onClick={onDismiss}>Got it</Button>
      </div>
    </motion.div>
  )
}

function PhasePill({ w, now }: { w: LeagueWindow; now: number }) {
  const phase = windowPhase(w, now)
  const tone = phase === 'open' ? 'border-emerald-400/50 text-emerald-300' : phase === 'locked' ? 'border-primary/50 text-primary' : phase === 'void' ? 'border-border/60 text-muted-foreground' : phase === 'resolved' ? 'border-amber-300/50 text-amber-200' : 'border-border/60 text-muted-foreground'
  const text = phase === 'open' ? `picks close in ${fmtCountdown(w.open_ts - now)}` : phase === 'locked' ? `settles in ${fmtCountdown(w.resolve_ts - now)}` : PHASE_LABEL[phase]
  return <span className={cn('text-[10px] font-mono rounded border px-1.5 py-0.5 whitespace-nowrap', tone)}>{text}</span>
}

function MoveTag({ move }: { move: number | null | undefined }) {
  if (move === null || move === undefined) return <span className="text-muted-foreground">—</span>
  const up = move > 0
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-mono', up ? 'text-emerald-300' : 'text-red-300')}>
      {up ? <ArrowUp size={11} weight="bold" /> : <ArrowDown size={11} weight="bold" />}{fmtMove(move)}
    </span>
  )
}

function WindowCard({ w, now, index, max, onOpen }: { w: LeagueWindow; now: number; index: number; max: number; onOpen: () => void }) {
  const phase = windowPhase(w, now)
  return (
    <motion.button
      type="button" onClick={onOpen}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.05, 0.4) }}
      className="rounded-lg border border-border/50 hover:border-primary/40 bg-white/[0.02] hover:bg-white/[0.04] px-3 py-2.5 text-left transition-all space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="h-8 w-8 rounded-md bg-primary/10 border border-primary/30 grid place-items-center text-[11px] font-black text-primary">{w.symbol}</span>
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate">{w.kind === 'private' ? 'Private window' : 'Official window'}</p>
            <p className="text-[10px] font-mono text-muted-foreground">{fmtWindowSpan(w.open_ts, w.resolve_ts)}</p>
          </div>
        </div>
        <PhasePill w={w} now={now} />
      </div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Users size={11} /> {w.participants.length}{w.kind === 'official' ? `/${max}` : ''} agent{w.participants.length === 1 ? '' : 's'}</span>
        {phase === 'resolved' ? (
          <span className="inline-flex items-center gap-1">{fmtPrice(w.open_price ?? 0)} → {fmtPrice(w.close_price ?? 0)} <MoveTag move={w.move} /></span>
        ) : phase === 'void' ? (
          <span>void · {VOID_REASON[w.void_reason ?? ''] ?? w.void_reason}</span>
        ) : phase === 'locked' && w.open_price ? (
          <span className="inline-flex items-center gap-1"><LockKey size={11} /> locked at {fmtPrice(w.open_price)}</span>
        ) : (
          <span className="inline-flex items-center gap-1"><LockKey size={11} /> {w.participants.length} sealed</span>
        )}
      </div>
    </motion.button>
  )
}

function WindowDetail({ w, now, config }: { w: LeagueWindow; now: number; config: LeagueConfig }) {
  const phase = windowPhase(w, now)
  const revealed = phase === 'resolved' || phase === 'void'
  const stat = (label: string, value: React.ReactNode, tone?: string) => (
    <div className="rounded-lg border border-border/40 bg-white/[0.02] px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('text-sm font-bold', tone)}>{value}</p>
    </div>
  )
  const sorted = [...w.picks].sort((a, b) => ((isRevealed(b) ? b.points ?? 0 : 0) - (isRevealed(a) ? a.points ?? 0 : 0)))
  const magnitude = Math.min(1, Math.abs(w.move ?? 0) / 0.01)
  return (
    <div className="space-y-4">
      <Card className="glass-card p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="h-12 w-12 rounded-lg bg-primary/10 border border-primary/30 grid place-items-center text-sm font-black text-primary">{w.symbol}</span>
            <div>
              <p className="text-base font-bold">{w.kind === 'private' ? 'Private window' : 'Official window'} · {w.symbol}</p>
              <p className="text-[11px] font-mono text-muted-foreground">{fmtWindowSpan(w.open_ts, w.resolve_ts)} · {w.participants.length} agent{w.participants.length === 1 ? '' : 's'} · {seasonLabel(w.season_id)}</p>
            </div>
          </div>
          <PhasePill w={w} now={now} />
        </div>

        <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
          {stat('Locked at', w.open_price ? fmtPrice(w.open_price) : phase === 'open' ? 'at the bell' : 'fetching…')}
          {stat('Closed at', w.close_price ? fmtPrice(w.close_price) : revealed ? '—' : 'pending')}
          {stat('Move', <MoveTag move={w.move} />)}
          {stat('Outcome', phase === 'void' ? `Void · ${VOID_REASON[w.void_reason ?? ''] ?? w.void_reason}` : phase === 'resolved' ? ((w.move ?? 0) > 0 ? 'UP wins' : 'DOWN wins') : PHASE_LABEL[phase], phase === 'resolved' ? ((w.move ?? 0) > 0 ? 'text-emerald-300' : 'text-red-300') : undefined)}
        </div>

        {phase === 'resolved' && (
          <div className="space-y-1">
            <div className="relative h-2 rounded-full bg-black/40 overflow-hidden">
              <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
              <div className={cn('absolute top-0 h-full', (w.move ?? 0) > 0 ? 'left-1/2 bg-emerald-400' : 'right-1/2 bg-red-400')} style={{ width: `${Math.max(2, magnitude * 50)}%` }} />
            </div>
            <p className="text-[10px] text-muted-foreground font-mono flex justify-between"><span>−1%</span><span>bonus caps at ±0.5%</span><span>+1%</span></p>
          </div>
        )}

        {phase === 'locked' && (
          <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
            <LockKey size={12} /> Calls are sealed. Nothing moves until the candle closes at {fmtWindowSpan(w.open_ts, w.resolve_ts).split('–')[1]} — the League checks every 5 minutes and settles as soon as the final price exists.
          </p>
        )}
      </Card>

      <Card className="glass-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Calls</p>
          <p className="text-[10px] font-mono text-muted-foreground">{revealed ? 'revealed' : 'sealed'}</p>
        </div>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody has entered this window yet.</p>
        ) : (
          <div className="space-y-2">
            {sorted.map(p => <PickRow key={p.agent_id} p={p} revealed={revealed} void_={phase === 'void'} />)}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-muted-foreground">
          <span>seal = sha256(window · 0 · agent · direction · confidence · salt) · price at T = close of the 30-min candle opened at T−30m</span>
          <a href={leagueService.verifyUrl(w.window_id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
            <ShieldCheck size={12} /> Verify this window <ArrowSquareOut size={11} />
          </a>
        </div>
      </Card>
    </div>
  )
}

function PickRow({ p, revealed, void_ }: { p: LeaguePick; revealed: boolean; void_: boolean }) {
  const r = isRevealed(p) ? p : null
  const up = r?.direction === 'up'
  return (
    <div className="rounded-lg border border-border/40 bg-white/[0.02] px-3 py-2 flex items-start gap-2.5">
      <NicheAvatar agent={asAvatar(p)} size="sm" showRing={false} />
      <div className="min-w-0 flex-1 text-[11px]">
        <p className="flex items-center gap-1.5 font-semibold">
          <span className="truncate">{p.name ?? p.agent_id}</span>
          {r && (
            <span className={cn('inline-flex items-center gap-0.5 font-mono', up ? 'text-emerald-300' : 'text-red-300')}>
              {up ? <ArrowUp size={12} weight="bold" /> : <ArrowDown size={12} weight="bold" />}{up ? 'UP' : 'DOWN'} <span className="text-muted-foreground">c{r.confidence}</span>
            </span>
          )}
          {r?.fallback && <span className="rounded border border-border/60 px-1 text-[9px] uppercase tracking-wider text-muted-foreground">fallback · not counted</span>}
          <span className={cn('ml-auto font-mono font-bold', void_ ? 'text-muted-foreground' : (r?.points ?? 0) > 0 ? 'text-emerald-300' : (r?.points ?? 0) < 0 ? 'text-red-300' : 'text-muted-foreground')}>
            {revealed ? (void_ ? 'void' : fmtPoints(r?.points)) : <span className="inline-flex items-center gap-1 font-normal"><LockKey size={11} /> sealed</span>}
          </span>
        </p>
        {r ? (
          <>
            <p className="text-muted-foreground leading-snug">{r.reasoning || '—'}</p>
            {r.cited.length > 0 && <p className="text-muted-foreground/70 truncate">from: {r.cited.join(' · ')}</p>}
            <p className="font-mono text-[10px] text-muted-foreground/60 truncate">commit {p.commit.slice(0, 16)}… · salt {r.salt}</p>
          </>
        ) : (
          <p className="font-mono text-[10px] text-muted-foreground/60 truncate">commit {p.commit}</p>
        )}
      </div>
    </div>
  )
}

function Standings({ board, loaded, seasonId }: { board: LeagueStanding[]; loaded: boolean; seasonId: string }) {
  return (
    <Card className="glass-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Crown size={14} className="text-amber-300" /> Standings</p>
        <span className="text-[10px] font-mono text-muted-foreground">{seasonLabel(seasonId)}</span>
      </div>
      {board.length === 0 ? (
        <p className="text-sm text-muted-foreground">{loaded ? 'No rated agent this week yet — the first settled window starts the table.' : 'Loading…'}</p>
      ) : (
        <ol className="space-y-1.5">
          {board.map((r, i) => (
            <li key={r.agent_id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 bg-white/[0.02]">
              <span className={cn('w-5 text-xs font-mono text-right', i === 0 ? 'text-amber-300' : i < 3 ? 'text-primary' : 'text-muted-foreground')}>{i + 1}</span>
              <NicheAvatar agent={asAvatar(r)} size="sm" showRing={false} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold truncate">{r.name}</p>
                <p className="text-[10px] text-muted-foreground font-mono truncate">{r.wins}W {r.losses}L · {fmtAccuracy(r.accuracy)} · {fmtPoints(r.points)} pts · {shortAddr(r.owner)}</p>
              </div>
              {r.streak >= 2 && <span className="inline-flex items-center text-[10px] text-orange-300"><Fire size={12} weight="fill" />{r.streak}</span>}
              <span className="text-sm font-bold font-mono">{r.rating}</span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

function MyRecord({ agents }: { agents: Agent[] }) {
  const mine = useMemo(() => agents.filter(a => a.id).slice(0, 6), [agents])
  const [records, setRecords] = useState<Record<string, LeagueRecord>>({})
  useEffect(() => {
    let cancelled = false
    Promise.all(mine.map(a => leagueService.record(a.id).then(r => [a.id, r] as const).catch(() => null)))
      .then(rows => { if (!cancelled) setRecords(Object.fromEntries(rows.filter((x): x is readonly [string, LeagueRecord] => !!x))) })
    return () => { cancelled = true }
  }, [mine])
  if (mine.length === 0) return null
  return (
    <Card className="glass-card p-5 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">My agents · career</p>
      <div className="space-y-1.5">
        {mine.map(a => {
          const r = records[a.id]
          return (
            <div key={a.id} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 bg-white/[0.02]">
              <NicheAvatar agent={a} size="sm" showRing={false} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold truncate">{a.name}</p>
                <p className="text-[10px] text-muted-foreground font-mono truncate">
                  {r ? (r.matches ? `${r.wins}W ${r.losses}L · ${fmtAccuracy(r.accuracy)} · ${fmtPoints(r.points)} pts · ${formLine(r.last)}` : 'no settled call yet') : '…'}
                </p>
              </div>
              {r && r.streak >= 2 && <span className="inline-flex items-center text-[10px] text-orange-300"><Fire size={12} weight="fill" />{r.streak}</span>}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function EnterPanel({ agents, walletAddress, walletConnected, onConnectWallet, config, upcoming, now, onSealed }: {
  agents: Agent[]; walletAddress?: string; walletConnected: boolean; onConnectWallet: () => void
  config: LeagueConfig; upcoming: LeagueWindow[]; now: number; onSealed: (windowId: string) => void
}) {
  const mine = useMemo(() => agents.filter(a => a.id && !a.needsFunding), [agents])
  const [agentId, setAgentId] = useState('')
  const [target, setTarget] = useState<'official' | 'private'>('official')
  const [windowId, setWindowId] = useState('')
  const [opponentId, setOpponentId] = useState('')
  const [busy, setBusy] = useState(false)
  const [left, setLeft] = useState<number | null>(null)

  const joinable = upcoming.filter(w => windowPhase(w, now) === 'open' && w.participants.length < config.max_participants)
  const chosen = joinable.find(w => w.window_id === windowId) ?? joinable[0]
  const taken = chosen?.participants.includes(agentId)

  if (!walletConnected || !walletAddress) {
    return (
      <Card className="glass-card p-5 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Enter the league</p>
        <p className="text-sm text-muted-foreground">Connect a wallet to send one of your agents in. Watching is open to everyone.</p>
        <Button className="w-full" onClick={onConnectWallet}><Wallet size={16} className="mr-1.5" /> Connect wallet</Button>
      </Card>
    )
  }

  const submit = async () => {
    if (!agentId) return
    setBusy(true)
    try {
      const ch = await leagueService.requestChallenge(
        target === 'official' ? { owner: walletAddress, agentId, windowId: chosen?.window_id } : { owner: walletAddress, agentId, opponentId },
      )
      toast.info('Sign in your wallet to seal the pick', { description: 'Signing costs no gas and cannot move funds.' })
      const signed = await mantleService.signMessage(ch.message)
      const r = await leagueService.submitPick(ch.nonce, signed.signature)
      setLeft(r.picks_left_today)
      toast.success('Pick sealed', { description: `Commit ${r.commit.slice(0, 12)}… · revealed when the window settles. ${r.picks_left_today} pick${r.picks_left_today === 1 ? '' : 's'} left today.` })
      onSealed(r.window_id)
    } catch (e) {
      toast.error('Could not seal the pick', { description: errorText(e).slice(0, 180) })
    } finally {
      setBusy(false)
    }
  }

  const ready = !!agentId && (target === 'official' ? !!chosen && !taken : !!opponentId && opponentId !== agentId)

  return (
    <Card className="glass-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Enter the league</p>
        {left !== null && <span className="text-[10px] font-mono text-muted-foreground">{left}/{config.picks_per_day} picks left today</span>}
      </div>

      {mine.length === 0 ? (
        <p className="text-sm text-muted-foreground">You need an active agent to play. Spawn one and let it study a few videos first.</p>
      ) : (
        <>
          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">1 · Your agent</p>
            <div className="grid gap-1.5">
              {mine.map(m => (
                <button key={m.id} type="button" onClick={() => { setAgentId(m.id); if (opponentId === m.id) setOpponentId('') }} aria-pressed={agentId === m.id}
                  className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-all', agentId === m.id ? 'border-primary/60 bg-primary/10' : 'border-border/50 hover:border-primary/30')}>
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
            <p className="text-[11px] text-muted-foreground">2 · Where</p>
            <div className="grid grid-cols-2 gap-1.5">
              {(['official', 'private'] as const).map(t => (
                <button key={t} type="button" onClick={() => setTarget(t)} aria-pressed={target === t}
                  className={cn('rounded-lg border px-2.5 py-2 text-left transition-all', target === t ? 'border-primary/60 bg-primary/10' : 'border-border/50 hover:border-primary/30')}>
                  <p className="text-xs font-semibold">{t === 'official' ? 'Official window' : 'Private window'}</p>
                  <p className="text-[10px] text-muted-foreground leading-snug">{t === 'official' ? 'Counts for the season table.' : 'Two of your own agents, next slot. Career record only.'}</p>
                </button>
              ))}
            </div>
          </div>

          {target === 'official' ? (
            <div className="space-y-1.5">
              <p className="text-[11px] text-muted-foreground">3 · Window</p>
              {joinable.length === 0 ? (
                <p className="text-xs text-muted-foreground">No window is taking picks right now — the next one appears a few minutes before the half hour.</p>
              ) : (
                <div className="grid gap-1.5">
                  {joinable.map(w => (
                    <button key={w.window_id} type="button" onClick={() => setWindowId(w.window_id)} aria-pressed={chosen?.window_id === w.window_id}
                      className={cn('flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition-all', chosen?.window_id === w.window_id ? 'border-secondary/60 bg-secondary/10' : 'border-border/50 hover:border-secondary/30')}>
                      <span className="text-xs font-semibold">{w.symbol} · {fmtWindowSpan(w.open_ts, w.resolve_ts)}</span>
                      <span className="text-[10px] font-mono text-muted-foreground">closes in {fmtCountdown(w.open_ts - now)} · {w.participants.length}/{config.max_participants}</span>
                    </button>
                  ))}
                </div>
              )}
              {taken && <p className="text-[11px] text-amber-300">This agent already has a call in that window.</p>}
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-[11px] text-muted-foreground">3 · Opponent (one of yours)</p>
              {mine.length < 2 ? (
                <p className="text-xs text-muted-foreground">A private window needs two of your agents.</p>
              ) : (
                <div className="grid gap-1.5">
                  {mine.filter(m => m.id !== agentId).map(m => (
                    <button key={m.id} type="button" onClick={() => setOpponentId(m.id)} aria-pressed={opponentId === m.id} disabled={!agentId}
                      className={cn('flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-all disabled:opacity-50', opponentId === m.id ? 'border-secondary/60 bg-secondary/10' : 'border-border/50 hover:border-secondary/30')}>
                      <NicheAvatar agent={m} size="sm" />
                      <p className="text-xs font-semibold truncate">{m.name}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Lightning size={12} weight="fill" className="text-amber-400" />
            {target === 'private' ? '2 AI calls (one per agent)' : '1 AI call'}, made now from the agent's lessons and the live market. The call is sealed until the window settles. No trades, no gas.
          </p>

          <Button className="w-full" disabled={!ready || busy} onClick={submit}>
            <ShieldCheck size={16} className="mr-1.5" />{busy ? 'Reading the market…' : 'Sign & seal the pick'}
          </Button>
        </>
      )}
    </Card>
  )
}
