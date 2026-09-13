import { useState, startTransition } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Agent, BreedingResult } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Sparkle, Lightning, ArrowsLeftRight, Plus, Dna, Check, X } from '@phosphor-icons/react'
import { motion, AnimatePresence } from 'framer-motion'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import { cloudRunService } from '@/services/cloudRunService'
import { BrowserProvider, Contract, parseEther, keccak256, toUtf8Bytes } from 'ethers'
import { CONTRACT_ADDRESSES } from '@/lib/blockchain/config'

const BREED_ABI = [
  {
    inputs: [
      { name: 'parent1Wallet', type: 'address' },
      { name: 'parent2Wallet', type: 'address' },
      { name: 'offspringId', type: 'bytes32' },
      { name: 'generation', type: 'uint256' },
      { name: 'heritageScore', type: 'uint256' },
    ],
    name: 'breedAgents',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
] as const

type BreedStep = 'idle' | 'awaiting-wallet' | 'confirming-tx' | 'creating-offspring'

interface AgentBreedingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agents: Agent[]
  onBreedComplete: (result: BreedingResult, offspringName: string) => void
  userBalance: number
  userWallet: string
}

export function AgentBreedingDialog({
  open,
  onOpenChange,
  agents,
  onBreedComplete,
  userBalance,
  userWallet,
}: AgentBreedingDialogProps) {
  const [selectedParent1, setSelectedParent1] = useState<Agent | null>(null)
  const [selectedParent2, setSelectedParent2] = useState<Agent | null>(null)
  const [offspringName, setOffspringName] = useState('')
  const [isBreeding, setIsBreeding] = useState(false)
  const [breedingProgress, setBreedingProgress] = useState(0)
  const [breedStep, setBreedStep] = useState<BreedStep>('idle')
  const [showResult, setShowResult] = useState(false)
  const [breedingResult, setBreedingResult] = useState<BreedingResult | null>(null)

  const BREEDING_COST = 2.5

  const eligibleAgents = agents.filter(a => 
    a.wisdomUnlocked && 
    (a.breedingCount ?? 0) < (a.maxBreedings ?? 3)
  )

  const canBreed = selectedParent1 &&
                   selectedParent2 &&
                   selectedParent1.id !== selectedParent2.id &&
                   offspringName.trim().length > 0 &&
                   userBalance >= BREEDING_COST

  // Display-only: used after backend returns the real offspring
  const getInheritedTraits = (p1: Agent, p2: Agent) => {
    const traits: { from: string; trait: string }[] = []
    traits.push({ from: p1.name, trait: `${p1.niche} Domain Expertise` })
    traits.push({ from: p2.name, trait: `${p2.niche} Domain Expertise` })
    traits.push({ from: p1.name, trait: `${p1.personality} Strategy Patterns` })
    traits.push({ from: p2.name, trait: `${p2.personality} Analysis Methods` })
    if (p1.customInstructions) traits.push({ from: p1.name, trait: 'Custom Protocol Library' })
    if (p2.customInstructions) traits.push({ from: p2.name, trait: 'Advanced Instruction Set' })
    return traits
  }

  const handleBreed = async () => {
    if (!canBreed || !selectedParent1 || !selectedParent2) return

    setIsBreeding(true)
    setBreedingProgress(0)
    setBreedStep('awaiting-wallet')

    let breedTxHash: string | undefined

    // ── Phase 1: On-chain payment via MetaMask ─────────────────────────────
    if (window.ethereum) {
      try {
        const provider = new BrowserProvider(window.ethereum as any)
        const signer = await provider.getSigner()
        const contractAddress = CONTRACT_ADDRESSES.sepolia.MAEF_NFT
        const contract = new Contract(contractAddress, BREED_ABI, signer)

        // Unique key per breed attempt (timestamp prevents on-chain replay)
        const offspringKey = keccak256(
          toUtf8Bytes(`${selectedParent1.id}:${selectedParent2.id}:${offspringName}:${Date.now()}`)
        )

        // V4 breedAgents() requires 5 params: p1, p2, offspringId, generation, heritageScore
        const offspringGeneration = BigInt(
          Math.max(selectedParent1.generation ?? 1, selectedParent2.generation ?? 1) + 1
        )
        const offspringHeritageScore = BigInt(
          Math.min(100, Math.round(
            ((selectedParent1.wisdomHeritageScore ?? 0) + (selectedParent2.wisdomHeritageScore ?? 0)) / 2
          ))
        )

        toast.info('Confirm the 2.5 MNT transaction in MetaMask...')
        const tx = await contract.breedAgents(
          selectedParent1.walletAddress,
          selectedParent2.walletAddress,
          offspringKey,
          offspringGeneration,
          offspringHeritageScore,
          { value: parseEther('2.5') }
        )

        setBreedingProgress(20)
        setBreedStep('confirming-tx')
        toast.info('Transaction submitted — waiting for on-chain confirmation...')

        await tx.wait()
        breedTxHash = tx.hash
        setBreedingProgress(50)
        toast.success(`Paid 2.5 MNT on-chain ✓`)
      } catch (error) {
        setIsBreeding(false)
        setBreedingProgress(0)
        setBreedStep('idle')
        const msg = error instanceof Error ? error.message : 'Unknown error'
        if (msg.toLowerCase().includes('user rejected') || msg.toLowerCase().includes('user denied')) {
          toast.error('Transaction cancelled')
        } else {
          toast.error('On-chain payment failed', { description: msg.slice(0, 120) })
        }
        return
      }
    }

    // ── Phase 2: Backend creates offspring ─────────────────────────────────
    setBreedStep('creating-offspring')
    const tick = setInterval(() => {
      setBreedingProgress(prev => (prev < 90 ? prev + 8 : prev))
    }, 600)

    try {
      const offspring = await cloudRunService.breedAgents({
        userWallet,
        parent1Id: selectedParent1.id,
        parent2Id: selectedParent2.id,
        offspringName,
        breedTxHash,
      })

      clearInterval(tick)
      setBreedingProgress(100)

      const inheritedTraits = getInheritedTraits(selectedParent1, selectedParent2)
      const result: BreedingResult = {
        offspring,
        inheritedTraits,
        wisdomMerge: {
          parent1Events: selectedParent1.eventsAttended,
          parent2Events: selectedParent2.eventsAttended,
          inheritedWisdom: offspring.eventsAttended,
        },
        geneticBonus: offspring.geneticTraits ?? [],
      }

      setBreedingResult(result)
      setIsBreeding(false)
      setBreedStep('idle')
      setShowResult(true)
    } catch (error) {
      clearInterval(tick)
      setIsBreeding(false)
      setBreedingProgress(0)
      setBreedStep('idle')
      const msg = error instanceof Error ? error.message : 'Unknown error'
      toast.error('Breeding failed', { description: msg })
      if (breedTxHash) {
        toast.info(`Note: 2.5 MNT was paid (tx: ${breedTxHash.slice(0, 10)}…). Retry to complete breeding.`)
      }
    }
  }

  const handleConfirm = () => {
    if (breedingResult) {
      onBreedComplete(breedingResult, offspringName)
      handleReset()
      onOpenChange(false)
    }
  }

  const handleReset = () => {
    setSelectedParent1(null)
    setSelectedParent2(null)
    setOffspringName('')
    setIsBreeding(false)
    setBreedingProgress(0)
    setBreedStep('idle')
    setShowResult(false)
    setBreedingResult(null)
  }

  return (
    <Dialog open={open} onOpenChange={(open) => {
      onOpenChange(open)
      if (!open) handleReset()
    }}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto glass-card border-2 border-primary/30">
        <DialogHeader>
          <DialogTitle className="text-3xl font-bold flex items-center gap-3">
            <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-secondary/30 via-accent/30 to-primary/30 border-2 border-secondary/40 flex items-center justify-center animate-glow-pulse-purple shadow-2xl shadow-secondary/30">
              <Dna size={32} className="text-secondary" weight="duotone" />
            </div>
            <div className="flex flex-col">
              <span className="bg-gradient-to-r from-secondary via-accent to-primary bg-clip-text text-transparent">
                Neural Fusion Lab
              </span>
              <span className="text-xs text-muted-foreground font-normal">Advanced Genetic Engineering</span>
            </div>
          </DialogTitle>
          <DialogDescription className="text-base mt-2">
            Merge wisdom from two agents to create a superior offspring with inherited traits and knowledge. This process burns MNT tokens to sustain the Agentic Economy.
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {!showResult ? (
            <motion.div
              key="breeding-form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              <Card className="p-6 bg-gradient-to-br from-amber-500/5 via-orange-500/10 to-amber-500/5 border-2 border-amber-500/30 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-500/5 to-transparent animate-pulse" />
                <div className="relative flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center flex-shrink-0">
                    <Sparkle size={24} className="text-amber-500" weight="duotone" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-amber-500 mb-3 text-lg">Neural Fusion Requirements</h4>
                    <ul className="text-sm text-foreground/90 space-y-2">
                      <li className="flex items-start gap-2">
                        <span className="text-amber-500 flex-shrink-0">✓</span>
                        <span>Both parents must have <span className="font-semibold text-amber-400">Wisdom Unlocked</span> (5+ videos analyzed)</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-amber-500 flex-shrink-0">✓</span>
                        <span>Each agent can participate in up to <span className="font-semibold text-amber-400">3 breeding cycles</span></span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-amber-500 flex-shrink-0">✓</span>
                        <span>Fusion Cost: <span className="font-bold text-amber-400 text-base">{BREEDING_COST} MNT</span> (burned to sustain economy)</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-amber-500 flex-shrink-0">✓</span>
                        <span>Offspring inherits <span className="font-semibold text-amber-400">~33% of combined parent wisdom</span></span>
                      </li>
                    </ul>
                  </div>
                </div>
              </Card>

              {eligibleAgents.length < 2 && (
                <Card className="p-5 bg-gradient-to-br from-red-500/5 to-red-500/10 border-2 border-red-500/30">
                  <div className="flex items-start gap-3">
                    <X size={24} className="text-red-500 flex-shrink-0 mt-0.5" weight="duotone" />
                    <div>
                      <h4 className="font-bold text-red-500 mb-1">Insufficient Eligible Agents</h4>
                      <p className="text-sm text-foreground/90">
                        You need at least 2 agents with Wisdom Unlocked to breed. Attend more events with your agents!
                      </p>
                    </div>
                  </div>
                </Card>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <Label className="text-lg font-semibold flex items-center gap-2 mb-1">
                    <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center">
                      <span className="text-primary font-bold">A</span>
                    </div>
                    <span>Parent Alpha</span>
                    {selectedParent1 && <Check size={20} className="text-green-500" weight="bold" />}
                  </Label>
                  <div className="space-y-3 max-h-[300px] overflow-y-auto custom-scrollbar">
                    {eligibleAgents.map((agent) => (
                      <Card
                        key={agent.id}
                        className={`p-4 cursor-pointer transition-all duration-300 ${
                          selectedParent1?.id === agent.id
                            ? 'bg-gradient-to-br from-primary/20 to-accent/20 border-2 border-primary shadow-lg shadow-primary/30'
                            : selectedParent2?.id === agent.id
                            ? 'opacity-50 cursor-not-allowed'
                            : 'glass-card-hover border border-primary/20'
                        }`}
                        onClick={() => {
                          if (selectedParent2?.id !== agent.id) {
                            startTransition(() => setSelectedParent1(agent))
                          }
                        }}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h4 className="font-bold text-lg mb-1">{agent.name}</h4>
                            <div className="flex flex-wrap gap-2 mb-2">
                              <Badge variant="outline" className="text-xs">{agent.niche}</Badge>
                              <Badge variant="outline" className="text-xs">{agent.personality}</Badge>
                              <Badge className="text-xs bg-secondary/20 text-secondary">Gen {agent.generation ?? 1}</Badge>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                              <span>Level {agent.level}</span>
                              <span>•</span>
                              <span>{agent.eventsAttended} Events</span>
                              <span>•</span>
                              <span>Breeds: {agent.breedingCount ?? 0}/{agent.maxBreedings ?? 3}</span>
                            </div>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <Label className="text-lg font-semibold flex items-center gap-2 mb-1">
                    <div className="w-8 h-8 rounded-lg bg-secondary/20 border border-secondary/40 flex items-center justify-center">
                      <span className="text-secondary font-bold">B</span>
                    </div>
                    <span>Parent Beta</span>
                    {selectedParent2 && <Check size={20} className="text-green-500" weight="bold" />}
                  </Label>
                  <div className="space-y-3 max-h-[300px] overflow-y-auto custom-scrollbar">
                    {eligibleAgents.map((agent) => (
                      <Card
                        key={agent.id}
                        className={`p-4 cursor-pointer transition-all duration-300 ${
                          selectedParent2?.id === agent.id
                            ? 'bg-gradient-to-br from-secondary/20 to-accent/20 border-2 border-secondary shadow-lg shadow-secondary/30'
                            : selectedParent1?.id === agent.id
                            ? 'opacity-50 cursor-not-allowed'
                            : 'glass-card-hover border border-primary/20'
                        }`}
                        onClick={() => {
                          if (selectedParent1?.id !== agent.id) {
                            startTransition(() => setSelectedParent2(agent))
                          }
                        }}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h4 className="font-bold text-lg mb-1">{agent.name}</h4>
                            <div className="flex flex-wrap gap-2 mb-2">
                              <Badge variant="outline" className="text-xs">{agent.niche}</Badge>
                              <Badge variant="outline" className="text-xs">{agent.personality}</Badge>
                              <Badge className="text-xs bg-secondary/20 text-secondary">Gen {agent.generation ?? 1}</Badge>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                              <span>Level {agent.level}</span>
                              <span>•</span>
                              <span>{agent.eventsAttended} Events</span>
                              <span>•</span>
                              <span>Breeds: {agent.breedingCount ?? 0}/{agent.maxBreedings ?? 3}</span>
                            </div>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              </div>

              {selectedParent1 && selectedParent2 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <Card className="p-6 bg-gradient-to-br from-primary/10 via-secondary/10 to-accent/10 border-2 border-primary/30 relative overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,243,255,0.1),transparent_70%)]" />
                    <div className="relative">
                      <h4 className="font-bold mb-4 flex items-center gap-2 text-lg">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/30 to-secondary/30 border border-primary/40 flex items-center justify-center">
                          <Lightning size={22} className="text-primary" weight="fill" />
                        </div>
                        <span>Predicted Genetic Output</span>
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm mb-5">
                        <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                          <p className="text-muted-foreground mb-1 text-xs uppercase tracking-wider">Inherited Wisdom</p>
                          <p className="font-bold text-primary text-lg">
                            {Math.floor((selectedParent1.eventsAttended + selectedParent2.eventsAttended) / 3) + Math.floor((selectedParent1.level + selectedParent2.level) / 4)} Events
                          </p>
                        </div>
                        <div className="p-3 rounded-lg bg-secondary/10 border border-secondary/20">
                          <p className="text-muted-foreground mb-1 text-xs uppercase tracking-wider">Starting Level</p>
                          <p className="font-bold text-secondary text-lg">
                            Level {Math.max(1, Math.floor((Math.floor((selectedParent1.eventsAttended + selectedParent2.eventsAttended) / 3) + Math.floor((selectedParent1.level + selectedParent2.level) / 4)) / 3) + 1)}
                          </p>
                        </div>
                        <div className="p-3 rounded-lg bg-accent/10 border border-accent/20">
                          <p className="text-muted-foreground mb-1 text-xs uppercase tracking-wider">Generation</p>
                          <p className="font-bold text-accent text-lg">
                            Gen {Math.max(selectedParent1.generation ?? 1, selectedParent2.generation ?? 1) + 1}
                          </p>
                        </div>
                      </div>
                      <div>
                        <p className="text-muted-foreground mb-3 text-sm font-semibold">Genetic Enhancement Matrix:</p>
                        <div className="flex flex-wrap gap-2">
                          {[
                            selectedParent1.niche === selectedParent2.niche ? 'Specialized Niche Mastery' : 'Cross-Domain Intelligence',
                            selectedParent1.personality === selectedParent2.personality ? 'Enhanced Personality Traits' : 'Adaptive Personality Matrix',
                            ...(selectedParent1.eventsAttended + selectedParent2.eventsAttended >= 15 ? ['Legendary Wisdom Heritage'] :
                               selectedParent1.eventsAttended + selectedParent2.eventsAttended >= 10 ? ['Superior Knowledge Base'] : []),
                          ].map((bonus, idx) => (
                            <Badge key={idx} className="bg-gradient-to-r from-primary/20 to-secondary/20 text-foreground border border-primary/30 px-3 py-1.5">
                              <Sparkle size={12} className="mr-1.5" weight="fill" />
                              {bonus}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </Card>

                  <div className="space-y-3">
                    <Label htmlFor="offspring-name" className="text-base font-semibold flex items-center gap-2">
                      <Sparkle size={18} className="text-primary" weight="duotone" />
                      Offspring Identity
                    </Label>
                    <Input
                      id="offspring-name"
                      placeholder="Enter a name for the hybrid agent..."
                      value={offspringName}
                      onChange={(e) => setOffspringName(e.target.value)}
                      className="border-2 border-primary/30 focus:border-primary font-semibold text-lg h-12"
                    />
                  </div>
                </motion.div>
              )}

              {isBreeding && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="space-y-4"
                >
                  <Card className="p-6 bg-gradient-to-br from-primary/10 to-secondary/10 border-2 border-primary/30">
                    <div className="flex items-center justify-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center animate-pulse">
                        <ArrowsLeftRight size={24} className="text-primary" weight="bold" />
                      </div>
                      <span className="text-xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                        Neural Fusion In Progress
                      </span>
                    </div>
                    <Progress value={breedingProgress} className="h-4 mb-3" />
                    <p className="text-sm text-center text-muted-foreground font-mono">
                      {breedStep === 'awaiting-wallet' && '[1/3] Waiting for MetaMask signature...'}
                      {breedStep === 'confirming-tx' && '[2/3] Confirming 2.5 MNT on-chain payment...'}
                      {breedStep === 'creating-offspring' && '[3/3] Synthesizing genetic traits and knowledge matrices...'}
                    </p>
                  </Card>
                </motion.div>
              )}

              <div className="flex gap-3 justify-end pt-4 border-t border-primary/20">
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isBreeding}
                  className="border-primary/30"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleBreed}
                  disabled={!canBreed || isBreeding}
                  size="lg"
                  className="bg-gradient-to-r from-secondary via-accent to-primary hover:opacity-90 font-bold shadow-2xl shadow-secondary/40 text-base"
                >
                  {isBreeding ? (
                    <>
                      <Sparkle className="mr-2 animate-spin" weight="fill" size={20} />
                      Initiating Neural Fusion...
                    </>
                  ) : (
                    <>
                      <Dna className="mr-2" weight="duotone" size={20} />
                      Initiate Neural Fusion ({BREEDING_COST} MNT)
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="breeding-result"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-6"
            >
              <Card className="p-10 bg-gradient-to-br from-primary/10 via-secondary/10 to-accent/10 border-2 border-primary/40 text-center relative overflow-hidden">
                <div className="absolute inset-0">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/10 to-secondary/10 animate-pulse" />
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(157,0,255,0.15),transparent_70%)]" />
                </div>
                <div className="relative">
                  <div className="w-28 h-28 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-secondary/40 via-accent/40 to-primary/40 border-2 border-secondary/50 flex items-center justify-center animate-glow-pulse-purple shadow-2xl">
                    <Sparkle size={56} className="text-secondary" weight="fill" />
                  </div>
                  <h3 className="text-4xl font-bold mb-4 bg-gradient-to-r from-secondary via-accent to-primary bg-clip-text text-transparent">
                    🧬 Neural Fusion Complete!
                  </h3>
                  <p className="text-2xl font-bold mb-3 text-foreground">{breedingResult?.offspring.name}</p>
                  <p className="text-sm text-muted-foreground mb-4">Hybrid Intelligence Created</p>
                  <div className="flex items-center justify-center gap-3 text-sm">
                    <Badge className="bg-primary/20 text-primary border border-primary/30 px-3 py-1.5">
                      Gen {breedingResult?.offspring.generation}
                    </Badge>
                    <Badge variant="outline" className="border-primary/30 px-3 py-1.5">{breedingResult?.offspring.niche}</Badge>
                    <Badge variant="outline" className="border-secondary/30 px-3 py-1.5">{breedingResult?.offspring.personality}</Badge>
                  </div>
                </div>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="p-5 glass-card border border-primary/20">
                  <h4 className="font-bold mb-3 flex items-center gap-2">
                    <Dna size={20} className="text-primary" weight="duotone" />
                    Wisdom Merge
                  </h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Parent 1 Events:</span>
                      <span className="font-semibold">{breedingResult?.wisdomMerge.parent1Events}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Parent 2 Events:</span>
                      <span className="font-semibold">{breedingResult?.wisdomMerge.parent2Events}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-primary/20">
                      <span className="text-muted-foreground">Inherited Wisdom:</span>
                      <span className="font-bold text-primary">{breedingResult?.wisdomMerge.inheritedWisdom} Events</span>
                    </div>
                  </div>
                </Card>

                <Card className="p-5 glass-card border border-secondary/20">
                  <h4 className="font-bold mb-3 flex items-center gap-2">
                    <Lightning size={20} className="text-secondary" weight="fill" />
                    Genetic Bonuses
                  </h4>
                  <div className="space-y-2">
                    {breedingResult?.geneticBonus.map((bonus, idx) => (
                      <div key={idx} className="flex items-start gap-2">
                        <Plus size={16} className="text-secondary flex-shrink-0 mt-0.5" weight="bold" />
                        <span className="text-sm">{bonus}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              <Card className="p-5 glass-card border border-accent/20">
                <h4 className="font-bold mb-3">Inherited Traits</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {breedingResult?.inheritedTraits.map((trait, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-sm">
                      <Badge variant="outline" className="text-xs flex-shrink-0">{trait.from}</Badge>
                      <span className="text-muted-foreground">{trait.trait}</span>
                    </div>
                  ))}
                </div>
              </Card>

              <div className="flex gap-3 justify-end pt-4 border-t border-primary/20">
                <Button
                  onClick={handleConfirm}
                  className="bg-gradient-to-r from-secondary to-accent hover:opacity-90 font-semibold shadow-lg shadow-secondary/30"
                >
                  <Check className="mr-2" weight="bold" />
                  Add to Dashboard
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  )
}
