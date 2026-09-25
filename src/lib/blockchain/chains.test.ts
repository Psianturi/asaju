import { describe, it, expect } from 'vitest'
import { getSupportedChains, getChain, txUrl, nftUrl, CHAIN_CONFIGS, DEFAULT_CHAIN_ID } from './chains'

describe('chain registry', () => {
  it('exposes every configured chain that has a contract', () => {
    const ids = getSupportedChains().map(c => c.chainId)
    expect(ids).toContain(97)          // BNB testnet
    expect(ids).toContain(5003)        // Mantle Sepolia
    expect(ids).toContain(11155111)    // Ethereum Sepolia
  })

  it('never offers a chain without a deployed contract', () => {
    for (const chain of getSupportedChains()) {
      expect(chain.contractAddress).toMatch(/^0x[a-fA-F0-9]{40}$/)
    }
  })

  it('gives every chain its own contract address', () => {
    const addresses = getSupportedChains().map(c => c.contractAddress.toLowerCase())
    expect(new Set(addresses).size).toBe(addresses.length)
  })

  it('has a default chain that is actually usable', () => {
    expect(getChain(DEFAULT_CHAIN_ID)?.contractAddress).toBeTruthy()
  })

  it('gives each chain a distinct native symbol and explorer', () => {
    const chains = getSupportedChains()
    expect(new Set(chains.map(c => c.explorerUrl)).size).toBe(chains.length)
  })
})

describe('explorer links', () => {
  it('builds a tx link on the right explorer for each chain', () => {
    for (const chain of getSupportedChains()) {
      const url = txUrl(chain.chainId, '0xabc')
      expect(url.startsWith(chain.explorerUrl.replace(/\/$/, ''))).toBe(true)
      expect(url.endsWith('/tx/0xabc')).toBe(true)
    }
  })

  it('points each NFT link at that chain’s own contract, not Mantle’s', () => {
    // The mint dialog used to hardcode Mantle's explorer AND contract, so a
    // BNB agent's "View NFT" link resolved to a different chain entirely.
    for (const chain of getSupportedChains()) {
      const url = nftUrl(chain.chainId, 42)
      expect(url).toContain(chain.contractAddress)
      expect(url.startsWith(chain.explorerUrl.replace(/\/$/, ''))).toBe(true)
    }
    expect(nftUrl(97, 42)).not.toContain(CHAIN_CONFIGS[5003].contractAddress)
  })

  it('uses the Blockscout shape for Mantle and the Etherscan shape elsewhere', () => {
    expect(nftUrl(5003, 7)).toContain('?type=nft&tokenId=7')
    expect(nftUrl(97, 7)).toContain('/nft/')
    expect(nftUrl(11155111, 7)).toContain('/nft/')
  })

  it('returns empty rather than a broken link for an unknown chain', () => {
    expect(txUrl(999999, '0xabc')).toBe('')
    expect(nftUrl(999999, 1)).toBe('')
  })
})
