import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain,
  X,
  Copy,
  CheckCircle,
  ChartLineUp,
  Database,
  Newspaper,
  Rocket,
  Gift,
  Coins,
} from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { BackendProposal } from '@/lib/types'
import { fmtAgeSeconds, isFiniteNum } from '@/lib/format'

interface ReasoningSlideOverProps {
  proposal: BackendProposal | null
  open: boolean
  onClose: () => void
}

const SIGNAL_LABELS: Record<string, { label: string; icon: typeof Coins; color: string }> = {
  market_snapshot: { label: 'Market snapshot (price + sentiment)', icon: Coins, color: 'cyan' },
  top_gainers: { label: 'Top gainers (24h)', icon: ChartLineUp, color: 'emerald' },
  top_losers: { label: 'Top losers (24h)', icon: ChartLineUp, color: 'rose' },
  new_listings: { label: 'New listings', icon: Rocket, color: 'violet' },
  active_airdrops: { label: 'Active airdrops', icon: Gift, color: 'amber' },
  global_metrics: { label: 'Global metrics (mcap + dominance)', icon: Database, color: 'cyan' },
}

const SIGNAL_COLOR_CLASSES: Record<string, string> = {
  cyan: 'bg-cyan-400/15 text-cyan-300 border-cyan-400/30',
  emerald: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/30',
  rose: 'bg-rose-400/15 text-rose-300 border-rose-400/30',
  violet: 'bg-violet-400/15 text-violet-300 border-violet-400/30',
  amber: 'bg-amber-400/15 text-amber-300 border-amber-400/30',
}

export function ReasoningSlideOver({ proposal, open, onClose }: ReasoningSlideOverProps) {
  const [copied, setCopied] = useState(false)
  const reasoning = proposal?.reasoning
  const context = reasoning?.context_summary
  const prompt = proposal?.reasoning_prompt ?? ''
  const rawResponse = reasoning?.raw_response ?? ''

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked — ignore silently */
    }
  }

  const signalsPresent = context?.cmc_signals_present ?? []

  return (
    <AnimatePresence>
      {open && proposal && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />
          {/* Panel */}
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 240 }}
            className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-slate-950/95 border-l border-border/40 shadow-2xl overflow-y-auto"
            role="dialog"
            aria-label="View AI Reasoning"
          >
            <div className="p-5 space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between gap-3 sticky top-0 bg-slate-950/95 backdrop-blur-sm -mx-5 px-5 py-3 border-b border-border/30">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
                    <Brain size={18} className="text-primary" weight="duotone" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold">View AI Reasoning</h2>
                    <p className="text-[11px] text-muted-foreground">
                      What data the agent saw · what it told Gemini · what it returned
                    </p>
                  </div>
                </div>
                <Button onClick={onClose} variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground shrink-0">
                  <X size={16} weight="bold" />
                </Button>
              </div>

              {/* Ephemeral banner — for force-evaluate, nothing was persisted */}
              {reasoning?.ephemeral && (
                <div className="rounded-lg border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 text-[11px] text-amber-200 flex items-center gap-2">
                  <Newspaper size={13} weight="duotone" />
                  <span>
                    <span className="font-semibold">Ephemeral preview.</span>{' '}
                    This proposal was generated for preview/demonstration and has not been persisted to Firestore. Approve/Reject actions are disabled.
                  </span>
                </div>
              )}

              {/* Context summary cards */}
              {context && (
                <section>
                  <h3 className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-2">Context summary</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    <ContextStat label="Niche" value={context.niche ?? '—'} />
                    <ContextStat label="Level" value={isFiniteNum(context.level) ? String(context.level) : '—'} />
                    <ContextStat label="Events attended" value={isFiniteNum(context.events_count) ? String(context.events_count) : '—'} />
                    <ContextStat
                      label="Market snapshot age"
                      value={isFiniteNum(context.market_snapshot_age_seconds) ? fmtAgeSeconds(context.market_snapshot_age_seconds as number) : '—'}
                    />
                    <ContextStat label="Agent ID" value={proposal.agent_id} mono />
                  </div>
                </section>
              )}

              {/* CMC signals present */}
              <section>
                <h3 className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-2">
                  CoinMarketCap signals that reached the agent
                </h3>
                {signalsPresent.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    No CMC signals were passed to the prompt — proposal was generated from event history + owner context only.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {signalsPresent.map((sig) => {
                      const meta = SIGNAL_LABELS[sig] ?? { label: sig, icon: Coins, color: 'cyan' }
                      const Icon = meta.icon
                      return (
                        <Badge key={sig} variant="outline" className={`text-[11px] px-2 py-0.5 border ${SIGNAL_COLOR_CLASSES[meta.color] ?? SIGNAL_COLOR_CLASSES.cyan}`}>
                          <Icon size={11} weight="duotone" className="mr-1" />
                          {meta.label}
                        </Badge>
                      )
                    })}
                  </div>
                )}
              </section>

              {/* Exact prompt sent to Gemini */}
              {prompt && (
                <section>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
                      Exact prompt sent to Gemini
                    </h3>
                    <Button onClick={copyPrompt} variant="ghost" size="sm" className="h-6 text-[10px] text-muted-foreground hover:text-foreground">
                      {copied ? (
                        <><CheckCircle size={12} className="mr-1 text-emerald-400" />Copied</>
                      ) : (
                        <><Copy size={12} className="mr-1" />Copy</>
                      )}
                    </Button>
                  </div>
                  <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words bg-background/40 border border-border/30 rounded-lg p-3 max-h-72 overflow-y-auto">
                    {prompt}
                  </pre>
                </section>
              )}

              {/* Raw Gemini response */}
              {rawResponse && (
                <section>
                  <h3 className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground mb-2">
                    Raw Gemini response
                  </h3>
                  <pre className="text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words bg-background/40 border border-border/30 rounded-lg p-3">
                    {rawResponse}
                  </pre>
                </section>
              )}

              {/* Trust statement */}
              <section className="rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2 text-[11px] text-muted-foreground leading-relaxed">
                <strong className="text-foreground">Audit note.</strong> The full prompt, raw Gemini response, and CMC signal snapshot are persisted in Firestore under <code className="text-[10px] font-mono">reasoning.context_summary</code> + <code className="text-[10px] font-mono">reasoning.raw_response</code>. The complete prompt text is returned once on this response and not persisted (kept out of the document to avoid duplication).
              </section>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

function ContextStat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-border/30 bg-background/30 px-2.5 py-1.5">
      <p className="text-[9px] uppercase tracking-wider font-mono text-muted-foreground/70">{label}</p>
      <p className={`text-xs mt-0.5 truncate ${mono ? 'font-mono' : 'font-semibold'}`}>{value}</p>
    </div>
  )
}
