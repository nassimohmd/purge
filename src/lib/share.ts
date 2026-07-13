import { upload } from '@vercel/blob/client'
import type { Decision } from './types'
import { exportSnapshot, type Snapshot } from './db'

const ID_RE = /^[A-Za-z0-9_-]{8,40}$/

/** Extracts the share id from a `/s/<id>` pathname, or null if it's not a share URL. */
export function parseShareId(pathname: string = window.location.pathname): string | null {
  const m = pathname.match(/^\/s\/([^/]+)\/?$/)
  return m && ID_RE.test(m[1]) ? m[1] : null
}

export function randomShareId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export function shareUrl(id: string): string {
  return `${window.location.origin}/s/${id}`
}

/** Publish (or re-publish) the current local session as a shared snapshot. */
export async function publishShare(id: string): Promise<void> {
  const blob = await exportSnapshot()
  await upload(`shares/${id}/snapshot.json`, blob, {
    access: 'public',
    handleUploadUrl: '/api/shares/upload',
    contentType: 'application/json',
  })
}

export interface FetchedShare {
  snapshot: Snapshot
  decisions: Decision[]
}

/** Fetches the current snapshot + decisions for a share id. */
export async function fetchShare(id: string): Promise<FetchedShare> {
  const res = await fetch(`/api/shares/${id}`)
  if (!res.ok) {
    throw new Error(res.status === 404 ? 'This shared link was not found.' : 'Failed to load the shared session.')
  }
  const { snapshotUrl, decisions } = (await res.json()) as {
    snapshotUrl: string
    decisions: Decision[]
  }
  const snapRes = await fetch(snapshotUrl)
  if (!snapRes.ok) throw new Error('Failed to load the shared session data.')
  const snapshot = (await snapRes.json()) as Snapshot
  return { snapshot, decisions }
}

/** Fire-and-forget push of one decision to a shared session, mirroring the local write. */
export function pushDecision(id: string, decision: Decision): void {
  void fetch(`/api/shares/${id}/decisions`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  }).catch(() => {})
}

export function pushDecisionRemoval(id: string, ssdId: string, path: string): void {
  void fetch(`/api/shares/${id}/decisions`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ssdId, path }),
  }).catch(() => {})
}
