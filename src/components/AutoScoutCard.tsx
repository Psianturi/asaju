import { useCallback, useEffect, useState } from 'react'
import { Robot, ShieldCheck, Play, Prohibit, Warning } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Agent } from '@/lib/types'
import { DEFAULT_CHAIN_ID } from '@/lib/blockchain/chains'
import { mantleService } from '@/lib/blockchain/mantleService'
import { mandateService, type MandateStatus } from '@/services/cloudRunService'
import { DEFAULT_MANDATE_RUNS, MANDATE_RUN_OPTIONS, describeMandate, describeScoutRun } from '@/lib/mandate'

/**
 * Auto-Scout with its mandate: one owner signature lets the scheduler learn
 * for this agent (attend_event only — never trading or transfers), within a
 * daily budget, for up to seven days. Without a mandate the scheduler skips
 * the agent, so turning Auto-Scout on here always goes through granting one.
 */
export function AutoScoutCard({ agent, onToggleScout }: {
  agent: Agent
  onToggleScout: (agentId: string, enabled: boolean) => void
}) {
  const chainId = agent.chainId ?? DEFAULT_CHAIN_ID
  const [status, setStatus] = useState<MandateStatus | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [runs, setRuns] = useState<number>(DEFAULT_MANDATE_RUNS)
  const [busy, setBusy] = useState<null | 'grant' | 'revoke' | 'run'>(null)
  const [lastRun, setLastRun] = useState<ReturnType<typeof describeScoutRun> | null>(null)

  const load = useCallback(async () => {
    try {
      setStatus(await mandateService.status(agent.id, chainId))
      setLoadError(false)
    } catch {
      setLoadError(true)
    }
  }, [agent.id, chainId])

  useEffect(() => { void load() }, [load])

  const fail = (title: string, err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    if (/user (rejected|denied)|ACTION_REJECTED/i.test(msg)) toast.info('Signature cancelled')
    else toast.error(title, { description: msg })
  }

  const grant = async () => {
    setBusy('grant')
    try {
      const ch = await mandateService.request(agent.id, agent.walletAddress, chainId, runs)
      const { signature } = await mantleService.signMessage(ch.message)
      await mandateService.confirm(ch.nonce, signature)
      if (!agent.autoScoutEnabled) onToggleScout(agent.id, true)
      toast.success('Auto-Scout is on', { description: `Up to ${runs} learning run${runs === 1 ? '' : 's'} a day, for 7 days.` })
      await load()
    } catch (err) {
      fail('Could not turn on Auto-Scout', err)
    } finally {
      setBusy(null)
    }
  }

  const revoke = async () => {
    setBusy('revoke')
    try {
      const ch = await mandateService.requestRevoke(agent.id, chainId)
      const { signature } = await mantleService.signMessage(ch.message)
      await mandateService.confirmRevoke(ch.nonce, signature)
      if (agent.autoScoutEnabled) onToggleScout(agent.id, false)
      toast.success('Auto-Scout stopped', { description: 'The mandate is revoked. Nothing runs in the background now.' })
      await load()
    } catch (err) {
      fail('Could not stop Auto-Scout', err)
    } finally {
      setBusy(null)
    }
  }

  const runNow = async () => {
    setBusy('run')
    setLastRun(null)
    try {
      const outcome = describeScoutRun(await mandateService.runNow(agent.id))
      setLastRun(outcome)
      await load()
    } catch (err) {
      fail('Scout run failed', err)
    } finally {
      setBusy(null)
    }
  }

  const mandate = status?.active ? status.mandate : null
  const info = mandate ? describeMandate(mandate) : null
  const running = !!mandate && !!agent.autoScoutEnabled

  return (
    <Card className="glass-card-hover p-4 border border-border/30 space-y-3">
      <div className="flex items-start gap-3">
        <Robot size={18} weight="fill" className={cn('mt-0.5', running ? 'text-emerald-500' : 'text-muted-foreground')} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold">Auto-Scout</p>
            <span className={cn('text-[10px] font-mono uppercase tracking-wider rounded-full border px-2 py-0.5',
              running ? 'border-emerald-500/40 text-emerald-300' : mandate ? 'border-amber-400/40 text-amber-300' : 'border-border/60 text-muted-foreground')}>
              {running ? 'running on its own' : mandate ? 'mandate active · off' : 'off'}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            {mandate
              ? `${info!.runs} · ${info!.expires}. It searches YouTube in its niche, learns from the best match, and mints only at level-ups.`
              : 'Let the agent find and learn from YouTube videos on its own. One signature allows learning only — never trading or moving funds — for up to 7 days.'}
          </p>
        </div>
      </div>

      {agent.needsFunding && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-300">
          <Warning size={13} className="mt-0.5 shrink-0" />
          Fund the agent’s wallet first: scheduled runs only pick up funded agents.
        </p>
      )}
      {!mandate && status && agent.autoScoutEnabled && (
        <p className="text-[11px] text-amber-300">It was switched on before, but without a mandate nothing runs. Sign once to start it.</p>
      )}
      {loadError && <p className="text-[11px] text-amber-300">Could not read the mandate status. Check your connection and reload.</p>}

      {!mandate ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-border/50 p-0.5" role="group" aria-label="Learning runs per day">
            {MANDATE_RUN_OPTIONS.map(n => (
              <button key={n} type="button" onClick={() => setRuns(n)} aria-pressed={runs === n}
                className={cn('text-[11px] px-2.5 py-1 rounded-md', runs === n ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}>
                {n}/day
              </button>
            ))}
          </div>
          <Button size="sm" onClick={grant} disabled={busy !== null || !status && !loadError}>
            <ShieldCheck size={14} className="mr-1.5" />{busy === 'grant' ? 'Waiting for signature…' : 'Sign & turn on'}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {!agent.autoScoutEnabled && (
            <Button size="sm" onClick={() => onToggleScout(agent.id, true)} disabled={busy !== null}>Turn on</Button>
          )}
          <Button size="sm" variant="outline" onClick={runNow} disabled={busy !== null || info!.spent}
            title={info!.spent ? 'Today’s runs are used up' : 'Runs one cycle now under the mandate, without another signature'}>
            <Play size={14} className="mr-1.5" />{busy === 'run' ? 'Scouting…' : 'Run a scout now'}
          </Button>
          <Button size="sm" variant="ghost" onClick={revoke} disabled={busy !== null} className="text-muted-foreground hover:text-red-300">
            <Prohibit size={14} className="mr-1.5" />{busy === 'revoke' ? 'Waiting for signature…' : 'Stop & revoke'}
          </Button>
        </div>
      )}

      {lastRun && (
        <p role="status" className={cn('text-[11px]', lastRun.tone === 'success' ? 'text-emerald-300' : lastRun.tone === 'warning' ? 'text-amber-300' : 'text-muted-foreground')}>
          {lastRun.text}
        </p>
      )}
    </Card>
  )
}
