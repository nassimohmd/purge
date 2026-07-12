import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import type { Decision, DecisionState, SsdMeta } from '../src/lib/types'
import { dkey } from '../src/lib/types'
import {
  buildManifest,
  manifestCsv,
  manifestFileName,
  manifestScript,
  toPosixPath,
} from '../src/lib/manifest'
import { mkNode, mkSsd } from './fixture'

const SSD = 'sn:test'
const d = (path: string, state: DecisionState, note = ''): [string, Decision] => [
  dkey(SSD, path),
  { key: dkey(SSD, path), ssdId: SSD, path, state, note, decidedAt: 1 },
]

const folders = [
  mkNode(SSD, 'SSD 1', 1, 1000),
  mkNode(SSD, 'SSD 1:A', 1, 600, { modified: Date.UTC(2020, 5, 27) }),
  mkNode(SSD, 'SSD 1:A:A1', 1, 100),
  mkNode(SSD, 'SSD 1:A:A2', 1, 480),
  mkNode(SSD, 'SSD 1:B', 1, 400),
]

describe('buildManifest', () => {
  it('emits the parent wholesale when deletable, with its note', async () => {
    const decisions = Object.fromEntries([d('SSD 1:A', 'delete', 'old 2020 shoot')])
    const entries = await buildManifest(SSD, folders, decisions, async () => [])
    expect(entries.map((e) => e.node.path)).toEqual(['SSD 1:A'])
    expect(entries[0].note).toBe('old 2020 shoot')
  })

  it('a keep child → deletable siblings + parent loose files, never the parent', async () => {
    const decisions = Object.fromEntries([d('SSD 1:A', 'delete'), d('SSD 1:A:A1', 'keep')])
    const loose = mkNode(SSD, 'SSD 1:A:stray.mov', 0, 50)
    const entries = await buildManifest(SSD, folders, decisions, async (_ssd, parent) =>
      parent === 'SSD 1:A' ? [loose] : [],
    )
    const got = entries.map((e) => e.node.path).sort()
    expect(got).toEqual(['SSD 1:A:A2', 'SSD 1:A:stray.mov'])
  })

  it('sorts entries by size descending', async () => {
    const decisions = Object.fromEntries([d('SSD 1:A:A1', 'delete'), d('SSD 1:B', 'delete')])
    const entries = await buildManifest(SSD, folders, decisions, async () => [])
    expect(entries.map((e) => e.node.sizeBytes)).toEqual([400, 100])
  })
})

describe('CSV export', () => {
  it('converts colon paths to POSIX /Volumes paths', () => {
    expect(toPosixPath('SSD 1:Hypedrop Logos:file.mp4')).toBe(
      '/Volumes/SSD 1/Hypedrop Logos/file.mp4',
    )
  })

  it('emits the documented columns and quotes commas/quotes', () => {
    const node = mkNode(SSD, 'SSD 1:A, "B"', 1, 600, { modified: Date.UTC(2020, 5, 27) })
    const csv = manifestCsv([{ node, note: 'says "old", maybe' }])
    const [head, line] = csv.trim().split('\n')
    expect(head).toBe('path_posix,size_bytes,size_human,last_modified,note')
    expect(line).toContain('"/Volumes/SSD 1/A, ""B"""')
    expect(line).toContain('600')
    expect(line).toContain('"says ""old"", maybe"')
  })

  it('names files like purge-manifest_SSD-4_YYYY-MM-DD.csv', () => {
    expect(manifestFileName('SSD 4', 'csv', new Date(2026, 6, 12))).toBe(
      'purge-manifest_SSD-4_2026-07-12.csv',
    )
  })
})

describe('shell script export', () => {
  const ssd: SsdMeta = mkSsd(SSD)

  it('is dry-run by default, guards the volume, and quotes hostile names', () => {
    const node = mkNode(SSD, "SSD 1:client's folder", 1, 600)
    const sh = manifestScript(ssd, [{ node, note: '' }])
    expect(sh).toContain('DRY_RUN="${DRY_RUN:-1}"')
    expect(sh).toContain(`if [ ! -d "$VOLUME" ]`)
    expect(sh).toContain(`read -r -p "Type YES to continue: "`)
    expect(sh).toContain(`'/Volumes/SSD 1/client'\\''s folder'`)
    // rm -rf only in the DRY_RUN=0 branch, after the confirmation prompt
    expect(sh.indexOf('rm -rf')).toBeGreaterThan(sh.indexOf('read -r -p'))
  })
})
