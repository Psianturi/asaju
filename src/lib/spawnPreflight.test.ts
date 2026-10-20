import { describe, expect, it } from 'vitest'
import { parseEther } from 'ethers'
import { describeSpawnError, formatShortfall, spawnShortfall } from '@/lib/spawnPreflight'

describe('spawnShortfall', () => {
  it('flags the 0.47 MNT wallet that tried a 1 MNT spawn', () => {
    const short = spawnShortfall(parseEther('0.4772'), '1')
    expect(short).toBe(parseEther('1.05') - parseEther('0.4772'))
    expect(formatShortfall(short, 'MNT')).toBe('0.5728 MNT')
  })

  it('needs the fee plus 5% gas headroom', () => {
    expect(spawnShortfall(parseEther('1.05'), '1')).toBe(0n)
    expect(spawnShortfall(parseEther('1.0499'), '1') > 0n).toBe(true)
  })
})

describe('describeSpawnError', () => {
  it('explains the raw estimateGas failure from the screenshot', () => {
    const raw = new Error('missing revert data (action="estimateGas", data=null, reason=null, code=CALL_EXCEPTION, version=6.17.0)')
    const msg = describeSpawnError(raw, 'MNT')
    expect(msg).toContain('not enough MNT')
    expect(msg).toContain('No agent was created')
  })

  it('recognises a cancelled wallet prompt and an insufficient-funds error', () => {
    expect(describeSpawnError(new Error('user rejected action (ACTION_REJECTED)'), 'MNT')).toContain('cancelled')
    expect(describeSpawnError(new Error('insufficient funds for gas * price + value'), 'ETH')).toContain('Not enough ETH')
  })
})
