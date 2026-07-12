import type { Decision, NodeRec, SsdMeta } from './types'
import { effectiveCapacity } from './types'
import { effectiveState, resolveDeletions } from './resolve'

export interface SsdStats {
  /** Cataloged bytes (the drive's used space, per the export). */
  usedBytes: number
  /** Bytes the manifest would reclaim right now (same math as the exporter). */
  reclaimBytes: number
  capacityBytes: number | null
  /** Free space: parsed from the export, else capacity − used. */
  freeBytes: number | null
  /** Share of depth-1 folder BYTES with a non-undecided effective state. */
  decidedBytesFraction: number
  /** Share of depth-1 folder COUNT with a non-undecided effective state. */
  decidedCountFraction: number
  oldestModified: number | null
  newestModified: number | null
}

/**
 * Synchronous per-SSD stats over the in-memory folder list. Reclaim uses the
 * same resolution as the manifest exporter: whole deletable subtrees plus the
 * direct FILES of partial-delete parents — and because folder sizes are
 * cumulative, a parent's direct-file bytes are its declared size minus the sum
 * of its child folders' sizes. No IndexedDB round-trip needed.
 */
export function computeSsdStats(
  ssd: SsdMeta,
  folders: NodeRec[],
  decisions: Record<string, Decision>,
): SsdStats {
  const { folders: whole, partialParents } = resolveDeletions(folders, decisions, ssd.id)

  let reclaimBytes = 0
  for (const f of whole) reclaimBytes += f.sizeBytes
  if (partialParents.length > 0) {
    const childFolderBytes = new Map<string, number>()
    for (const f of folders) {
      if (f.parentPath !== null) {
        childFolderBytes.set(f.parentPath, (childFolderBytes.get(f.parentPath) ?? 0) + f.sizeBytes)
      }
    }
    for (const p of partialParents) {
      reclaimBytes += Math.max(0, p.sizeBytes - (childFolderBytes.get(p.path) ?? 0))
    }
  }

  let decidedBytes = 0
  let totalDepth1Bytes = 0
  let decidedCount = 0
  let depth1Count = 0
  let oldestModified: number | null = null
  let newestModified: number | null = null
  for (const f of folders) {
    if (f.depth !== 1) continue
    depth1Count++
    totalDepth1Bytes += f.sizeBytes
    if (effectiveState(decisions, ssd.id, f.path) !== 'undecided') {
      decidedCount++
      decidedBytes += f.sizeBytes
    }
    if (f.modified !== null) {
      if (oldestModified === null || f.modified < oldestModified) oldestModified = f.modified
      if (newestModified === null || f.modified > newestModified) newestModified = f.modified
    }
  }

  const capacityBytes = effectiveCapacity(ssd)
  const freeBytes =
    ssd.freeBytes ?? (capacityBytes !== null ? Math.max(0, capacityBytes - ssd.totalBytes) : null)

  return {
    usedBytes: ssd.totalBytes,
    reclaimBytes,
    capacityBytes,
    freeBytes,
    decidedBytesFraction: totalDepth1Bytes > 0 ? decidedBytes / totalDepth1Bytes : 0,
    decidedCountFraction: depth1Count > 0 ? decidedCount / depth1Count : 0,
    oldestModified,
    newestModified,
  }
}

/** 0 for fresh (≤6 months), rising linearly to 1 at ≥4 years; 0 when unknown. */
export function ageT(modified: number | null, now = Date.now()): number {
  if (modified === null) return 0
  const YEAR = 365.25 * 86400000
  const t = (now - modified - YEAR / 2) / (4 * YEAR - YEAR / 2)
  return Math.max(0, Math.min(1, t))
}
