import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Agent } from '@/lib/types'
import { GearSix, FloppyDisk } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'

interface AgentConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent: Agent
  /** Signs and persists; rejects if the owner declines or the save fails. */
  onSave: (agentId: string, instructions: string, customAgenda: string) => Promise<void>
}

export function AgentConfigDialog({ open, onOpenChange, agent, onSave }: AgentConfigDialogProps) {
  const [instructions, setInstructions] = useState(agent.customInstructions || '')
  const [customAgenda, setCustomAgenda] = useState(agent.customAgenda || '')
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await onSave(agent.id, instructions, customAgenda)
      onOpenChange(false)
      toast.success('Agent Configuration Updated!', {
        description: `${agent.name} has been reconfigured`
      })
    } catch (err) {
      // Stay open so nothing the owner typed is lost.
      toast.error('Configuration not saved', {
        description: err instanceof Error ? err.message : 'The signature was declined or the save failed.',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const exampleInstructions = {
    'Blockchain/DeFi': 'Focus exclusively on Layer 2 scaling solutions and cross-chain bridges. Prioritize technical analysis over market sentiment.',
    'Trading/Investment': 'Emphasize quantitative analysis and risk management strategies. Track institutional money flows and whale activity.',
    'Technology': 'Monitor AI/ML breakthroughs, dev tools, and infrastructure innovations. Highlight security vulnerabilities and patches.',
    'Health/Wellness': 'Focus on evidence-based research and clinical trials. Track FDA approvals and regulatory changes in healthcare tech.'
  }

  const loadExample = () => {
    setInstructions(exampleInstructions[agent.niche] || '')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card border-2 border-primary/30 max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center">
              <GearSix size={24} className="text-primary" weight="duotone" />
            </div>
            <div>
              <DialogTitle className="text-xl font-bold">{agent.name} Configuration</DialogTitle>
              <DialogDescription className="text-muted-foreground text-sm">
                Customize agent behavior and focus areas
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 mt-4 overflow-y-auto flex-1 pr-1">
          <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Niche:</span>
                <span className="ml-2 font-semibold">{agent.niche}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Personality:</span>
                <span className="ml-2 font-semibold">{agent.personality}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Wallet:</span>
                <span className="ml-2 font-mono text-xs">
                  {agent.walletAddress.slice(0, 10)}...{agent.walletAddress.slice(-8)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Events:</span>
                <span className="ml-2 font-semibold">{agent.eventsAttended}</span>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="instructions" className="text-sm font-semibold">
                Custom Instructions
              </Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={loadExample}
                className="text-xs text-primary hover:text-primary/80"
              >
                Load Example
              </Button>
            </div>
            <Textarea
              id="instructions"
              placeholder={`Example: "Focus on Layer 2 scaling solutions and prioritize technical depth over breadth..."`}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              className="min-h-[200px] font-mono text-sm border-primary/30 focus:border-primary bg-background/50"
            />
            <p className="text-xs text-muted-foreground">
              Provide specific instructions to tune the agent's focus, event selection criteria, and summarization style.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="customAgenda" className="text-sm font-semibold flex items-center gap-2">
                <span>Autonomous Custom Agenda / Interest</span>
                <span className="text-[10px] text-primary font-normal px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20">
                  Proactive Mode
                </span>
              </Label>
            </div>
            <Textarea
              id="customAgenda"
              placeholder="Focus exclusively on Layer 2 scaling solutions and DeFi yield strategies."
              value={customAgenda}
              onChange={(e) => setCustomAgenda(e.target.value)}
              className="min-h-[120px] font-mono text-sm border-accent/30 focus:border-accent bg-background/50"
            />
            <p className="text-xs text-muted-foreground leading-relaxed">
              This agenda will guide your agent when autonomously scouting YouTube videos and asking questions in YouTube Live streams. Be specific about topics of interest.
            </p>
          </div>

          <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
            <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
              Tips for Effective Instructions
            </h4>
            <ul className="text-xs text-muted-foreground space-y-1.5 ml-3">
              <li>• Be specific about topics and keywords to focus on</li>
              <li>• Mention preferred YouTube channels or creators to follow</li>
              <li>• Define the depth and style of summaries you want</li>
              <li>• Specify any topics or sources to avoid</li>
            </ul>
          </div>

          <div className="flex gap-3 pt-4 border-t border-border/30">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 bg-gradient-to-r from-primary to-accent hover:opacity-90 font-semibold"
            >
              <FloppyDisk className="mr-2" weight="duotone" />
              {isSaving ? 'Waiting for signature…' : 'Sign & save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
