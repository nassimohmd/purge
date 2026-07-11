import type { Decision, DecisionState, NodeRec, SsdMeta } from './types'
import { dkey } from './types'
import { fuzzyMatch } from './format'
import { effectiveState } from './resolve'

export type SortCol = 'state' | 'name' | 'ssd' | 'size' | 'modified' | 'files' | 'kind'
export interface Sort {
  col: SortCol
  dir: 1 | -1
}

export type AgeMonths = 0 | 6 | 12 | 24
export type KindFilter = 'all' | 'video' | 'project' | 'mixed'
export type StateFilter = 'all' | DecisionState

export interface Filters {
  ssdIds: string[] // empty = all SSDs
  age: AgeMonths
  minSize: number
  kind: KindFilter
  state: StateFilter
  q: string
}

export const DEFAULT_FILTERS: Filters = {
  ssdIds: [],
  age: 0,
  minSize: 0,
  kind: 'all',
  state: 'all',
  q: '',
}

export const DEFAULT_SORT: Sort = { col: 'size', dir: -1 }

export interface KindLabel {
  label: string
  bucket: KindFilter
  videoPct: number
}

/** Dominant-kind evidence label, e.g. "84% video". */
export function kindLabel(n: NodeRec): KindLabel {
  const total = n.videoBytes + n.imageBytes + n.projectBytes + n.otherBytes
  if (total <= 0) return { label: n.fileCount === 0 ? 'empty' : 'mixed', bucket: 'mixed', videoPct: 0 }
  const videoPct = n.videoBytes / total
  if (videoPct >= 0.5) {
    return { label: `${Math.round(videoPct * 100)}% video`, bucket: 'video', videoPct }
  }
  if (n.projectBytes / total >= 0.35) return { label: 'project files', bucket: 'project', videoPct }
  return { label: 'mixed', bucket: 'mixed', videoPct }
}

const STATE_RANK: Record<DecisionState, number> = { delete: 0, review: 1, keep: 2, undecided: 3 }
const MONTH_MS = 30.44 * 86400000

/**
 * The triage list: depth-1 "project folders" across all SSDs, filtered and
 * sorted. Shared by the board and Focus Mode so both see the same order.
 */
export function buildTriageList(
  ssds: SsdMeta[],
  foldersBySsd: Record<string, NodeRec[]>,
  decisions: Record<string, Decision>,
  filters: Filters,
  sort: Sort,
  now = Date.now(),
): NodeRec[] {
  const ssdNames = new Map(ssds.map((s) => [s.id, s.name]))
  const wantSsd = new Set(filters.ssdIds)
  const cutoff = filters.age === 0 ? null : now - filters.age * MONTH_MS

  const out: NodeRec[] = []
  for (const ssd of ssds) {
    if (wantSsd.size > 0 && !wantSsd.has(ssd.id)) continue
    for (const f of foldersBySsd[ssd.id] ?? []) {
      if (f.depth !== 1) continue
      if (f.sizeBytes < filters.minSize) continue
      if (cutoff !== null && (f.modified === null || f.modified > cutoff)) continue
      if (filters.kind !== 'all' && kindLabel(f).bucket !== filters.kind) continue
      if (filters.state !== 'all' && effectiveState(decisions, f.ssdId, f.path) !== filters.state) {
        continue
      }
      if (filters.q && !fuzzyMatch(filters.q, f.name)) continue
      out.push(f)
    }
  }

  const dir = sort.dir
  const byName = (a: NodeRec, b: NodeRec) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  out.sort((a, b) => {
    let c = 0
    switch (sort.col) {
      case 'name':
        c = byName(a, b)
        break
      case 'ssd':
        c = (ssdNames.get(a.ssdId) ?? '').localeCompare(ssdNames.get(b.ssdId) ?? '', undefined, {
          numeric: true,
        })
        break
      case 'size':
        c = a.sizeBytes - b.sizeBytes
        break
      case 'modified':
        c = (a.modified ?? 0) - (b.modified ?? 0)
        break
      case 'files':
        c = a.fileCount - b.fileCount
        break
      case 'kind':
        c = kindLabel(a).videoPct - kindLabel(b).videoPct
        break
      case 'state':
        c =
          STATE_RANK[effectiveState(decisions, a.ssdId, a.path)] -
          STATE_RANK[effectiveState(decisions, b.ssdId, b.path)]
        break
    }
    if (c === 0) c = b.sizeBytes - a.sizeBytes // stable tiebreak: big stuff first
    if (c === 0) c = byName(a, b)
    return c * dir
  })
  return out
}

/** True if any explicit decision exists strictly below this folder. */
export function hasDescendantDecisions(
  decisions: Record<string, Decision>,
  ssdId: string,
  path: string,
): boolean {
  const prefix = dkey(ssdId, path + ':')
  for (const key in decisions) {
    if (key.startsWith(prefix) && decisions[key].state !== 'undecided') return true
  }
  return false
}
