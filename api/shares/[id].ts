/// <reference lib="dom" />
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { head, list } from '@vercel/blob'
import type { Decision } from '../../src/lib/types.js'
import { blobToken, decisionsPrefix, isValidId, snapshotPath } from '../_lib.js'

/**
 * GET /api/shares/:id — returns a small pointer + the current decisions, not
 * the (potentially huge) snapshot itself: { snapshotUrl, decisions }. The
 * client fetches snapshotUrl directly from Blob's public CDN, bypassing this
 * function's response body entirely for the heavy payload.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }
  const id = req.query.id
  if (!isValidId(id)) {
    res.status(400).json({ error: 'invalid share id' })
    return
  }

  const token = blobToken()
  let snapshotUrl: string
  try {
    const meta = await head(snapshotPath(id), { token })
    snapshotUrl = meta.url
  } catch {
    res.status(404).json({ error: 'share not found' })
    return
  }

  const { blobs } = await list({ prefix: decisionsPrefix(id), token })
  const decisions: Decision[] = await Promise.all(
    blobs.map(async (b) => {
      const r = await fetch(b.url)
      return (await r.json()) as Decision
    }),
  )

  res.status(200).json({ snapshotUrl, decisions })
}
