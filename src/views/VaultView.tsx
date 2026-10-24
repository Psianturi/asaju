import { useState } from 'react'
import { motion } from 'framer-motion'
import { Wallet as WalletIcon, Globe, ShieldCheck } from '@phosphor-icons/react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { NFTCard } from '@/components/NFTCard'
import { VerificationDashboard } from '@/components/VerificationDashboard'
import { NFT } from '@/lib/types'
import { getChain } from '@/lib/blockchain/chains'
import type { ContractVerificationData } from '@/lib/blockchain/verificationService'

interface VaultViewProps {
  displayedNFTs: NFT[]
  selectedChainId: number
  verificationData: ContractVerificationData[] | null
  setMainView: (view: 'dashboard' | 'vault' | 'marketplace') => void
  onOpenMetadata: (nft: NFT) => void
  startTransition: React.TransitionStartFunction
}

export function VaultView({
  displayedNFTs,
  selectedChainId,
  verificationData,
  setMainView,
  onOpenMetadata,
  startTransition,
}: VaultViewProps) {
  const [nftPage, setNftPage] = useState(0)

  const wisdomNFTs = displayedNFTs

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center">
            <WalletIcon className="text-primary" weight="duotone" size={22} />
          </div>
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              NFT Vault
            </h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              <p className="text-xs text-muted-foreground font-mono">
                {getChain(selectedChainId)?.name ?? `Chain ${selectedChainId}`}
              </p>
            </div>
          </div>
        </div>
        {/* Batch IPFS upload disabled — needs a backend endpoint, not browser credentials */}
      </div>

      {
        wisdomNFTs.length === 0 ? (
          <Card className="glass-card-hover p-12 text-center border-2 border-dashed border-primary/30">
            <WalletIcon size={56} className="mx-auto mb-4 text-muted-foreground opacity-50 animate-float" weight="duotone" />
            <h3 className="text-base font-bold mb-2">No NFTs Yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6">
              Have your agents analyze YouTube videos to mint learning proof NFTs on {getChain(selectedChainId)?.name ?? 'the selected network'}
            </p>
            <Button
              onClick={() => startTransition(() => setMainView('dashboard'))}
              className="bg-gradient-to-r from-secondary to-accent font-semibold shadow-lg shadow-secondary/30"
            >
              <Globe className="mr-2" weight="duotone" />
              Go to Dashboard
            </Button>
          </Card>
        ) : (() => {
          const NFT_PAGE_SIZE = 12
          const totalPages = Math.ceil(wisdomNFTs.length / NFT_PAGE_SIZE)
          const effectivePage = Math.min(nftPage, Math.max(0, totalPages - 1))
          const pagedNFTs = wisdomNFTs.slice(effectivePage * NFT_PAGE_SIZE, (effectivePage + 1) * NFT_PAGE_SIZE)
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {pagedNFTs.map((nft, idx) => (
                  <motion.div
                    key={nft.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: idx * 0.04 }}
                  >
                    <NFTCard
                      nft={nft}
                      onClick={() => onOpenMetadata(nft)}
                    />
                  </motion.div>
                ))}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setNftPage(p => Math.max(0, p - 1))}
                    disabled={effectivePage === 0}
                    className="border-primary/30 hover:border-primary/60 px-3"
                  >
                    ← Prev
                  </Button>
                  <span className="text-xs text-muted-foreground font-mono">
                    Page {effectivePage + 1} / {totalPages} &nbsp;·&nbsp; {wisdomNFTs.length} NFTs
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setNftPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={effectivePage >= totalPages - 1}
                    className="border-primary/30 hover:border-primary/60 px-3"
                  >
                    Next →
                  </Button>
                </div>
              )}
            </div>
          )
        })()
      }

      {/* ── Contract Verification History ─────── */}
      {verificationData && verificationData.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
              <ShieldCheck className="text-emerald-500" weight="duotone" size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold">Contract Verification</h3>
              <p className="text-xs text-muted-foreground">On-chain smart contract verification status per agent</p>
            </div>
          </div>
          <VerificationDashboard verifications={verificationData} />
        </div>
      )}
    </motion.div>
  )
}