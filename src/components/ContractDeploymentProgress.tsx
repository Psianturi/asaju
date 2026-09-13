import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CheckCircle, ArrowRight, Clock, Cube, Lightning } from '@phosphor-icons/react'
import { motion } from 'framer-motion'
import { Agent } from '@/lib/types'
import { config as appConfig } from '@/lib/config'

interface DeploymentStep {
  id: string
  label: string
  status: 'pending' | 'in-progress' | 'complete' | 'error'
  timestamp?: number
  transactionHash?: string
  gasUsed?: string
  details?: string
}

interface ContractDeploymentProgressProps {
  agent: Agent
  isDeploying: boolean
}

export function ContractDeploymentProgress({ agent, isDeploying }: ContractDeploymentProgressProps) {
  const explorerBaseUrl = appConfig.blockchain.explorerUrl

  const steps: DeploymentStep[] = [
    {
      id: 'wallet',
      label: 'Agent wallet registered',
      status: agent.walletAddress ? 'complete' : 'pending',
      details: agent.walletAddress ? 'Wallet address received from the backend.' : 'Awaiting wallet data from the backend.',
    },
    {
      id: 'contract',
      label: 'Contract address available',
      status: agent.contractAddress ? 'complete' : 'pending',
      details: agent.contractAddress ? agent.contractAddress : 'No contract address has been returned yet.',
    },
    {
      id: 'deploy',
      label: 'Deployment transaction recorded',
      status: agent.deploymentTxHash ? 'complete' : isDeploying ? 'in-progress' : 'pending',
      transactionHash: agent.deploymentTxHash,
      details: agent.deploymentTxHash ? 'Transaction hash received from the backend.' : 'Waiting for a real deployment transaction hash.',
    },
    {
      id: 'verify',
      label: 'Explorer verification',
      status: 'pending',
      details: agent.deploymentTxHash ? 'Verification is tracked from the recorded transaction.' : 'Verification starts after a deployment transaction is recorded.',
    },
  ]

  const completedSteps = steps.filter(s => s.status === 'complete').length
  const overallProgress = (completedSteps / steps.length) * 100

  return (
    <Card className="glass-card-hover p-6 border-2 border-primary/20 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-primary/20 to-transparent rounded-full blur-3xl" />
      
      <div className="relative space-y-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/30 to-accent/30 border border-primary/40 flex items-center justify-center">
                <Cube className="text-primary" weight="duotone" size={22} />
              </div>
              <div>
                <h3 className="text-lg font-bold">Contract Deployment</h3>
                <p className="text-xs text-muted-foreground">Agent: {agent.name}</p>
              </div>
            </div>
          </div>
          
          <Badge 
            variant={isDeploying ? 'default' : 'secondary'}
            className="font-semibold"
          >
            {isDeploying ? 'Syncing live status' : completedSteps === steps.length ? 'Complete' : 'Pending'}
          </Badge>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Overall Progress</span>
            <span className="font-mono font-semibold">{Math.round(overallProgress)}%</span>
          </div>
          <Progress value={overallProgress} className="h-2" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{completedSteps} of {steps.length} steps complete</span>
            {isDeploying && (
              <span className="flex items-center gap-1">
                <Clock size={12} weight="fill" />
                ~{(steps.length - completedSteps) * 2}s remaining
              </span>
            )}
          </div>
        </div>

        <div className="space-y-2">
          {steps.map((step) => (
              <div
                key={step.id}
                className={`
                  flex items-start gap-3 p-3 rounded-lg border transition-all duration-300
                  ${step.status === 'complete' 
                    ? 'bg-green-500/10 border-green-500/30' 
                    : step.status === 'in-progress'
                    ? 'bg-primary/10 border-primary/40 shadow-lg shadow-primary/20'
                    : 'bg-card/30 border-border/50'
                  }
                `}
              >
                <div className="flex-shrink-0 mt-0.5">
                  {step.status === 'complete' && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 300 }}
                    >
                      <CheckCircle size={20} className="text-green-500" weight="fill" />
                    </motion.div>
                  )}
                  {step.status === 'in-progress' && (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full"
                    />
                  )}
                  {step.status === 'pending' && (
                    <div className="w-5 h-5 border-2 border-muted-foreground/30 rounded-full" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-sm font-medium ${
                      step.status === 'complete' ? 'text-green-500' :
                      step.status === 'in-progress' ? 'text-primary' :
                      'text-muted-foreground'
                    }`}>
                      {step.label}
                    </p>
                    {step.status === 'in-progress' && (
                      <Badge variant="outline" className="text-xs border-primary/40 text-primary">
                        Processing
                      </Badge>
                    )}
                  </div>

                  {step.details && (
                    <p className="text-xs text-muted-foreground mt-1">{step.details}</p>
                  )}

                  {step.transactionHash && (
                    <div className="flex items-center gap-2 mt-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs font-mono hover:bg-primary/10"
                        onClick={() => window.open(`${explorerBaseUrl}/tx/${step.transactionHash}`, '_blank')}
                      >
                        <span className="truncate max-w-[200px]">{step.transactionHash}</span>
                        <ArrowRight size={12} className="ml-1 flex-shrink-0" />
                      </Button>
                    </div>
                  )}

                  {step.gasUsed && (
                    <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                      <Lightning size={12} weight="fill" className="text-amber-500" />
                      <span>Gas: {step.gasUsed} MNT</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
        </div>

        {completedSteps === steps.length && !isDeploying && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="pt-4 border-t border-border"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle size={20} className="text-green-500" weight="fill" />
                <span className="text-sm font-semibold text-green-500">Deployment Complete</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => window.open(`${explorerBaseUrl}/address/${agent.walletAddress}`, '_blank')}
              >
                View on Explorer
                <ArrowRight size={14} className="ml-1" />
              </Button>
            </div>
          </motion.div>
        )}
      </div>
    </Card>
  )
}
