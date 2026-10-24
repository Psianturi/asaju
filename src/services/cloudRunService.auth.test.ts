import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloudRunService } from './cloudRunService'

type Call = { url: string; init?: RequestInit }

function stubFetch(body: unknown = {}): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  return calls
}

afterEach(() => vi.unstubAllGlobals())

const AUTH = { nonce: 'n-1', signature: '0xsig' }

describe('owner-signed agent requests', () => {
  it('requests the auth challenge with POST (the backend registers no GET)', async () => {
    const calls = stubFetch({ nonce: 'n-1', message: 'sign me', expires_at: 1 })
    await cloudRunService.requestAgentAuthChallenge({
      agentId: 'a1', agentWallet: '0x' + '11'.repeat(20), action: 'delete_agent', chainId: 97,
    })
    expect(calls[0].init?.method).toBe('POST')
    expect(calls[0].url).toContain('action=delete_agent')
  })

  it('sends config with the signature and nothing the server owns', async () => {
    const calls = stubFetch({ status: 'success' })
    await cloudRunService.updateAgentState('a1', { customInstructions: 'focus', customAgenda: 'weekly' }, AUTH)
    const payload = JSON.parse(String(calls[0].init?.body))
    expect(calls[0].init?.method).toBe('PATCH')
    expect(payload).toMatchObject({ custom_instructions: 'focus', custom_agenda: 'weekly', auth_nonce: 'n-1', auth_signature: '0xsig' })
    for (const key of ['auto_scout_enabled', 'generation', 'breeding_count', 'parent_ids']) {
      expect(payload).not.toHaveProperty(key)
    }
  })

  it('deletes with a signature, never a bare wallet address', async () => {
    const calls = stubFetch({ status: 'deleted' })
    await cloudRunService.deleteAgent('a1', AUTH)
    expect(calls[0].init?.method).toBe('DELETE')
    expect(calls[0].url).toContain('auth_nonce=n-1')
    expect(calls[0].url).toContain('auth_signature=0xsig')
    expect(calls[0].url).not.toContain('wallet=')
  })
})
