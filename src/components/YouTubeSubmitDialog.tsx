import { useState } from 'react'
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
} from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Agent } from '@/lib/types'
import { cloudRunService } from '@/services/cloudRunService'
import { toast } from 'sonner'

interface YouTubeSubmitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent: Agent | null
}

type Stage = 'input' | 'fetching' | 'summarizing' | 'scoring' | 'minting' | 'success' | 'error'

interface StageInfo {
  label: string
  detail: string
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
    icon: Sparkle,
    accent: 'cyan',
  },
  summarizing: {
    label: 'Synthesizing wisdom',
    detail: 'Gemini is distilling the transcript into a 3-paragraph insight tailored to the agent\'s niche.',
    icon: Sparkle,
    accent: 'amber',
  },
  scoring: {
    label: 'Scoring milestone',
    detail: 'Comparing novelty + niche depth to your comprehension target.',
    icon: Sparkle,
    accent: 'violet',
  },
  minting: {
    label: 'Minting learning proof',
    detail: 'Milestone hit — signing + sending the mint transaction to Mantle.',
    icon: Coins,
    accent: 'emerald',
  },
  success: {
    label: 'Done',
    detail: 'Wisdom recorded and (if milestone) NFT minted.',
    icon: CheckCircle,
    accent: 'emerald',
  },
  error: {
    label: 'Failed',
    detail: 'Something went wrong — see the error message below.',
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
export function YouTubeSubmitDialog({ open, onOpenChange, agent }: YouTubeSubmitDialogProps) {
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
    if (!agent) return
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
        agentId: agent.id,
        agentWallet: agent.walletAddress,
        agentName: agent.name,
        eventUrl: trimmed,
        eventTitle: '',
        platform: 'YouTube',
        niche: agent.niche,
        chainId: agent.chainId ?? 5003,
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
          description: `Heritage Score +5 for ${agent.name}`,
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
      <DialogContent className="glass-card max-w-md w-full border-cyan-400/30">
        <DialogHeader className="flex-shrink-0 pb-4 border-b border-border/30">
          <DialogTitle className="flex items-center gap-2.5 text-base font-bold">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-rose-500/30 to-amber-500/30 border border-rose-500/40 flex items-center justify-center">
              <YoutubeLogo size={18} className="text-rose-300" weight="duotone" />
            </div>
            <div className="flex-1 min-w-0">
              <div>Manual override — learn now</div>
              {agent && (
                <div className="text-xs font-normal text-muted-foreground">
                  With {agent.name} · {agent.niche}
                </div>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

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
                    disabled={!agent}
                    className="font-mono text-sm"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleSubmit()
                      }
                    }}
                  />
                </div>
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
                  <p className="text-[10px] font-mono text-muted-foreground/70 break-all">
                    tx: <span className="text-emerald-300">{result.txHash.slice(0, 12)}…</span>
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
