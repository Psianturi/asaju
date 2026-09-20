import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  YoutubeLogo,
  Sparkle,
  CheckCircle,
  WarningCircle,
  ArrowRight,
  SpinnerGap,
  Coins,
  Lightning,
  CaretDown,
  Clock,
  ArrowSquareOut,
  Robot,
} from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Agent } from '@/lib/types'
import { cloudRunService } from '@/services/cloudRunService'
import { toast } from 'sonner'
import { fmtAgeSeconds, isFiniteNum } from '@/lib/format'

interface YouTubeSubmitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent: Agent | null
  /** All agents owned by the current wallet — used for the in-dialog agent
   *  switcher so the user can route a single YouTube URL to any of their agents
   *  rather than being hardcoded to whichever agent was last passed in. */
  agents?: Agent[]
}

type Stage = 'input' | 'fetching' | 'summarizing' | 'scoring' | 'minting' | 'success' | 'error'

interface StageInfo {
  label: string
  detail: string
  progress?: string[]
  icon: typeof YoutubeLogo
  accent: 'cyan' | 'amber' | 'emerald' | 'violet' | 'rose'
}

const STAGES: Record<Stage, StageInfo> = {
  input: {
    label: 'Submit a YouTube URL',
    detail: 'Agent will fetch the transcript and decide whether it counts as a learning milestone.',
    icon: YoutubeLogo,
    accent: 'cyan',
  },
  fetching: {
    label: 'Fetching transcript',
    detail: 'Reading captions + metadata from the video.',
    progress: ['Connecting to YouTube…', 'Pulling caption tracks…', 'Reading video metadata…'],
    icon: Sparkle,
    accent: 'cyan',
  },
  summarizing: {
    label: 'Synthesizing wisdom',
    detail: 'Gemini is distilling the transcript into a 3-paragraph insight tailored to the agent\'s niche.',
    progress: ['Feeding neural network…', 'Cross-referencing niche knowledge…', 'Distilling into wisdom…'],
    icon: Sparkle,
    accent: 'amber',
  },
  scoring: {
    label: 'Scoring milestone',
    detail: 'Comparing novelty + niche depth to your comprehension target.',
    progress: ['Measuring novelty against past learnings…', 'Computing comprehension delta…'],
    icon: Sparkle,
    accent: 'violet',
  },
  minting: {
    label: 'Minting learning proof',
    detail: 'Milestone hit — signing + sending the mint transaction to Mantle.',
    progress: ['Preparing mint transaction…', 'Signing with agent wallet…', 'Broadcasting to Mantle Sepolia…'],
    icon: Coins,
    accent: 'emerald',
  },
  success: {
    label: 'Done',
    detail: 'Wisdom recorded and (if milestone) NFT minted.',
    progress: [],
    icon: CheckCircle,
    accent: 'emerald',
  },
  error: {
    label: 'Failed',
    detail: 'Something went wrong — see the error message below.',
    progress: [],
    icon: WarningCircle,
    accent: 'rose',
  },
}

const ACCENT_CLASSES: Record<StageInfo['accent'], string> = {
  cyan: 'border-cyan-400/30 bg-cyan-400/[0.08] text-cyan-300',
  amber: 'border-amber-400/30 bg-amber-400/[0.08] text-amber-300',
  emerald: 'border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-300',
  violet: 'border-violet-400/30 bg-violet-400/[0.08] text-violet-300',
  rose: 'border-rose-400/30 bg-rose-400/[0.08] text-rose-300',
}

/**
 * YouTubeSubmitDialog — the missing bridge between "user clicks button" and
 * "agent actually learns something". Before this existed, clicking
 * "Analyze YouTube URL" silently navigated to the agent detail page — a
 * dead end that made the feature look broken. This dialog turns the click
 * into a visible, multi-stage pipeline so the user sees progress in real time:
 *
 *   input → fetching transcript → summarizing → scoring → minting → success
 *
 * Each stage maps to a real backend step. If the milestone threshold isn't
 * met, the dialog shows "Done" without minting (and the wisdom summary is
 * still recorded on-chain as a non-NFT event).
 */
