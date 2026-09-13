import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cloudRunService } from '@/services/cloudRunService'
import { CheckCircle, XCircle, ArrowsClockwise, CloudCheck } from '@phosphor-icons/react'
import { motion } from 'framer-motion'

interface BackendHealthModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onHealthConfirmed: () => void
}

export function BackendHealthModal({ open, onOpenChange, onHealthConfirmed }: BackendHealthModalProps) {
  const [status, setStatus] = useState<'checking' | 'healthy' | 'error'>('checking')
  const [version, setVersion] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const [retryCount, setRetryCount] = useState(0)

  const checkHealth = async () => {
    setStatus('checking')
    setErrorMessage('')
    
    try {
      const result = await cloudRunService.healthCheck()
      setStatus('healthy')
      setVersion(result.version || 'v1.0.0')
      setTimeout(() => {
        onHealthConfirmed()
        onOpenChange(false)
      }, 1500)
    } catch (error) {
      setStatus('error')
      if (error instanceof Error) {
        setErrorMessage(error.message)
      } else {
        setErrorMessage('Backend service is not responding. Please try again.')
      }
    }
  }

  useEffect(() => {
    if (open && status === 'checking' && retryCount === 0) {
      checkHealth()
    }
  }, [open, retryCount])

  const handleRetry = () => {
    setRetryCount(prev => prev + 1)
    checkHealth()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card border-2 border-primary/30 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 text-2xl">
            <div className="w-10 h-10 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center">
              <CloudCheck className="text-primary" weight="duotone" size={24} />
            </div>
            <span>Backend Connection</span>
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Checking connection to Cloud Run service...
          </DialogDescription>
        </DialogHeader>

        <div className="py-8 flex flex-col items-center justify-center space-y-6">
          {status === 'checking' && (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary"
            />
          )}

          {status === 'healthy' && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
              className="space-y-4 text-center"
            >
              <div className="w-20 h-20 mx-auto rounded-full bg-green-500/20 border-2 border-green-500 flex items-center justify-center">
                <CheckCircle size={48} className="text-green-500" weight="fill" />
              </div>
              <div>
                <p className="text-lg font-semibold text-green-500">Connected Successfully</p>
                <p className="text-sm text-muted-foreground mt-1">Backend Version: {version}</p>
              </div>
            </motion.div>
          )}

          {status === 'error' && (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
              className="space-y-4 text-center w-full"
            >
              <div className="w-20 h-20 mx-auto rounded-full bg-destructive/20 border-2 border-destructive flex items-center justify-center">
                <XCircle size={48} className="text-destructive" weight="fill" />
              </div>
              <div>
                <p className="text-lg font-semibold text-destructive">Connection Failed</p>
                <p className="text-sm text-muted-foreground mt-2 px-4">{errorMessage}</p>
              </div>
              <div className="flex flex-col gap-3 pt-4">
                <Button
                  onClick={handleRetry}
                  className="bg-gradient-to-r from-primary to-accent hover:opacity-90 font-semibold"
                >
                  <ArrowsClockwise className="mr-2" weight="bold" />
                  Retry Connection
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  Live agent data remains unavailable until the backend connection is restored.
                </p>
              </div>
            </motion.div>
          )}

          {status === 'checking' && (
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                Establishing secure connection to agent factory...
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
