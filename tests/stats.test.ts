import { describe, expect, it } from 'vitest'
import type { Decision, NodeRec } from '../src/lib/types'
import { dkey } from '../src/lib/types'
import { buildManifest } from '../src/lib/manifest'
import { ageT, computeSsdStats } from '../src/lib/stats'
import { mkNode, mkSsd } from './fixture'

const SSD = 'sn:test'

const dec = (path: string, state: Decision['state']): [string, Decision] => [
  dkey(SSD, path),
  { key: dkey(SSD, path), ssdId: SSD, path, state, note: '', decidedAt: 1 },
]

/**
 * A drive with a partial-delete parent: Big (1000) holds Keepme (300, kept),
 * Sub (500, delete-inherited) and 200 B of loose direct files. Manifest emits
 * Sub wholesale + the 200 B of loose files. Old (400) deletes wholesale.
 */
function fixture() {
  const folders: NodeRec[] = [
    mkNode(SSD, 'SSD 1', 1, 1400, { depth: 0 }),
    mkNode(SSD, 'SSD 1:Big', 1, 1000, { modified: Date.UTC(2020, 0, 1) }),
    mkNode(SSD, 'SSD 1:Big:Keepme', 1, 300),
    mkNode(SSD, 'SSD 1:Big:Sub', 1, 500),
    mkNode(SSD, 'SSD 1:Old', 1, 400, { modified: Date.UTC(2023, 5, 1) }),
  ]
  const files: NodeRec[] = [
    mkNode(SSD, 'SSD 1:Big:loose1.mov', 0, 150),
    mkNode(SSD, 'SSD 1:Big:loose2.mov', 0, 50),
    mkNode(SSD, 'SSD 1:Big:Keepme:k.mov', 0, 300),
    mkNode(SSD, 'SSD 1:Big:Sub:s.mov', 0, 500),
    mkNode(SSD, 'SSD 1:Old:o.mov', 0, 400),
  ]
  const decisions = Object.fromEntries([
    dec('SSD 1:Big', 'delete'),
    dec('SSD 1:Big:Keepme', 'keep'),
    dec('SSD 1:Old', 'delete'),
  ])
  return { folders, files, decisions }
}

describe('computeSsdStats', () => {
  it('reclaimBytes matches the async manifest byte total, including partial parents', async () => {
    const { folders, files, decisions } = fixture()
    const ssd = mkSsd(SSD, { totalBytes: 1400 })

    const stats = computeSsdStats(ssd, folders, decisions)
    const manifest = await buildManifest(SSD, folders, decisions, (_, parentPath) =>
      Promise.resolve(files.filter((f) => f.parentPath === parentPath)),
    )
    const manifestBytes = manifest.reduce((s, e) => s + e.node.sizeBytes, 0)

    expect(manifestBytes).toBe(500 + 200 + 400)
    expect(stats.reclaimBytes).toBe(manifestBytes)
  })

  it('computes decided fractions over depth-1 folders', () => {
    const { folders, decisions } = fixture()
    const stats = computeSsdStats(mkSsd(SSD, { totalBytes: 1400 }), folders, decisions)
    expect(stats.decidedCountFraction).toBe(1) // Big + Old both decided
    expect(stats.decidedBytesFraction).toBe(1)

    const none = computeSsdStats(mkSsd(SSD, { totalBytes: 1400 }), folders, {})
    expect(none.decidedCountFraction).toBe(0)
    expect(none.reclaimBytes).toBe(0)
  })

  it('derives free space from capacity when the export had no free line', () => {
    const { folders } = fixture()
    const ssd = mkSsd(SSD, { totalBytes: 1400, userCapacityBytes: 2000 })
    const stats = computeSsdStats(ssd, folders, {})
    expect(stats.capacityBytes).toBe(2000)
    expect(stats.freeBytes).toBe(600)
  })

  it('prefers the parsed free-space figure over the derived one', () => {
    const { folders } = fixture()
    const ssd = mkSsd(SSD, { totalBytes: 1400, capacityBytes: 2000, freeBytes: 500 })
    expect(computeSsdStats(ssd, folders, {}).freeBytes).toBe(500)
  })

  it('reports the oldest/newest depth-1 modified dates', () => {
    const { folders } = fixture()
    const stats = computeSsdStats(mkSsd(SSD, { totalBytes: 1400 }), folders, {})
    expect(stats.oldestModified).toBe(Date.UTC(2020, 0, 1))
    expect(stats.newestModified).toBe(Date.UTC(2023, 5, 1))
  })
})

describe('ageT', () => {
  const now = Date.UTC(2026, 0, 1)
  const YEAR = 365.25 * 86400000

  it('is 0 for fresh and unknown dates', () => {
    expect(ageT(null, now)).toBe(0)
    expect(ageT(now - YEAR / 4, now)).toBe(0)
  })

  it('rises with age and saturates at 4 years', () => {
    const mid = ageT(now - 2 * YEAR, now)
    expect(mid).toBeGreaterThan(0.3)
    expect(mid).toBeLessThan(0.6)
    expect(ageT(now - 5 * YEAR, now)).toBe(1)
  })
})
