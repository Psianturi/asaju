import { useState, useEffect, useCallback, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Agent, BackendProposal } from '@/lib/types'
import { cloudRunService } from '@/services/cloudRunService'
import { MarketContextPanel } from '@/components/MarketSnapshotCard'
import { ReasoningSlideOver } from '@/components/ReasoningSlideOver'
import { mantleService } from '@/lib/blockchain/mantleService'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Brain,
  Lightning,
  CheckCircle,
  XCircle,
  Clock,
  ArrowSquareOut,
  SpinnerGap,
  Lightbulb,
  TrendUp,
  GraduationCap,
  Users,
  Warning,
  ArrowClockwise,
  ShieldCheck,
  Vault,
  Wallet,
  ArrowsDownUp,
  Eye,
  Sparkle,
} from '@phosphor-icons/react'

interface ProposalModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent: Agent
  onProposalCountChange?: (agentId: string, count: number) => void
  /** Backend reports this false when AUTONOMOUS_VAULT_ADDRESS isn't configured —
   * hides "Execute Transfer" instead of showing a button that always 400s. */
  autonomousExecutionEnabled?: boolean
}

const CATEGORY_CONFIG = {
  defi: {
    label: 'DeFi',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    Icon: TrendUp,
  },
  governance: {
    label: 'Governance',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
    Icon: Lightning,
  },
  education: {
    label: 'Education',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    Icon: GraduationCap,
  },
  community: {
    label: 'Community',
    color: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/30',
    Icon: Users,
  },
} as const

function formatTTL(expiresAt: number): string {
  const remaining = Math.max(0, expiresAt - Date.now() / 1000)
  if (remaining <= 0) return 'Expired'
  const hours = Math.floor(remaining / 3600)
  const days = Math.floor(hours / 24)
  if (days >= 1) return `${days}d ${hours % 24}h left`
  return `${hours}h ${Math.floor((remaining % 3600) / 60)}m left`
}

