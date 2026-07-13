// Shared helpers for the /api/shares/* functions.

/**
 * Resolve the Blob read-write token. The SDK only auto-reads the exact name
 * BLOB_READ_WRITE_TOKEN, but connecting a store to a project lets the user
 * pick a custom env-var prefix — accept any *_READ_WRITE_TOKEN so the store
 * works regardless of the prefix chosen at connect time. Logs candidate env
 * key NAMES (never values) when nothing is found, for diagnosis.
 */
export function blobToken(): string | undefined {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN
  const key = Object.keys(process.env).find((k) => k.endsWith('_READ_WRITE_TOKEN'))
  if (key) return process.env[key]
  const candidates = Object.keys(process.env).filter(
    (k) => k.includes('BLOB') || k.includes('TOKEN'),
  )
  console.error('No Blob read-write token in env. Candidate keys present:', candidates)
  return undefined
}

const ID_RE = /^[A-Za-z0-9_-]{8,40}$/

export function isValidId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id)
}

export const snapshotPath = (id: string): string => `shares/${id}/snapshot.json`

export const decisionsPrefix = (id: string): string => `shares/${id}/decisions/`

export const decisionPath = (id: string, key: string): string =>
  `${decisionsPrefix(id)}${encodeURIComponent(key)}.json`
