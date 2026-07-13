import { describe, expect, it, vi } from 'vitest'
import { fetchShare, parseShareId, pushDecision, pushDecisionRemoval } from '../src/lib/share'

describe('parseShareId', () => {
  it('extracts a valid share id from /s/<id>', () => {
    expect(parseShareId('/s/abcdef1234567890')).toBe('abcdef1234567890')
    expect(parseShareId('/s/abcdef1234567890/')).toBe('abcdef1234567890')
  })

  it('rejects ids that are too short, or non-share paths', () => {
    expect(parseShareId('/s/short')).toBeNull() // < 8 chars
    expect(parseShareId('/')).toBeNull()
    expect(parseShareId('/fleet')).toBeNull()
    expect(parseShareId('/s/')).toBeNull()
    expect(parseShareId('/s/has spaces')).toBeNull()
  })
})

describe('fetchShare', () => {
  it('resolves the share pointer, then fetches the snapshot from its own URL', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/shares/abcdef1234567890') {
        return new Response(
          JSON.stringify({
            snapshotUrl: 'https://blob.example/shares/abcdef1234567890/snapshot.json',
            decisions: [
              { key: 'k', ssdId: 'sn:1', path: 'SSD 1:X', state: 'delete', note: '', decidedAt: 1 },
            ],
          }),
          { status: 200 },
        )
      }
      if (url === 'https://blob.example/shares/abcdef1234567890/snapshot.json') {
        return new Response(
          JSON.stringify({ app: 'purge', version: 2, ssds: [], nodes: [] }),
          { status: 200 },
        )
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { snapshot, decisions } = await fetchShare('abcdef1234567890')
    expect(snapshot.app).toBe('purge')
    expect(decisions).toHaveLength(1)
    expect(decisions[0].state).toBe('delete')

    vi.unstubAllGlobals()
  })

  it('throws a friendly error on a 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    await expect(fetchShare('missingmissing')).rejects.toThrow(/not found/i)
    vi.unstubAllGlobals()
  })
})

describe('pushDecision / pushDecisionRemoval', () => {
  it('PUTs the decision and DELETEs with ssdId+path, never throwing on network failure', async () => {
    const calls: [string, RequestInit | undefined][] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push([url, init])
        return new Response('', { status: 204 })
      }),
    )

    pushDecision('abcdef1234567890', {
      key: 'k',
      ssdId: 'sn:1',
      path: 'SSD 1:X',
      state: 'delete',
      note: '',
      decidedAt: 1,
    })
    pushDecisionRemoval('abcdef1234567890', 'sn:1', 'SSD 1:X')
    await new Promise((r) => setTimeout(r, 0))

    expect(calls).toHaveLength(2)
    expect(calls[0][0]).toBe('/api/shares/abcdef1234567890/decisions')
    expect(calls[0][1]?.method).toBe('PUT')
    expect(calls[1][1]?.method).toBe('DELETE')
    expect(JSON.parse(calls[1][1]?.body as string)).toEqual({ ssdId: 'sn:1', path: 'SSD 1:X' })

    vi.unstubAllGlobals()
  })

  it('swallows fetch rejections instead of throwing (fire-and-forget)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    expect(() =>
      pushDecision('abcdef1234567890', {
        key: 'k',
        ssdId: 'sn:1',
        path: 'SSD 1:X',
        state: 'delete',
        note: '',
        decidedAt: 1,
      }),
    ).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
    vi.unstubAllGlobals()
  })
})
