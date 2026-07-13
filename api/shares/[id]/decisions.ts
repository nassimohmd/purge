import type { VercelRequest, VercelResponse } from '@vercel/node'
import { del, put } from '@vercel/blob'
import { dkey, type Decision } from '../../../src/lib/types.js'
import { blobToken, decisionPath, isValidId } from '../../_lib.js'

/**
 * PUT/DELETE /api/shares/:id/decisions — upsert or remove one Decision.
 * The key is derived server-side from ssdId+path in the body (same as
 * dkey()) rather than carried in the URL, so a decision's colon-path never
 * has to survive round-tripping through a URL path segment.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = req.query.id
  if (!isValidId(id)) {
    res.status(400).json({ error: 'invalid share id' })
    return
  }

  if (req.method === 'PUT') {
    const decision = req.body as Partial<Decision> | undefined
    if (!decision?.ssdId || !decision?.path || !decision?.state) {
      res.status(400).json({ error: 'invalid decision' })
      return
    }
    const key = dkey(decision.ssdId, decision.path)
    const full: Decision = {
      key,
      ssdId: decision.ssdId,
      path: decision.path,
      state: decision.state,
      note: decision.note ?? '',
      decidedAt: decision.decidedAt ?? Date.now(),
    }
    await put(decisionPath(id, key), JSON.stringify(full), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      token: blobToken(),
    })
    res.status(204).end()
    return
  }

  if (req.method === 'DELETE') {
    const body = (req.body ?? {}) as { ssdId?: string; path?: string }
    if (!body.ssdId || !body.path) {
      res.status(400).json({ error: 'invalid key' })
      return
    }
    await del(decisionPath(id, dkey(body.ssdId, body.path)), { token: blobToken() }).catch(
      () => {},
    )
    res.status(204).end()
    return
  }

  res.status(405).json({ error: 'method not allowed' })
}
