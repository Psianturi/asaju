import { Question } from '@phosphor-icons/react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { GLOSSARY, type GlossaryTerm } from '@/lib/glossary'

/** A small "?" next to an ASAJU-specific term that explains it on hover/focus. */
export function TermHint({ term, className = '' }: { term: GlossaryTerm; className?: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            // Hints often sit inside clickable cards; a tap should explain the
            // term, not also open the card.
            onClick={(e) => e.stopPropagation()}
            aria-label={`What does this mean? ${GLOSSARY[term]}`}
            className={`inline-flex items-center justify-center text-muted-foreground/70 hover:text-foreground focus-visible:text-foreground focus-visible:outline-none ${className}`}
          >
            <Question size={10} weight="bold" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs leading-snug">
          {GLOSSARY[term]}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
