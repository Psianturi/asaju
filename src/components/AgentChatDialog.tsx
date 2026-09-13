import { useState, useRef, useEffect } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Agent } from '@/lib/types'
import { ChatCircle, PaperPlaneRight, Robot, Sparkle, Lightning } from '@phosphor-icons/react'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { cloudRunService } from '@/services/cloudRunService'

interface Message {
  id: string
  role: 'user' | 'agent'
  content: string
  timestamp: number
}

interface AgentChatDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent: Agent
}

const NICHE_PROMPTS: Record<string, string[]> = {
  'Trading/Investment': [
    'Ambil data futures BTC 7 hari terakhir',
    'Rekomendasi posisi long/short saat ini',
    'Analisa funding rate dan open interest',
    'Risk level untuk entry minggu ini',
  ],
  'Blockchain/DeFi': [
    'Yield farming opportunities minggu ini',
    'Compare Aave vs Compound APY',
    'Bridge Mantle ↔ Ethereum termurah',
    'Latest governance proposals',
  ],
  'Technology': [
    'Buatkan study plan 2 minggu untuk Rust',
    'Syllabus Web3 university terbaik',
    'Summary teknologi baru minggu ini',
    'Roadmap belajar AI + Web3',
  ],
  'Health/Wellness': [
    'Jadwal workout mingguan',
    'Meal plan dari video YouTube',
    'Mindfulness routine harian',
    'Recovery protocol setelah latihan',
  ],
  'Community': [
    'Event Web3 bulan ini',
    'Rekomendasi meetup Asia Tenggara',
    'Buat draft social post mingguan',
    'Networking strategy untuk founder',
  ],
}

function getPromptsForNiche(niche: string): string[] {
  return NICHE_PROMPTS[niche] ?? [
    'Apa insight terbaru dari video YouTube?',
    'Buatkan summary 3 konsep utama',
    'Rekomendasi action item minggu ini',
    'Analisa data terbaru yang tersedia',
  ]
}

function buildWelcome(agent: Agent): Message {
  const videoPart = agent.eventsAttended === 0
    ? 'I haven\'t analyzed any YouTube videos yet — paste a URL on the dashboard to start learning.'
    : `I've analyzed ${agent.eventsAttended} YouTube video${agent.eventsAttended === 1 ? '' : 's'} so far.`

  const personaPart = `I'm your ${agent.personality.toLowerCase()} AI agent focused on ${agent.niche}.`

  return {
    id: 'welcome',
    role: 'agent',
    content: `Hello! ${personaPart} ${videoPart} How can I help you today?`,
    timestamp: Date.now()
  }
}

export function AgentChatDialog({ open, onOpenChange, agent }: AgentChatDialogProps) {
  const [messages, setMessages] = useState<Message[]>(() => [buildWelcome(agent)])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  const suggestedPrompts = getPromptsForNiche(agent.niche)
  const topTags = agent.topFeedbackTags ?? []

  useEffect(() => {
    setMessages([buildWelcome(agent)])
    setInput('')
  }, [agent.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]')
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight
      }
    }
  }, [messages, isTyping])

  const sendMessage = async (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || isTyping) return

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now()
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsTyping(true)

    try {
      const conversationHistory = messages
        .slice(-6)
        .map(m => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.content}`)

      const userContext = {
        customInstructions: agent.customInstructions,
        customAgenda: agent.customAgenda,
        topFeedbackTags: topTags,
        eventsAttended: agent.eventsAttended,
      }

      const response = await cloudRunService.chatWithAgent(
        agent.id,
        userMessage.content,
        conversationHistory,
        userContext,
      )

      const agentMessage: Message = {
        id: `msg-${Date.now()}`,
        role: 'agent',
        content: response.reply,
        timestamp: Date.now()
      }

      setMessages(prev => [...prev, agentMessage])
    } catch (error) {
      console.error('Chat error:', error)
      toast.error('Failed to send message')

      const fallbackMessage: Message = {
        id: `msg-${Date.now()}`,
        role: 'agent',
        content: `I'm having trouble reaching my reasoning model right now. Try again in a moment, or paste a YouTube URL on the dashboard so I have more context to work with.`,
        timestamp: Date.now()
      }

      setMessages(prev => [...prev, fallbackMessage])
    } finally {
      setIsTyping(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const messagesCount = messages.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[min(680px,90vh)] glass-card border-2 border-primary/30 flex flex-col overflow-hidden">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/30 to-secondary/30 border-2 border-primary/40 flex items-center justify-center">
              <Robot size={22} className="text-primary" weight="duotone" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-lg">Chat with {agent.name}</DialogTitle>
              <DialogDescription className="text-xs">
                {agent.personality} • {agent.niche} • Level {agent.level}
                {agent.eventsAttended > 0 && (
                  <span className="ml-2">• {agent.eventsAttended} video{agent.eventsAttended === 1 ? '' : 's'} learned</span>
                )}
              </DialogDescription>
            </div>
          </div>

          {topTags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">You liked:</span>
              {topTags.slice(0, 4).map(t => (
                <Badge key={t.tag} variant="outline" className="text-[10px] py-0 border-primary/30 text-primary/80">
                  {t.tag} <span className="ml-1 opacity-60">{t.score > 0 ? '+' : ''}{t.score}</span>
                </Badge>
              ))}
            </div>
          )}
        </DialogHeader>

        <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0 pr-4">
          <div className="space-y-4 pb-4">
            <AnimatePresence>
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-xl px-4 py-3 ${
                      message.role === 'user'
                        ? 'bg-gradient-to-r from-primary/20 to-accent/20 border border-primary/30 text-foreground'
                        : 'bg-muted/50 border border-border/50 text-foreground'
                    }`}
                  >
                    {message.role === 'agent' && (
                      <div className="flex items-center gap-2 mb-2">
                        <Robot size={16} className="text-primary" weight="duotone" />
                        <span className="text-xs font-semibold text-primary">{agent.name}</span>
                      </div>
                    )}
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {isTyping && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex justify-start"
              >
                <div className="max-w-[80%] rounded-xl px-4 py-3 bg-muted/50 border border-border/50">
                  <div className="flex items-center gap-2 mb-2">
                    <Robot size={16} className="text-primary" weight="duotone" />
                    <span className="text-xs font-semibold text-primary">{agent.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </motion.div>
            )}

            {messagesCount <= 1 && (
              <div className="pt-2 space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground uppercase tracking-wide">
                  <Sparkle size={11} weight="fill" />
                  <span>Try asking {agent.name}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {suggestedPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => sendMessage(prompt)}
                      disabled={isTyping}
                      className="text-left text-xs px-3 py-2 rounded-lg bg-muted/30 border border-border/40 hover:border-primary/40 hover:bg-primary/5 transition-colors disabled:opacity-50"
                    >
                      <div className="flex items-start gap-1.5">
                        <Lightning size={11} weight="fill" className="text-primary/70 mt-0.5 shrink-0" />
                        <span>{prompt}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="flex items-center gap-2 pt-4 border-t border-border/30">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={`Ask ${agent.name} anything...`}
            disabled={isTyping}
            className="flex-1 border-primary/30 focus:border-primary bg-background/50"
          />
          <Button
            onClick={() => sendMessage()}
            disabled={!input.trim() || isTyping}
            className="bg-gradient-to-r from-primary to-accent hover:opacity-90"
          >
            <PaperPlaneRight size={20} weight="bold" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
