import { Agent, RarityTier } from '@/lib/types'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { TreeStructure, Robot, Lightning, TrendUp, Brain, Dna } from '@phosphor-icons/react'
import { motion } from 'framer-motion'
import { cn, calculateRarityTier, getRarityStyles } from '@/lib/utils'

interface AgentLineageTreeProps {
  agent: Agent
  allAgents: Agent[]
}

const personalityIcons = {
  Aggressive: Lightning,
  Analytical: TrendUp,
  Creative: Brain
}

export function AgentLineageTree({ agent, allAgents }: AgentLineageTreeProps) {
  const hasParents = agent.parentIds && agent.parentIds.length > 0
  
  if (!hasParents) {
    return (
      <Card className="glass-card p-8 text-center border-2 border-dashed border-primary/30">
        <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center">
          <TreeStructure size={32} className="text-primary/50" weight="duotone" />
        </div>
        <h3 className="text-lg font-semibold mb-2 text-muted-foreground">Genesis Agent</h3>
        <p className="text-sm text-muted-foreground/70 max-w-md mx-auto">
          This is an original genesis agent with no genetic lineage. It was spawned directly from the factory.
        </p>
      </Card>
    )
  }

  const parent1 = allAgents.find(a => a.id === agent.parentIds![0])
  const parent2 = allAgents.find(a => a.id === agent.parentIds![1])
  
  const parent1Rarity = parent1 ? calculateRarityTier(parent1) : 'common'
  const parent2Rarity = parent2 ? calculateRarityTier(parent2) : 'common'
  const agentRarity = calculateRarityTier(agent)
  const parent1Styles = getRarityStyles(parent1Rarity)
  const parent2Styles = getRarityStyles(parent2Rarity)
  const agentStyles = getRarityStyles(agentRarity)
  
  const getGradientColor = (rarity: RarityTier): string => {
    switch (rarity) {
      case 'mythic': return '#f59e0b'
      case 'legendary': return '#fb923c'
      case 'epic': return '#9d00ff'
      case 'rare': return '#00f3ff'
      default: return '#6b7280'
    }
  }

  const ParentNode = ({ parent, position }: { parent?: Agent; position: 'left' | 'right' }) => {
    if (!parent) {
      return (
        <div className="glass-card p-4 border-2 border-dashed border-muted/30 opacity-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-muted/20 flex items-center justify-center">
              <Robot size={20} className="text-muted-foreground" weight="duotone" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Parent Not Found</p>
            </div>
          </div>
        </div>
      )
    }

    const PersonalityIcon = personalityIcons[parent.personality]
    const parentRarity = calculateRarityTier(parent)
    const parentRarityStyles = getRarityStyles(parentRarity)

    return (
      <TooltipProvider>
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <motion.div
              initial={{ opacity: 0, scale: 0.8, x: position === 'left' ? -20 : 20 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              transition={{ delay: 0.2, duration: 0.4, ease: "easeOut" }}
              whileHover={{ scale: 1.05, y: -5 }}
              className="cursor-pointer"
            >
              <Card className={cn(
                "glass-card p-4 transition-all duration-300 group relative overflow-hidden",
                parentRarityStyles.borderClass,
                parentRarity !== 'common' && parentRarityStyles.glowClass
              )}>
                <div className="absolute top-0 right-0 w-20 h-20 bg-primary/10 rounded-full blur-2xl -mr-10 -mt-10 group-hover:bg-primary/20 transition-all duration-500" />
                <div className="relative">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/30 to-secondary/30 border border-primary/40 flex items-center justify-center">
                      <Robot size={20} className="text-primary" weight="duotone" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-sm truncate">{parent.name}</h4>
                      <p className="text-[10px] text-muted-foreground font-mono">
                        {parent.walletAddress.slice(0, 6)}...{parent.walletAddress.slice(-4)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/30">
                      <PersonalityIcon size={10} className="mr-1" />
                      {parent.personality}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-secondary/30">
                      Lv.{parent.level}
                    </Badge>
                    {parent.generation && parent.generation > 1 && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-accent/30">
                        Gen-{parent.generation}
                      </Badge>
                    )}
                  </div>
                </div>
              </Card>
            </motion.div>
          </TooltipTrigger>
          <TooltipContent side="top" className="glass-card border-primary/30">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Niche:</span>
                <span className="text-sm font-semibold text-primary">{parent.niche}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Videos Analyzed:</span>
                <span className="text-sm font-semibold">{parent.eventsAttended}</span>
              </div>
              {parent.wisdomUnlocked && (
                <div className="flex items-center gap-2 text-amber-500">
                  <Brain size={12} weight="fill" />
                  <span className="text-xs font-bold">Wisdom Unlocked</span>
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-center gap-3 mb-4">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-primary/50 to-primary/50" />
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg glass-card border border-primary/30">
          <Dna size={20} className="text-primary" weight="duotone" />
          <span className="font-bold text-sm">Genetic Lineage</span>
        </div>
        <div className="h-px flex-1 bg-gradient-to-l from-transparent via-primary/50 to-primary/50" />
      </div>

      <div className="relative">
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div className="relative">
            <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2 translate-y-full">
              <div 
                className="w-px h-8"
                style={{
                  background: `linear-gradient(to bottom, ${getGradientColor(parent1Rarity)}, ${getGradientColor(agentRarity)})`
                }}
              />
            </div>
            <ParentNode parent={parent1} position="left" />
          </div>
          <div className="relative">
            <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2 translate-y-full">
              <div 
                className="w-px h-8"
                style={{
                  background: `linear-gradient(to bottom, ${getGradientColor(parent2Rarity)}, ${getGradientColor(agentRarity)})`
                }}
              />
            </div>
            <ParentNode parent={parent2} position="right" />
          </div>
        </div>

        <div className="relative flex items-center justify-center mb-6">
          <div 
            className="absolute top-0 left-1/4 w-1/2 h-px"
            style={{
              background: `linear-gradient(to right, ${getGradientColor(parent1Rarity)}, ${getGradientColor(parent2Rarity)})`
            }}
          />
          <div className="relative z-10 w-6 h-6 rounded-full bg-gradient-to-br from-primary via-accent to-secondary border-2 border-background flex items-center justify-center">
            <motion.div
              animate={{
                scale: [1, 1.2, 1],
                rotate: [0, 180, 360]
              }}
              transition={{
                duration: 3,
                repeat: Infinity,
                ease: "easeInOut"
              }}
            >
              <Dna size={12} className="text-background" weight="bold" />
            </motion.div>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.4 }}
          className="relative"
        >
          <Card className={cn(
            "glass-card p-6 border-2 mx-auto max-w-md relative overflow-hidden",
            agent.generation && agent.generation >= 3 
              ? "border-transparent bg-gradient-to-br from-amber-500/10 via-orange-500/10 to-red-500/10" 
              : "border-accent/50"
          )}>
            {agent.generation && agent.generation >= 3 && (
              <>
                <div className="absolute inset-0 rounded-lg">
                  <motion.div
                    className="absolute inset-0 rounded-lg"
                    animate={{
                      background: [
                        'linear-gradient(0deg, rgba(245,158,11,0.3) 0%, rgba(251,146,60,0.3) 50%, rgba(239,68,68,0.3) 100%)',
                        'linear-gradient(120deg, rgba(245,158,11,0.3) 0%, rgba(251,146,60,0.3) 50%, rgba(239,68,68,0.3) 100%)',
                        'linear-gradient(240deg, rgba(245,158,11,0.3) 0%, rgba(251,146,60,0.3) 50%, rgba(239,68,68,0.3) 100%)',
                        'linear-gradient(360deg, rgba(245,158,11,0.3) 0%, rgba(251,146,60,0.3) 50%, rgba(239,68,68,0.3) 100%)',
                      ]
                    }}
                    transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                    style={{
                      filter: 'blur(1px)',
                      border: '2px solid transparent',
                      borderImage: 'linear-gradient(45deg, #f59e0b, #fb923c, #ef4444) 1',
                    }}
                  />
                </div>
                <div className="absolute top-2 right-2 z-20">
                  <Badge className="bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[10px] font-bold px-2 py-0.5 shadow-lg shadow-amber-500/50 border-none animate-pulse">
                    ✨ MYTHIC GEN-{agent.generation}
                  </Badge>
                </div>
              </>
            )}
            
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent/30 to-secondary/30 border-2 border-accent/40 flex items-center justify-center">
                  <Robot size={24} className="text-accent" weight="duotone" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-lg">{agent.name}</h3>
                  <p className="text-xs text-muted-foreground font-mono">
                    {agent.walletAddress.slice(0, 6)}...{agent.walletAddress.slice(-4)}
                  </p>
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Generation</span>
                  <span className="font-bold text-accent">Gen-{agent.generation || 1}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Niche</span>
                  <span className="font-semibold">{agent.niche}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Level</span>
                  <span className="font-semibold">Level {agent.level}</span>
                </div>
                {agent.geneticTraits && agent.geneticTraits.length > 0 && (
                  <div className="pt-2 mt-2 border-t border-border/50">
                    <p className="text-xs text-muted-foreground mb-2">Inherited Traits</p>
                    <div className="flex flex-wrap gap-1.5">
                      {agent.geneticTraits.map((trait, idx) => (
                        <Badge key={idx} variant="outline" className="text-[10px] px-2 py-0 border-accent/30 text-accent">
                          {trait}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </motion.div>
      </div>
    </div>
  )
}
