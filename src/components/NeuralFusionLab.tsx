import { motion } from 'framer-motion'
import { Dna } from '@phosphor-icons/react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { NicheAvatar } from '@/components/NicheAvatar'
import { FusionCooldownTimer } from '@/components/FusionCooldownTimer'
import { BreedingCooldownBoost } from '@/components/BreedingCooldownBoost'
import { Agent } from '@/lib/types'

interface NeuralFusionLabProps {
  agents: Agent[]
  walletConnected: boolean
  userBalance: number
  onConnectWallet: () => void
  onInitiateFusion: () => void
  onCooldownBoost: (agentId: string) => void
}

export function NeuralFusionLab({
  agents,
  walletConnected,
  userBalance,
  onConnectWallet,
  onInitiateFusion,
  onCooldownBoost,
}: NeuralFusionLabProps) {
  const wisdomUnlockedCount = agents.filter(a => a.wisdomUnlocked).length

  return (
    <Card className="glass-card-hover p-5 border border-accent/30">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-accent/20 border border-accent/40 flex items-center justify-center">
            <Dna className="text-accent" weight="duotone" size={20} />
          </div>
          <div>
            <h3 className="text-base font-bold">Neural Fusion Lab</h3>
            <p className="text-xs text-muted-foreground">Merge wisdom-unlocked agents to breed powerful hybrids</p>
          </div>
        </div>
        <Button
          onClick={!walletConnected ? onConnectWallet : onInitiateFusion}
          disabled={walletConnected && wisdomUnlockedCount < 2}
          size="sm"
          className="bg-gradient-to-r from-accent to-secondary hover:opacity-90 font-semibold shadow-lg shadow-accent/20"
        >
          <Dna className="mr-1.5" weight="duotone" size={14} />
          {!walletConnected ? 'Connect to Fuse' : 'Initiate Fusion'}
        </Button>
      </div>
      {walletConnected && wisdomUnlockedCount < 2 && (
        <p className="text-xs text-muted-foreground">
          Need {Math.max(0, 2 - wisdomUnlockedCount)} more wisdom-unlocked agent(s) — analyze more videos to unlock
        </p>
      )}
      {/* Fusion status only — the full agent cards are already shown above,
          rendering them a second time here doubled the page. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-4">
        {agents.map((agent, idx) => {
          const isOnCooldown = !!agent.lastBreedingTime && !!agent.breedingCooldownHours &&
            (Date.now() - agent.lastBreedingTime) < (agent.breedingCooldownHours * 60 * 60 * 1000)
          const status = isOnCooldown ? 'Cooling down' : agent.wisdomUnlocked ? 'Ready to fuse' : 'Wisdom locked'
          return (
            <motion.div
              key={agent.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04 }}
              className="rounded-lg border border-border/50 bg-white/[0.02] px-3 py-2.5 space-y-2"
            >
              <div className="flex items-center gap-2.5">
                <NicheAvatar agent={agent} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{agent.name}</p>
                  <p className="text-[11px] text-muted-foreground">Gen {agent.generation ?? 1} · Lv {agent.level}</p>
                </div>
                <span className={
                  'text-[10px] rounded px-1.5 py-0.5 border shrink-0 ' + (isOnCooldown
                    ? 'border-sky-400/40 text-sky-300'
                    : agent.wisdomUnlocked ? 'border-emerald-500/40 text-emerald-300' : 'border-border/60 text-muted-foreground')
                }>
                  {status}
                </span>
              </div>
              {isOnCooldown && (
                <div className="space-y-2">
                  <FusionCooldownTimer agent={agent} />
                  <BreedingCooldownBoost agent={agent} userBalance={userBalance} onBoost={onCooldownBoost} />
                </div>
              )}
            </motion.div>
          )
        })}
      </div>
    </Card>
  )
}