export function YouTubeSubmitDialog({ open, onOpenChange, agent, agents = [] }: YouTubeSubmitDialogProps) {
  // Active agent for *this* submit. The `agent` prop is the suggestion from the
  // caller (first agent), but the user can switch in-dialog if `agents` has
  // more than one. The dialog owns this state so it survives re-renders.
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(agent?.id ?? null)
  useEffect(() => {
    if (agent?.id && !selectedAgentId) setSelectedAgentId(agent.id)
  }, [agent?.id, selectedAgentId])
  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? agent

  const [url, setUrl] = useState('')
  const [stage, setStage] = useState<Stage>('input')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [result, setResult] = useState<{
    minted: boolean
    txHash: string | null
    tokenId: string | null
    wisdomSummary: string
  } | null>(null)

  const reset = () => {
    setUrl('')
    setStage('input')
    setErrorMsg(null)
    setResult(null)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const handleSubmit = async () => {
    if (!selectedAgent) return
    const trimmed = url.trim()
    if (!trimmed) {
      toast.error('YouTube URL required')
      return
    }
    if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(trimmed)) {
      toast.error('URL must be a youtube.com or youtu.be link')
      return
    }
    setErrorMsg(null)
    setResult(null)

    // Stage 1 — fetching
    setStage('fetching')
    await new Promise((r) => setTimeout(r, 400))

    // Stage 2 — summarizing
    setStage('summarizing')

    // Stage 3 — scoring + minting happen inside the same request; we
    // present the scoring step explicitly as an animation beat so the
    // user sees what's happening, then jump straight to minting.
    setStage('scoring')
    await new Promise((r) => setTimeout(r, 350))

    try {
      setStage('minting')
      const resp = await cloudRunService.attendEvent({
        agentId: selectedAgent.id,
        agentWallet: selectedAgent.walletAddress,
        agentName: selectedAgent.name,
        eventUrl: trimmed,
        eventTitle: '',
        platform: 'YouTube',
        niche: selectedAgent.niche,
        chainId: selectedAgent.chainId ?? 5003,
      })

      setResult({
        minted: resp.minted,
        txHash: resp.txHash ?? null,
        tokenId: resp.tokenId ?? null,
        wisdomSummary: resp.wisdomSummary ?? '',
      })
      setStage('success')

      if (resp.minted) {
        toast.success('Milestone minted on Mantle', {
          description: `Heritage Score +5 for ${selectedAgent.name}`,
        })
      } else {
        toast.info('Wisdom recorded (no mint yet)', {
          description: 'This video did not cross the milestone threshold — try another video.',
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setErrorMsg(msg)
      setStage('error')
      toast.error('Analyze failed', { description: msg })
    }
  }

  const stageInfo = STAGES[stage]
  const StageIcon = stageInfo.icon
  const isRunning = ['fetching', 'summarizing', 'scoring', 'minting'].includes(stage)
  const canRetry = stage === 'error'

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="glass-card max-w-lg w-full border-cyan-400/30">
        <DialogHeader className="flex-shrink-0 pb-4 border-b border-border/30">
          <DialogTitle className="flex items-center gap-2.5 text-base font-bold">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-rose-500/30 to-amber-500/30 border border-rose-500/40 flex items-center justify-center">
              <YoutubeLogo size={18} className="text-rose-300" weight="duotone" />
            </div>
            <div className="flex-1 min-w-0">
              <div>Manual override — learn now</div>
              <div className="text-xs font-normal text-muted-foreground mt-0.5">
                One video · one agent · one on-chain milestone
              </div>
            </div>
          </DialogTitle>
        </DialogHeader>

        {/* Agent switcher — visible when the owner has more than one agent.
            Replaces the previously hardcoded "With Naruto" subtitle. */}
        {agents.length > 1 && stage === 'input' && (
          <div className="mt-3 -mx-1 flex items-center gap-1 overflow-x-auto pb-1">
            {agents.map((a) => {
              const isActive = a.id === selectedAgentId
              const isAutoScout = a.autoScoutEnabled === true
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setSelectedAgentId(a.id)}
                  className={cn(
                    'shrink-0 px-2.5 py-1 rounded-md border text-[11px] font-semibold transition-colors',
                    isActive
                      ? 'border-cyan-400/50 bg-cyan-400/15 text-cyan-200'
                      : 'border-white/10 bg-white/[0.02] text-muted-foreground hover:border-white/20 hover:text-foreground'
                  )}
                >
                  <span>{a.name}</span>
                  <span className="ml-1.5 text-[9px] font-mono opacity-70">
                    Lv {a.level ?? 1}
                  </span>
                  {isAutoScout && (
                    <span className="ml-1 inline-flex w-1 h-1 rounded-full bg-emerald-400" title="Auto-Scout active" />
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Selected agent context strip — surfaces what Auto-Scout is doing
            with this agent so the user understands the relationship between
            this manual override and the background scheduler. */}
        {selectedAgent && stage === 'input' && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-muted-foreground/80">
            <span className="flex items-center gap-1">
              <Robot size={10} weight="duotone" className="text-cyan-300" />
              {selectedAgent.name} · {selectedAgent.niche} · Lv {selectedAgent.level ?? 1}
            </span>
            <span className="flex items-center gap-1">
              {selectedAgent.autoScoutEnabled ? (
                <>
                  <span className="inline-flex w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-emerald-300">Auto-Scout active</span>
                  {isFiniteNum(selectedAgent.lastScoutAt) && (
                    <span>· last run {fmtAgeSeconds((Date.now() / 1000) - ((selectedAgent.lastScoutAt as number) / 1000))}</span>
                  )}
                </>
              ) : (
                <span
                  className="text-muted-foreground/70"
                  title="Auto-Scout can be enabled on the agent detail page. While off, this manual override is the only way the agent learns."
                >
                  Auto-Scout off
                </span>
              )}
            </span>
            {isFiniteNum(selectedAgent.comprehensionScore) && (
              <span className="flex items-center gap-1">
                <Lightning size={10} className="text-amber-300" />
                <span>comprehension {selectedAgent.comprehensionScore}/100</span>
              </span>
            )}
          </div>
        )}

        <div className="py-4 space-y-4">
          {/* Stage indicator */}
          <div className={`rounded-lg border p-3 ${ACCENT_CLASSES[stageInfo.accent]} transition-colors`}>
            <div className="flex items-center gap-2.5">
              <div className="relative shrink-0">
                {isRunning ? (
                  <SpinnerGap size={18} className="animate-spin" />
                ) : (
                  <StageIcon size={18} weight="duotone" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">{stageInfo.label}</p>
                <p className="text-[11px] leading-relaxed opacity-90">{stageInfo.detail}</p>
                {/* Rotating subtext — animates through the stage's progress messages
                    so the user sees something changing rather than a static line. */}
                {(stageInfo.progress ?? []).length > 0 && (
                  <ProgressRotator messages={stageInfo.progress ?? []} active={isRunning} />
                )}
              </div>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {stage === 'input' && (
              <motion.div
                key="input"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="space-y-3"
              >
                <div>
                  <label className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1 block">
                    YouTube URL
                  </label>
                  <Input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                    disabled={!agent || isRunning}
                    className="font-mono text-sm disabled:opacity-60"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isRunning) {
                        e.preventDefault()
                        handleSubmit()
                      }
                    }}
                  />
                </div>

                {/* How this works — a plain-English block explaining what the
                    agent actually does with the URL. New users often think
                    this just "opens the video" or "saves it" — make clear that
                    the transcript is read, distilled by Gemini, scored, and
                    only minted on-chain if the milestone threshold is met. */}
                <details className="group rounded-md border border-border/30 bg-background/30 open:bg-background/50 transition-colors">
                  <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground px-2.5 py-1.5 list-none flex items-center justify-between gap-1 select-none">
                    <span className="flex items-center gap-1.5">
                      <Lightning size={11} weight="duotone" className="text-amber-300" />
                      What happens when I click Analyze now?
                    </span>
                    <CaretDown size={11} weight="bold" className="transition-transform group-open:rotate-180 opacity-60" />
                  </summary>
                  <div className="px-2.5 pb-2.5 pt-1 space-y-1.5 text-[11px] text-gray-300 leading-relaxed">
                    <p>
                      <span className="text-cyan-300 font-semibold">1. Read the video.</span>{' '}
                      The agent pulls the YouTube transcript + title — no API key needed.
                    </p>
                    <p>
                      <span className="text-amber-300 font-semibold">2. Distill the lesson.</span>{' '}
                      Gemini summarises the video into a 3-paragraph insight tailored to the agent's niche.
                    </p>
                    <p>
                      <span className="text-violet-300 font-semibold">3. Score novelty.</span>{' '}
                      Compare against past learnings. If the lesson is novel AND niche-relevant, the comprehension score climbs.
                    </p>
                    <p>
                      <span className="text-emerald-300 font-semibold">4. Mint on Mantle.</span>{' '}
                      Cross a milestone (every 20 comprehension points) and a learning NFT is minted on-chain — your agent signs, gas paid by the agent's own balance.
                    </p>
                    <p className="text-muted-foreground/70 italic text-[10px] pt-1">
                      No mint? Wisdom is still recorded — the agent learns, just doesn't lock a new NFT.
                    </p>
                  </div>
                </details>

                <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                  Markets move fast. Manually wake your agent to analyze the current video immediately — no need to wait for the next Auto-Scout cycle.
                </p>
                <div className="flex gap-2 pt-1">
                  <Button
                    onClick={handleSubmit}
                    disabled={!agent || !url.trim()}
                    className="flex-1 bg-gradient-to-r from-cyan-500 to-emerald-500 hover:opacity-95 text-white font-bold shadow-lg shadow-cyan-500/20 disabled:opacity-50"
                  >
                    <Sparkle size={14} weight="fill" className="mr-1.5" />
                    Analyze now
                    <ArrowRight size={14} weight="bold" className="ml-1.5" />
                  </Button>
                </div>
              </motion.div>
            )}

            {stage === 'error' && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="space-y-3"
              >
                <p className="text-xs text-rose-300 leading-relaxed bg-rose-400/[0.08] border border-rose-400/20 rounded-md p-2">
                  {errorMsg ?? 'Something went wrong.'}
                </p>
                <div className="flex gap-2">
                  <Button
                    onClick={reset}
                    variant="outline"
                    className="flex-1"
                  >
                    Try again
                  </Button>
                </div>
              </motion.div>
            )}

            {stage === 'success' && result && (
              <motion.div
                key="success"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="space-y-3"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      result.minted
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                        : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                    }
                  >
                    {result.minted ? 'Milestone minted' : 'Wisdom recorded (no mint)'}
                  </Badge>
                  {result.tokenId && (
                    <span className="text-[10px] font-mono text-muted-foreground/70">
                      Token #{result.tokenId}
                    </span>
                  )}
                </div>
                {result.txHash && (
                  <a
                    href={`https://explorer.sepolia.mantle.xyz/tx/${result.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/80 hover:text-emerald-300 transition-colors break-all"
                  >
                    <span>
                      tx: <span className="text-emerald-300 underline-offset-2">{result.txHash.slice(0, 14)}…</span>
                    </span>
                    <ArrowSquareOut size={11} weight="bold" className="shrink-0" />
                  </a>
                )}
                {result.tokenId && (
                  <a
                    href={`https://explorer.sepolia.mantle.xyz/token/0x66fD8b5411856D42c08D9356e879a6e7dF0c9419?type=nft&tokenId=${result.tokenId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] font-mono text-muted-foreground/60 hover:text-cyan-300 transition-colors"
                  >
                    View NFT on MantleScan →
                  </a>
                )}
                {!result.minted && (
                  <p className="text-[10px] text-amber-200/80 leading-relaxed bg-amber-400/[0.06] border border-amber-400/15 rounded-md px-2 py-1.5">
                    <span className="font-semibold">No milestone this time.</span>{' '}
                    Wisdom was recorded on-chain but no NFT was minted — the agent's
                    comprehension score did not cross a milestone threshold. Try a more
                    novel or niche-specific video to trigger the next mint.
                  </p>
                )}
                {result.wisdomSummary && (
                  <div className="rounded-md border border-border/30 bg-background/40 p-2.5">
                    <p className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-1">
                      Wisdom summary
                    </p>
                    <p className="text-xs text-gray-200 leading-relaxed line-clamp-4">
                      {result.wisdomSummary}
                    </p>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button onClick={reset} variant="outline" className="flex-1">
                    Submit another
                  </Button>
                  <Button onClick={() => handleOpenChange(false)} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white">
                    Done
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * ProgressRotator — cycles through messages while `active` is true so the
 * dialog feels alive during the (potentially long) backend pipeline run.
 * Pauses when `active` flips false (success / error / reset).
 */
function ProgressRotator({ messages, active }: { messages: string[]; active: boolean }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => {
      setI((prev) => (prev + 1) % Math.max(messages.length, 1))
    }, 1400)
    return () => clearInterval(t)
  }, [active, messages.length])
  if (messages.length === 0) return null
  const current = messages[Math.min(i, messages.length - 1)]
  return (
    <p key={current} className="text-[10px] font-mono mt-1 opacity-80 tabular-nums transition-opacity duration-200">
      ▸ {current}
    </p>
  )
}
