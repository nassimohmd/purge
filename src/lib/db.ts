import Dexie, { type Table } from 'dexie'
import type { Decision, NodeRec, ParseResult, SsdMeta } from './types'
import { dkey } from './types'

class PurgeDB extends Dexie {
  ssds!: Table<SsdMeta, string>
  nodes!: Table<NodeRec, [string, string]>
  decisions!: Table<Decision, string>

  constructor(name = 'purge') {
    super(name)
    this.version(1).stores({
      ssds: 'id',
      nodes: '[ssdId+path], ssdId, [ssdId+parentPath], [ssdId+folder]',
      decisions: 'key, ssdId',
    })
  }
}

export const db = new PurgeDB()

const CHUNK = 5000

async function bulkPutChunked<T, K>(table: Table<T, K>, rows: T[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await table.bulkPut(rows.slice(i, i + CHUNK))
  }
}

export interface RematchReport {
  rematched: number
  orphaned: number
}

/**
 * Persist an import. On re-import of a known SSD, nodes are replaced and
 * existing decisions are re-matched by path; decisions whose path no longer
 * exists are removed and counted as orphaned.
 */
export async function saveImport(
  result: ParseResult,
  database: PurgeDB = db,
): Promise<RematchReport> {
  const { ssd, nodes } = result
  return database.transaction(
    'rw',
    [database.ssds, database.nodes, database.decisions],
    async () => {
      const livePaths = new Set(nodes.map((n) => n.path))
      const existing = await database.decisions.where('ssdId').equals(ssd.id).toArray()
      const orphanKeys = existing.filter((d) => !livePaths.has(d.path)).map((d) => d.key)
      await database.decisions.bulkDelete(orphanKeys)
      await database.nodes.where('ssdId').equals(ssd.id).delete()
      await bulkPutChunked(database.nodes, nodes)
      await database.ssds.put(ssd)
      return { rematched: existing.length - orphanKeys.length, orphaned: orphanKeys.length }
    },
  )
}

export async function deleteSsd(ssdId: string, database: PurgeDB = db): Promise<void> {
  await database.transaction(
    'rw',
    [database.ssds, database.nodes, database.decisions],
    async () => {
      await database.nodes.where('ssdId').equals(ssdId).delete()
      await database.decisions.where('ssdId').equals(ssdId).delete()
      await database.ssds.delete(ssdId)
    },
  )
}

export interface LoadedState {
  ssds: SsdMeta[]
  foldersBySsd: Record<string, NodeRec[]>
  decisions: Record<string, Decision>
}

/** Startup hydration: all SSDs + decisions + FOLDER nodes only (files load on demand). */
export async function loadAll(database: PurgeDB = db): Promise<LoadedState> {
  const ssds = await database.ssds.toArray()
  ssds.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const foldersBySsd: Record<string, NodeRec[]> = {}
  for (const ssd of ssds) {
    foldersBySsd[ssd.id] = await database.nodes
      .where('[ssdId+folder]')
      .equals([ssd.id, 1])
      .toArray()
  }
  const decisions: Record<string, Decision> = {}
  for (const d of await database.decisions.toArray()) decisions[d.key] = d
  return { ssds, foldersBySsd, decisions }
}

export async function putDecision(d: Decision, database: PurgeDB = db): Promise<void> {
  await database.decisions.put(d)
}

export async function removeDecision(key: string, database: PurgeDB = db): Promise<void> {
  await database.decisions.delete(key)
}

/** Direct child files of a folder, size-desc. */
export async function getDirectFiles(
  ssdId: string,
  parentPath: string,
  database: PurgeDB = db,
): Promise<NodeRec[]> {
  const rows = await database.nodes
    .where('[ssdId+parentPath]')
    .equals([ssdId, parentPath])
    .toArray()
  return rows.filter((n) => !n.folder).sort((a, b) => b.sizeBytes - a.sizeBytes)
}

/**
 * Largest files anywhere under a folder, size-desc. Colon paths sort
 * lexicographically, so descendants form a contiguous key range.
 */
export async function getDescendantFiles(
  ssdId: string,
  folderPath: string,
  limit: number,
  database: PurgeDB = db,
): Promise<{ files: NodeRec[]; total: number }> {
  const rows = await database.nodes
    .where('[ssdId+path]')
    .between([ssdId, folderPath + ':'], [ssdId, folderPath + ':￿'])
    .toArray()
  const files = rows.filter((n) => !n.folder).sort((a, b) => b.sizeBytes - a.sizeBytes)
  return { files: limit > 0 ? files.slice(0, limit) : files, total: files.length }
}

// ---------------------------------------------------------------------------
// Session portability — one JSON file with everything (the user's backup)
// ---------------------------------------------------------------------------

export interface SessionFile {
  app: 'purge'
  version: 1
  exportedAt: number
  ssds: SsdMeta[]
  nodes: NodeRec[]
  decisions: Decision[]
}

export async function exportSession(database: PurgeDB = db): Promise<Blob> {
  const ssds = await database.ssds.toArray()
  const decisions = await database.decisions.toArray()
  // Stream nodes into blob parts to avoid one giant string for 30-drive fleets.
  const parts: string[] = [
    `{"app":"purge","version":1,"exportedAt":${Date.now()},"ssds":${JSON.stringify(
      ssds,
    )},"decisions":${JSON.stringify(decisions)},"nodes":[`,
  ]
  let first = true
  for (const ssd of ssds) {
    const nodes = await database.nodes.where('ssdId').equals(ssd.id).toArray()
    for (let i = 0; i < nodes.length; i += CHUNK) {
      const chunk = nodes.slice(i, i + CHUNK).map((n) => JSON.stringify(n))
      parts.push((first ? '' : ',') + chunk.join(','))
      first = false
    }
  }
  parts.push(']}')
  return new Blob(parts, { type: 'application/json' })
}

export async function importSession(json: string, database: PurgeDB = db): Promise<LoadedState> {
  const data = JSON.parse(json) as SessionFile
  if (data.app !== 'purge' || !Array.isArray(data.ssds) || !Array.isArray(data.nodes)) {
    throw new Error('Not a Purge session file')
  }
  await database.transaction(
    'rw',
    [database.ssds, database.nodes, database.decisions],
    async () => {
      await database.ssds.clear()
      await database.nodes.clear()
      await database.decisions.clear()
      await database.ssds.bulkPut(data.ssds)
      await bulkPutChunked(database.nodes, data.nodes)
      await database.decisions.bulkPut(
        (data.decisions ?? []).map((d) => ({ ...d, key: dkey(d.ssdId, d.path) })),
      )
    },
  )
  return loadAll(database)
}

export { PurgeDB }
