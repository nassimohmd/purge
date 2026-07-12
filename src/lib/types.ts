export type DecisionState = 'undecided' | 'keep' | 'delete' | 'review'

export interface SsdMeta {
  /** Stable identity: `sn:<diskSerial>` when a serial was found, else `name:<volumeName>`. */
  id: string
  name: string
  diskSerial: string | null
  importedAt: number
  totalBytes: number
  fileCount: number
  folderCount: number
  sourceFileName: string
  /** Drive capacity parsed from the catalog metadata block, if present. */
  capacityBytes: number | null
  /** Free space parsed from the catalog metadata block, if present. */
  freeBytes: number | null
  /** Manual capacity override (survives re-imports). */
  userCapacityBytes: number | null
}

/** Capacity to display/compute with: manual override wins over parsed. */
export const effectiveCapacity = (ssd: SsdMeta): number | null =>
  ssd.userCapacityBytes ?? ssd.capacityBytes ?? null

export interface NodeRec {
  ssdId: string
  /** Colon-separated NeoFinder path, e.g. `SSD 1:Hypedrop Logos:Snowbombing 2023`. */
  path: string
  parentPath: string | null
  name: string
  /** 0 = volume root. Triage unit is depth 1. */
  depth: number
  /** 1 = folder, 0 = file (numeric so IndexedDB can index it). */
  folder: 0 | 1
  kind: string | null
  sizeBytes: number
  created: number | null
  modified: number | null
  mediaInfo: string | null
  width: number | null
  height: number | null
  duration: string | null
  videoBitrate: string | null
  /** Folders only — cumulative counts/byte buckets over all descendant files. */
  fileCount: number
  videoBytes: number
  imageBytes: number
  projectBytes: number
  otherBytes: number
}

export interface Decision {
  /** `${ssdId}\u0000${path}` — path-keyed so re-imports re-match by path. */
  key: string
  ssdId: string
  path: string
  state: DecisionState
  note: string
  decidedAt: number
}

export interface ImportWarning {
  type: 'bad-date' | 'size-mismatch' | 'duplicate-path' | 'skipped-row' | 'no-children' | 'unknown-column'
  message: string
}

export interface ImportReport {
  ssdName: string
  diskSerial: string | null
  rowCount: number
  fileCount: number
  folderCount: number
  totalBytes: number
  dateMin: number | null
  dateMax: number | null
  capacityBytes: number | null
  freeBytes: number | null
  warnings: ImportWarning[]
  sourceFileName: string
}

export interface ParseResult {
  ssd: SsdMeta
  nodes: NodeRec[]
  report: ImportReport
}

export const dkey = (ssdId: string, path: string): string => `${ssdId}\u0000${path}`

export const parentPathOf = (path: string): string | null => {
  const i = path.lastIndexOf(':')
  return i === -1 ? null : path.slice(0, i)
}

export const lastSegment = (path: string): string => {
  const i = path.lastIndexOf(':')
  return i === -1 ? path : path.slice(i + 1)
}