function ProposalCard({
  proposal,
  onApprove,
  onReject,
  onExecute,
  executingId,
  actioningId,
  autonomousExecutionEnabled,
  onShowReasoning,
}: {
  proposal: BackendProposal
  onApprove: (p: BackendProposal) => void
  onReject: (p: BackendProposal) => void
  onExecute: (p: BackendProposal) => void
  executingId: string | null
  actioningId: string | null
  autonomousExecutionEnabled: boolean
  onShowReasoning: (p: BackendProposal) => void
}) {
  const cat = CATEGORY_CONFIG[proposal.category] ?? CATEGORY_CONFIG.community
  const CatIcon = cat.Icon
  const isActioning = actioningId === proposal.proposal_id
  const isApproved = proposal.status === 'approved'
  const isRejected = proposal.status === 'rejected'
  const isExpired = proposal.status === 'expired'
  const isPending = proposal.status === 'pending'
  const isApproving = proposal.status === 'approving'
  const isEphemeral = proposal.status === 'ephemeral'

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className={`rounded-xl border p-5 ${
        isApproved
          ? 'border-emerald-500/40 bg-emerald-500/5'
          : isRejected
          ? 'border-red-500/20 bg-red-500/5'
          : isExpired
          ? 'border-border/40 bg-muted/10 opacity-60'
          : 'border-border/50 bg-card/60'
      }`}
    >
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${cat.bg} ${cat.border} border`}>
          <CatIcon size={18} className={cat.color} weight="duotone" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge className={`text-[10px] font-bold px-2 py-0 border ${cat.bg} ${cat.color} ${cat.border}`}>
              {cat.label}
            </Badge>
            {isPending && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono">
                <Clock size={10} />
                {formatTTL(proposal.expires_at)}
              </span>
            )}
            {isApproving && (
              <Badge className="text-[10px] font-bold px-2 py-0 bg-amber-500/15 text-amber-400 border-amber-500/30">
                Approval in progress
              </Badge>
            )}
            {isApproved && (
              <Badge className="text-[10px] font-bold px-2 py-0 bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                Approved
              </Badge>
            )}
            {isRejected && (
              <Badge className="text-[10px] font-bold px-2 py-0 bg-red-500/15 text-red-400 border-red-500/30">
                Rejected
              </Badge>
            )}
            {isExpired && (
              <Badge variant="outline" className="text-[10px] font-bold px-2 py-0 opacity-50">
                Expired
              </Badge>
            )}
          </div>
          <h3 className="font-bold text-sm leading-tight">{proposal.title}</h3>
          {/* Chain-of-thought trigger tags — the data points that drove this
              proposal. Click any tag to focus the agent's sensory feed above. */}
          {(proposal.trigger_tags ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {proposal.trigger_tags!.map((tag, i) => (
                <span
                  key={`${tag}-${i}`}
                  className="inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded border border-cyan-400/25 bg-cyan-400/10 text-cyan-200"
                  title={`Trigger #${i + 1} that drove this proposal`}
                >
                  <Sparkle size={8} weight="fill" className="text-cyan-300" />
                  Trigger: {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed mb-3">
        {proposal.description}
      </p>

      {proposal.market_context && (
        <div className="mb-4 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.03] p-3">
          <MarketContextPanel snapshot={proposal.market_context} compact />
          <div className="mt-2 pt-2 border-t border-cyan-400/10 flex items-center justify-between">
            <span className="text-[9px] text-cyan-400/40 font-mono">
              Sources: CoinMarketCap Fear &amp; Greed + News, on-chain liquidity
            </span>
            {proposal.market_context.generated_at && (
              <span className="text-[9px] text-cyan-400/30 font-mono">
                {new Date(proposal.market_context.generated_at * 1000).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
      )}

      {proposal.market_context_status !== 'available' && (
        <div className="mb-4 rounded-xl border border-yellow-400/20 bg-yellow-400/[0.04] px-3 py-2 flex items-center gap-2">
          <Warning size={13} className="text-yellow-400 shrink-0" weight="fill" />
          <span className="text-xs text-yellow-200">
            {proposal.market_context_status === 'stale'
              ? 'Market data is stale — over 1 hour old. This proposal was generated without current market conditions.'
              : 'Market data unavailable — this proposal was generated without market context.'}
          </span>
        </div>
      )}

      {isApproved && proposal.tx_hash && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <Lightning size={14} className="text-emerald-400" weight="fill" />
            <span className="text-xs font-bold text-emerald-400">
              Heritage +{HERITAGE_XP} · Score: {proposal.heritage_score_after ?? '—'}
            </span>
          </div>
          <a
            href={`https://explorer.sepolia.mantle.xyz/tx/${proposal.tx_hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 transition-colors font-mono"
            onClick={(e) => e.stopPropagation()}
          >
            MantleScan
            <ArrowSquareOut size={10} />
          </a>
        </motion.div>
      )}

      {isApproved && proposal.category === 'defi' && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="mb-4 p-3 rounded-lg bg-violet-500/10 border border-violet-500/30"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lightning size={14} className="text-violet-400" weight="fill" />
              <span className="text-xs font-bold text-violet-300">DeFi Execution</span>
            </div>
            {proposal.autonomous_transfer_tx ? (
              <a
                href={`https://explorer.sepolia.mantle.xyz/tx/${proposal.autonomous_transfer_tx}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] text-violet-400 hover:text-violet-300 transition-colors font-mono"
                onClick={(e) => e.stopPropagation()}
              >
                {proposal.autonomous_transfer_status === 'success' ? 'View Transfer' : 'View Tx'}
                <ArrowSquareOut size={10} />
              </a>
            ) : proposal.autonomous_execution_triggered ? (
              <span className="text-[10px] text-violet-400/60 font-mono">pending…</span>
            ) : autonomousExecutionEnabled ? (
              <Button
                size="sm"
                variant="outline"
                disabled={executingId === proposal.proposal_id}
                onClick={() => onExecute(proposal)}
                className="h-6 px-2 text-[10px] border-violet-500/40 text-violet-300 hover:bg-violet-500/10"
              >
                {executingId === proposal.proposal_id ? (
                  <SpinnerGap size={11} className="animate-spin" />
                ) : (
                  'Execute Transfer'
                )}
              </Button>
            ) : (
              <span className="text-[10px] text-violet-400/50 font-mono">not yet enabled</span>
            )}
          </div>
          <p className="text-[11px] text-violet-300/70 mt-1 leading-relaxed">
            {proposal.autonomous_transfer_status === 'success'
              ? `Agent transferred ${proposal.autonomous_transfer_amount_mnt ?? 0.1} MNT to Autonomous Vault`
              : proposal.autonomous_transfer_status === 'failed'
              ? 'Transfer failed — check agent gas balance'
              : proposal.autonomous_execution_triggered
              ? 'Transfer in progress…'
              : autonomousExecutionEnabled
              ? 'Requires separate owner approval to transfer 0.1 MNT from agent wallet to vault.'
              : 'Autonomous execution is a roadmap feature and is not enabled on this deployment yet — this proposal stays approved without a transfer.'}
          </p>
        </motion.div>
      )}

      {isPending && (
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={!!actioningId}
            onClick={() => onApprove(proposal)}
            className="flex-1 h-8 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold text-xs shadow-lg shadow-emerald-500/20 disabled:opacity-50"
          >
            {isActioning ? (
              <SpinnerGap size={14} className="animate-spin" />
            ) : (
              <>
                <CheckCircle size={14} weight="fill" className="mr-1" />
                Approve
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!!actioningId}
            onClick={() => onReject(proposal)}
            className="flex-1 h-8 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-400 font-semibold text-xs disabled:opacity-50"
          >
            {isActioning ? (
              <SpinnerGap size={14} className="animate-spin" />
            ) : (
              <>
                <XCircle size={14} weight="fill" className="mr-1" />
                Reject
              </>
            )}
          </Button>
        </div>
      )}

      {/* "View AI Reasoning" — always available so the user can inspect the
          data the agent saw + what it told Gemini, even on rejected/approved proposals. */}
      <button
        type="button"
        onClick={() => onShowReasoning(proposal)}
        className="mt-2 w-full flex items-center justify-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors group"
      >
        <Eye size={12} weight="duotone" className="group-hover:text-primary transition-colors" />
        View AI Reasoning
        <span className="text-[9px] text-muted-foreground/60 ml-1 font-mono">
          {proposal.reasoning?.context_summary?.cmc_signals_present?.length ?? 0} signals
        </span>
      </button>
    </motion.div>
  )
}

const HERITAGE_XP = 5
const FETCH_TIMEOUT_MS = 12_000

interface ParsedExecutionDetails {
  proposalId: string
  proposalHash: string
  agentWallet: string
  vaultAddress: string
  amountMnt: number
  ownerWallet: string
  nonce: string
  expiresAt: number
}

function parseExecutionMessage(message: string): ParsedExecutionDetails | null {
  const lines = message.split('\n')
  const get = (key: string) => lines.find(l => l.startsWith(key))?.split(': ')[1]?.trim()
  const proposalId = get('Proposal ID:') ?? ''
  const proposalHash = get('Proposal hash:') ?? ''
  const agentWallet = get('Agent wallet:') ?? ''
  const vaultAddress = get('Transfer to vault:') ?? ''
  const amountStr = get('Amount:') ?? '0'
  const amountMnt = parseFloat(amountStr.replace(' MNT', ''))
  const ownerWallet = get('Owner wallet:') ?? ''
  const nonce = get('Nonce:') ?? ''
  const expiresStr = get('Expires at:') ?? '0'
  const expiresAt = parseInt(expiresStr, 10)
  if (!proposalId || !vaultAddress) return null
  return { proposalId, proposalHash, agentWallet, vaultAddress, amountMnt, ownerWallet, nonce, expiresAt }
}

export function ProposalModal({ open, onOpenChange, agent, onProposalCountChange, autonomousExecutionEnabled = false }: ProposalModalProps) {
  const [proposals, setProposals] = useState<BackendProposal[]>([])
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [actioningId, setActioningId] = useState<string | null>(null)
  const [executingId, setExecutingId] = useState<string | null>(null)
  const [executionPreview, setExecutionPreview] = useState<{ nonce: string; message: string; expires_at: number; parsed: ParsedExecutionDetails } | null>(null)
  const [pendingExecutionProposal, setPendingExecutionProposal] = useState<BackendProposal | null>(null)
  const [reasoningProposal, setReasoningProposal] = useState<BackendProposal | null>(null)
  const [ephemeralProposal, setEphemeralProposal] = useState<BackendProposal | null>(null)
  const [forceEvaluating, setForceEvaluating] = useState(false)

  const pendingCount = proposals.filter(p => p.status === 'pending').length

  // Stable ref so fetchProposals never re-creates due to parent callback identity changes
  const onCountChangeRef = useRef(onProposalCountChange)
  useEffect(() => { onCountChangeRef.current = onProposalCountChange })

  const notifyCount = useCallback((list: BackendProposal[]) => {
    onCountChangeRef.current?.(agent.id, list.filter(p => p.status === 'pending').length)
  }, [agent.id])

  const fetchProposals = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), FETCH_TIMEOUT_MS)
      )
      const data = await Promise.race([
        cloudRunService.getAgentProposals(agent.id),
        timeout,
      ])
      setProposals(data)
      notifyCount(data)
    } catch (err) {
      const isTimeout = err instanceof Error && err.message === 'timeout'
      setFetchError(
        isTimeout
          ? 'Backend is cold-starting — please try again in a moment'
          : 'Could not reach the server. Check your connection and try again.'
      )
    } finally {
      setLoading(false)
    }
  }, [agent.id, notifyCount])

  useEffect(() => {
    if (open) {
      fetchProposals()
    } else {
      setProposals([])
      setFetchError(null)
    }
  }, [open, fetchProposals])

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const newProposal = await cloudRunService.generateProposal(agent.id)
      const next = [newProposal, ...proposals]
      setProposals(next)
      notifyCount(next)
      toast.success('Strategic proposal generated', { description: newProposal.title })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Generation failed'
      if (msg.includes('422') && msg.toLowerCase().includes('defi')) {
        toast.error('DeFi proposal blocked', {
          description: 'Market data is unavailable or stale. DeFi proposals require fresh market context.',
        })
      } else {
        toast.error('Proposal generation failed', { description: msg })
      }
    } finally {
      setGenerating(false)
    }
  }

  const handleForceEvaluate = async () => {
    setForceEvaluating(true)
    try {
      const ephemeral = await cloudRunService.forceEvaluate(agent.id)
      setEphemeralProposal(ephemeral)
      setReasoningProposal(ephemeral)
      toast.success('Ephemeral preview generated', {
        description: 'This was a demo run — nothing was persisted. Open "View AI Reasoning" to see the full pipeline.',
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Force-evaluate failed'
      toast.error('Force-evaluate failed', { description: msg })
    } finally {
      setForceEvaluating(false)
    }
  }

  const handleApprove = async (proposal: BackendProposal) => {
    setActioningId(proposal.proposal_id)
    try {
      const challenge = await cloudRunService.createProposalApprovalChallenge(proposal.proposal_id)
      const signedAuthorization = await mantleService.signMessage(challenge.message)
      const authorization = { ...signedAuthorization, nonce: challenge.nonce }
      const updated = await cloudRunService.approveProposal(proposal.proposal_id, authorization)
      const next = proposals.map(p => p.proposal_id === updated.proposal_id ? updated : p)
      setProposals(next)
      notifyCount(next)
      toast.success('Proposal approved on-chain', {
        description: `Heritage Score +${HERITAGE_XP}`,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Approval failed'
      toast.error('On-chain execution failed', { description: msg })
    } finally {
      setActioningId(null)
    }
  }

  const handleReject = async (proposal: BackendProposal) => {
    setActioningId(proposal.proposal_id)
    try {
      const challenge = await cloudRunService.createProposalApprovalChallenge(proposal.proposal_id, 'reject')
      const signedAuthorization = await mantleService.signMessage(challenge.message)
      const authorization = { ...signedAuthorization, nonce: challenge.nonce }
      const updated = await cloudRunService.rejectProposal(proposal.proposal_id, authorization)
      const next = proposals.map(p => p.proposal_id === updated.proposal_id ? updated : p)
      setProposals(next)
      notifyCount(next)
      toast.info('Proposal rejected')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to reject proposal'
      toast.error('Rejection failed', { description: msg })
    } finally {
      setActioningId(null)
    }
  }

  const handleExecute = async (proposal: BackendProposal) => {
    setExecutingId(proposal.proposal_id)
    try {
      const challenge = await cloudRunService.createExecutionChallenge(proposal.proposal_id)
      const parsed = parseExecutionMessage(challenge.message)
      if (!parsed) {
        toast.error('Failed to parse execution details')
        setExecutingId(null)
        return
      }
      setPendingExecutionProposal(proposal)
      setExecutionPreview({ nonce: challenge.nonce, message: challenge.message, expires_at: challenge.expires_at, parsed })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Execution failed'
      toast.error('Transfer execution failed', { description: msg })
      setExecutingId(null)
    }
  }

  const handleConfirmExecute = async () => {
    if (!executionPreview || !pendingExecutionProposal) return
    setExecutingId(pendingExecutionProposal.proposal_id)
    setExecutionPreview(null)
    setPendingExecutionProposal(null)
    try {
      const signedAuthorization = await mantleService.signMessage(executionPreview.message)
      const authorization = { ...signedAuthorization, nonce: executionPreview.nonce }
      const updated = await cloudRunService.executeProposalTransfer(pendingExecutionProposal.proposal_id, authorization)
      const next = proposals.map(p => p.proposal_id === updated.proposal_id ? updated : p)
      setProposals(next)
      toast.success('Transfer executed', {
        description: `0.1 MNT transferred from agent wallet to vault`,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Execution failed'
      toast.error('Transfer execution failed', { description: msg })
    } finally {
      setExecutingId(null)
    }
  }

  const handleCancelExecute = () => {
    setExecutionPreview(null)
    setPendingExecutionProposal(null)
    setExecutingId(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card max-w-lg w-full max-h-[85vh] flex flex-col border-primary/30">
        <DialogHeader className="flex-shrink-0 pb-4 border-b border-border/30">
          <DialogTitle className="flex items-center gap-3 text-lg font-bold">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500/30 to-orange-500/30 border border-amber-500/40 flex items-center justify-center">
              <Lightbulb size={18} className="text-amber-400" weight="duotone" />
            </div>
            <div>
              <div>Strategic Proposals</div>
              <div className="text-xs font-normal text-muted-foreground">{agent.name}</div>
            </div>
            {pendingCount > 0 && (
              <Badge className="ml-auto bg-amber-500/20 text-amber-400 border-amber-500/40 text-xs font-bold">
                {pendingCount} pending
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4 space-y-3 min-h-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <SpinnerGap size={32} className="animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading proposals...</p>
              <p className="text-[10px] text-muted-foreground/50">Timeout in {FETCH_TIMEOUT_MS / 1000}s</p>
            </div>
          ) : fetchError ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
              <div className="w-14 h-14 rounded-2xl bg-destructive/10 border border-destructive/30 flex items-center justify-center">
                <Warning size={28} className="text-destructive/70" weight="duotone" />
              </div>
              <div>
                <p className="font-semibold text-sm mb-1 text-destructive/80">Connection failed</p>
                <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">{fetchError}</p>
              </div>
              <Button size="sm" variant="outline" onClick={fetchProposals} className="gap-1.5">
                <ArrowClockwise size={13} weight="bold" />
                Try Again
              </Button>
            </div>
          ) : proposals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Brain size={32} className="text-muted-foreground/50" weight="duotone" />
              </div>
              <div>
                <p className="font-semibold text-sm mb-1">No proposals yet</p>
                <p className="text-xs text-muted-foreground max-w-xs">
                  Request a strategic consult — Gemini will analyse {agent.name}'s event history and generate an action proposal.
                </p>
              </div>
            </div>
          ) : (
            <AnimatePresence mode="popLayout">
              {/* Show ephemeral (force-evaluate) preview first if present, distinct from persisted proposals */}
              {ephemeralProposal && (
                <ProposalCard
                  key="ephemeral-preview"
                  proposal={ephemeralProposal}
                  onApprove={() => toast.info('Ephemeral proposals cannot be approved — they were not persisted.')}
                  onReject={() => setEphemeralProposal(null)}
                  onExecute={() => toast.info('Ephemeral proposals cannot be executed.')}
                  executingId={executingId}
                  actioningId={actioningId}
                  autonomousExecutionEnabled={false}
                  onShowReasoning={() => setReasoningProposal(ephemeralProposal)}
                />
              )}
              {proposals.map(p => (
                <ProposalCard
                  key={p.proposal_id}
                  proposal={p}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  onExecute={handleExecute}
                  executingId={executingId}
                  actioningId={actioningId}
                  autonomousExecutionEnabled={autonomousExecutionEnabled}
                  onShowReasoning={() => setReasoningProposal(p)}
                />
              ))}
            </AnimatePresence>
          )}
        </div>

        <div className="flex-shrink-0 pt-4 border-t border-border/30 space-y-2">
          <div className="flex gap-2">
            <Button
              onClick={handleGenerate}
              disabled={generating || forceEvaluating || loading || !!actioningId}
              className="flex-1 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold shadow-lg shadow-amber-500/20 disabled:opacity-50"
            >
              {generating ? (
                <>
                  <SpinnerGap size={16} className="animate-spin mr-2" />
                  Consulting Gemini...
                </>
              ) : (
                <>
                  <Lightbulb size={16} weight="duotone" className="mr-2" />
                  Request Strategic Consult
                </>
              )}
            </Button>
            <Button
              onClick={handleForceEvaluate}
              disabled={generating || forceEvaluating || loading || !!actioningId}
              variant="outline"
              className="shrink-0 gap-1.5 border-cyan-400/30 text-cyan-300 hover:bg-cyan-400/10 hover:text-cyan-200 disabled:opacity-50"
              title="Run the full data → prompt → reasoning → decision pipeline without persisting anything. Use this to show the agent's evaluation to a jury or stakeholder in real time."
            >
              {forceEvaluating ? (
                <SpinnerGap size={14} className="animate-spin" />
              ) : (
                <Lightning size={14} weight="bold" />
              )}
              Force Evaluate
            </Button>
          </div>
          {pendingCount > 0 && (
            <div className="flex items-center gap-1.5 justify-center">
              <Warning size={11} className="text-amber-400" weight="fill" />
              <p className="text-[10px] text-muted-foreground">
                Approved proposals record on Mantle Sepolia and cost gas.
              </p>
            </div>
          )}
        </div>
      </DialogContent>

      <AlertDialog open={!!executionPreview} onOpenChange={(open) => { if (!open) handleCancelExecute() }}>
        <AlertDialogContent className="glass-card max-w-md w-full border-primary/30">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                <ShieldCheck size={18} className="text-emerald-400" weight="duotone" />
              </div>
              Review Transfer Details
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground">
              This action will transfer MNT from the agent wallet to the vault. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {executionPreview && (
            <div className="space-y-3 py-2">
              <div className="rounded-lg bg-black/30 border border-border/40 p-3 space-y-2.5 text-xs font-mono">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Amount</span>
                  <span className="text-emerald-400 font-bold">{executionPreview.parsed.amountMnt} MNT</span>
                </div>
                <div className="flex items-start gap-2">
                  <Wallet size={12} className="text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-muted-foreground leading-tight">From (Agent Wallet)</div>
                    <div className="text-foreground truncate leading-tight" title={executionPreview.parsed.agentWallet}>
                      {executionPreview.parsed.agentWallet}
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Vault size={12} className="text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-muted-foreground leading-tight">To (Vault)</div>
                    <div className="text-foreground truncate leading-tight" title={executionPreview.parsed.vaultAddress}>
                      {executionPreview.parsed.vaultAddress}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Chain</span>
                  <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary/70">
                    Mantle Sepolia (5003)
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Proposal</span>
                  <span className="text-foreground truncate max-w-[180px]" title={executionPreview.parsed.proposalId}>
                    {executionPreview.parsed.proposalId}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5 rounded bg-amber-500/10 border border-amber-500/30 p-2">
                <Warning size={11} className="text-amber-400 shrink-0" weight="fill" />
                <p className="text-[10px] text-amber-300 leading-relaxed">
                  Confirming signs a message with your wallet. The transfer executes immediately after.
                </p>
              </div>
            </div>
          )}

          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel asChild>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCancelExecute}>
                Cancel
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                size="sm"
                className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={handleConfirmExecute}
              >
                <ShieldCheck size={13} weight="fill" />
                Confirm & Sign
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ReasoningSlideOver
        proposal={reasoningProposal}
        open={!!reasoningProposal}
        onClose={() => setReasoningProposal(null)}
      />
    </Dialog>
  )
}
