// Shared helpers for the /api/shares/* functions.

const ID_RE = /^[A-Za-z0-9_-]{8,40}$/

export function isValidId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id)
}

export const snapshotPath = (id: string): string => `shares/${id}/snapshot.json`

export const decisionsPrefix = (id: string): string => `shares/${id}/decisions/`

export const decisionPath = (id: string, key: string): string =>
  `${decisionsPrefix(id)}${encodeURIComponent(key)}.json`
