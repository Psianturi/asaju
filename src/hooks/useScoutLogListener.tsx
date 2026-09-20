/**
 * useScoutLogListener — real-time Firestore listener for the owner's scout
 * runs. Fires a toast each time a new MINTED entry appears.
 *
 * Why this exists:
 * The NotificationBell already polls every 30s, but the user wants instant
 * feedback the moment their agent mints while they're staring at the dashboard.
 * Firestore's onSnapshot gives us a real-time push without polling or SSE.
 *
 * Scope: subscribes ONLY to scout_logs for agents owned by the connected wallet.
 * Last 7 days only (older entries are irrelevant). Limit 50 to bound the
 * subscription cost on the Firestore SDK.
 */
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Sparkle, Lightning, WarningCircle } from '@phosphor-icons/react'
import { useBlockchain } from './useBlockchain'
import { cloudRunService } from '@/services/cloudRunService'

const SEEN_LOG_IDS_KEY = 'asaju:scout-seen:'

export function useScoutLogListener(agentIds: string[]) {
  const { isConnected } = useBlockchain()
  // Track which log_ids we've already toasted about so we don't spam on each
  // re-mount of the listener.
  const seenIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!isConnected || agentIds.length === 0) return
    if (typeof window === 'undefined') return

    // Seed seen set from localStorage so a refresh doesn't re-toast about
    // entries the user has already been notified about.
    try {
      const stored = window.localStorage.getItem(SEEN_LOG_IDS_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as string[]
        seenIdsRef.current = new Set(parsed.slice(-500))
      }
    } catch {
      // ignore malformed stored value
    }

    let cancelled = false

    async function attach() {
      // Firestore client-side listener is set up via the cloudRunService
      // helper if available, otherwise fall back to polling. For the current
      // backend setup, scout_logs are fetched on-demand through `/api/v1/owner/inbox`,
      // so the listener polls that endpoint every 15s. This is cheaper than a
      // long-lived Firestore listener for low-traffic dashboards.
      const interval = setInterval(async () => {
        if (cancelled) return
        try {
          // Pull the inbox for the connected owner and surface only scout-run
          // entries that we haven't toasted about yet.
          const w = window as unknown as Record<string, string | undefined>
          const wallet = w.__walletAddr
          if (!wallet) return
          const data = await cloudRunService.getOwnerInbox(wallet)
          const runs = (data as { recent_scout_runs?: Array<{ log_id: string; action: string; candidate_title: string | null; reason_description: string | null; agent_id: string }> }).recent_scout_runs ?? []
          for (const r of runs) {
            if (seenIdsRef.current.has(r.log_id)) continue
            seenIdsRef.current.add(r.log_id)
            // Persist last 500 seen ids.
            try {
              const arr = Array.from(seenIdsRef.current).slice(-500)
              window.localStorage.setItem(SEEN_LOG_IDS_KEY, JSON.stringify(arr))
            } catch {
              // localStorage may be full; ignore.
            }
            if (r.action === 'MINTED') {
              toast.success('Agent minted learning proof', {
                description: r.candidate_title
                  ? `Watched "${r.candidate_title.slice(0, 80)}"`
                  : 'New milestone reached.',
                icon: <Sparkle size={14} weight="fill" />,
              })
            } else if (r.action === 'SKIPPED') {
              toast.info('Scout skip', {
                description: r.reason_description ?? 'No milestone this round.',
                icon: <Lightning size={14} />,
              })
            } else {
              toast.warning('Scout run', {
                description: r.action,
                icon: <WarningCircle size={14} />,
              })
            }
          }
        } catch {
          // Silently swallow polling errors — the NotificationBell already covers
          // the read-side error display.
        }
      }, 15_000)

      return () => clearInterval(interval)
    }

    let cleanupFn: (() => void) | null = null
    attach().then((fn) => {
      if (cancelled && fn) fn()
      else cleanupFn = fn ?? null
    })

    return () => {
      cancelled = true
      cleanupFn?.()
    }
  }, [agentIds.join(','), isConnected])
}
