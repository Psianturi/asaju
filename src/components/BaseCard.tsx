/**
 * BaseCard — the standardized container used across Analytics, NFT Vault,
 * Marketplace, and any other non-specialised list/table view.
 *
 * The dashboard gets a richer variant (gradient borders + glow), but anywhere
 * the user is browsing a *collection* (table of rows, list of NFTs, list of
 * agent stats), they should see this exact card:
 *
 *   - background:    bg-slate-950/60  (slightly lighter than surface, so it sits forward)
 *   - border:        border-white/[0.08]  (a quiet hairline, not loud)
 *   - radius:        rounded-xl  (matches shadcn Card)
 *   - padding:       p-4
 *   - hover (opt):   border-white/[0.14] bg-slate-900/70  for clickable rows
 *
 * Use only this component for new list-style cards. Reserve decorative
 * gradients + glow for elements that represent *active thinking* (the agent's
 * Sensory Feed, the Live Scout Log, or any panel the agent is currently writing
 * into). That visual contrast is what makes the dashboard feel like a working
 * terminal rather than a uniform grid of cards.
 */
import { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

type BaseCardProps = ComponentProps<'div'> & {
  /** Highlight the card with a clickable hover style. Use for rows in a table. */
  interactive?: boolean
}

export function BaseCard({ className, interactive = false, ...props }: BaseCardProps) {
  return (
    <div
      data-slot="base-card"
      className={cn(
        'rounded-xl border bg-slate-950/60 border-white/[0.08] p-4',
        interactive &&
          'transition-colors hover:border-white/[0.14] hover:bg-slate-900/70 cursor-pointer',
        className,
      )}
      {...props}
    />
  )
}

/**
 * BaseRow — horizontal list row inside a BaseCard. Adds the bottom hairline
 * that separates entries without forcing a wrapper Card per row.
 */
export function BaseRow({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="base-row"
      className={cn(
        'flex items-center gap-3 px-3 py-2 border-b border-white/[0.05] last:border-0',
        className,
      )}
      {...props}
    />
  )
}
