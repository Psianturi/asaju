import { useState, useEffect, useRef } from 'react'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Terminal, X, Minus, CaretRight } from '@phosphor-icons/react'
import { TerminalLog } from '@/lib/types'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'

interface TerminalConsoleProps {
  logs: TerminalLog[]
  className?: string
}

const logTypeStyles = {
  info: 'text-primary',
  success: 'text-green-400',
  error: 'text-destructive',
  warning: 'text-yellow-400'
}

const subAgentPrefix = {
  secretary: '[Secretary]',
  scribe: '[Scribe]',
  'social-lite': '[Social-Lite]',
  'mint-master': '[Mint-Master]'
}

const subAgentColors = {
  secretary: 'text-cyan-400',
  scribe: 'text-purple-400',
  'social-lite': 'text-pink-400',
  'mint-master': 'text-amber-400'
}

export function TerminalConsole({ logs, className }: TerminalConsoleProps) {
  const [isMinimized, setIsMinimized] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const saved = window.localStorage.getItem('maef-mission-console-open')
    if (saved === 'true') {
      setIsOpen(true)
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem('maef-mission-console-open', String(isOpen))
  }, [isOpen])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  if (!isOpen) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
        // Icon-only on phones, where the labelled pill covered page content.
        className="fixed left-3 bottom-4 sm:bottom-6 z-50 h-9 w-9 sm:w-auto px-0 sm:px-2.5 rounded-full border-primary/40 bg-background/80 backdrop-blur-md text-primary hover:bg-primary/10"
        aria-label="Open activity log"
        title="Activity log"
      >
        <Terminal size={14} className="sm:mr-1" weight="fill" />
        <span className="hidden sm:inline">Log</span>
      </Button>
    )
  }

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      className={cn('fixed bottom-0 left-0 right-0 z-50', className)}
    >
      <Card className="glass-card rounded-t-xl rounded-b-none border-t-2 border-primary/40 border-b-0 overflow-hidden shadow-2xl shadow-primary/20">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 bg-gradient-to-r from-background/90 to-background/80 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center">
              <Terminal className="text-primary" weight="fill" size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-primary">MISSION CONTROL LOG</span>
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              </div>
              <span className="text-xs text-muted-foreground font-mono">
                {logs.length} {logs.length === 1 ? 'entry' : 'entries'} • Live monitoring
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsMinimized(!isMinimized)}
              className="h-7 w-7 p-0 hover:bg-primary/10 hover:text-primary transition-colors"
            >
              <Minus size={16} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsOpen(false)}
              className="h-7 w-7 p-0 hover:bg-destructive/10 hover:text-destructive transition-colors"
            >
              <X size={16} />
            </Button>
          </div>
        </div>

        <AnimatePresence>
          {!isMinimized && (
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: 240 }}
              exit={{ height: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
            >
              <ScrollArea className="h-[240px] bg-gradient-to-b from-background/95 to-background">
                <div ref={scrollRef} className="p-4 space-y-1.5 font-mono text-xs">
                  {logs.length === 0 ? (
                    <div className="flex items-center gap-2 text-muted-foreground italic py-2">
                      <CaretRight className="animate-pulse" />
                      <span>Waiting for agent activity...</span>
                      <span className="animate-terminal-blink">_</span>
                    </div>
                  ) : (
                    logs.map((log) => (
                      <motion.div
                        key={log.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3 }}
                        className="flex items-start gap-2 py-1 hover:bg-primary/5 px-2 -mx-2 rounded transition-colors"
                      >
                        <CaretRight size={12} className="text-primary mt-0.5 flex-shrink-0" weight="bold" />
                        <span className="text-muted-foreground/70 min-w-[70px]">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                        <span className={cn('font-bold min-w-[110px] flex-shrink-0', subAgentColors[log.subAgentType])}>
                          {subAgentPrefix[log.subAgentType]}
                        </span>
                        <span className={cn('flex-1', logTypeStyles[log.type])}>
                          {log.message}
                        </span>
                      </motion.div>
                    ))
                  )}
                  <div className="flex items-center gap-1 text-green-400 opacity-70 py-1">
                    <CaretRight className="animate-pulse" />
                    <span className="animate-terminal-blink">_</span>
                  </div>
                </div>
              </ScrollArea>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  )
}
