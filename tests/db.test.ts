import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { parseNeoFinderExport } from '../src/lib/parser/parse'
import {
  PurgeDB,
  exportSession,
  getDescendantFiles,
  getDirectFiles,
  importSession,
  loadAll,
  saveImport,
} from '../src/lib/db'
import { dkey } from '../src/lib/types'
import { assemble, fileRow, folderRow, sampleSsd1, toBuffer } from './fixture'

let n = 0
const freshDb = () => new PurgeDB(`purge-test-${++n}`)

describe('persistence', () => {
  it('round-trips an import: folders load at startup, files load on demand', async () => {
    const db = freshDb()
    const parsed = parseNeoFinderExport(toBuffer(sampleSsd1()), 'SSD_1.txt')
    await saveImport(parsed, db)

    const state = await loadAll(db)
    expect(state.ssds).toHaveLength(1)
    expect(state.ssds[0].name).toBe('SSD 1')
    const folders = state.foldersBySsd[state.ssds[0].id]
    expect(folders.every((f) => f.folder === 1)).toBe(true)
    expect(folders.some((f) => f.path === 'SSD 1:Hypedrop Logos')).toBe(true)

    const direct = await getDirectFiles(parsed.ssd.id, 'SSD 1:Hypedrop Logos', db)
    expect(direct.map((f) => f.name)).toEqual(['logo_v1.mov', 'logo_v2.mov'])

    const deep = await getDescendantFiles(parsed.ssd.id, 'SSD 1:Hypedrop Logos', 50, db)
    expect(deep.total).toBe(3) // includes Snowbombing 2023 subtree
    expect(deep.files[0].sizeBytes).toBe(500000000)
  })

  it('decisions survive re-import by path; orphans are counted and dropped', async () => {
    const db = freshDb()
    const first = parseNeoFinderExport(toBuffer(sampleSsd1()), 'SSD_1.txt')
    await saveImport(first, db)
    const id = first.ssd.id

    await db.decisions.bulkPut([
      {
        key: dkey(id, 'SSD 1:Hypedrop Logos'),
        ssdId: id,
        path: 'SSD 1:Hypedrop Logos',
        state: 'delete',
        note: 'big and old',
        decidedAt: 1,
      },
      {
        key: dkey(id, 'SSD 1:JA Golf 25'),
        ssdId: id,
        path: 'SSD 1:JA Golf 25',
        state: 'keep',
        note: '',
        decidedAt: 1,
      },
    ])

    // Re-import: JA Golf 25 no longer exists on the drive.
    const second = parseNeoFinderExport(
      toBuffer(
        assemble([
          folderRow('SSD 1:Hypedrop Logos', 100),
          fileRow('SSD 1:Hypedrop Logos:logo_v1.mov', 100),
        ]),
      ),
      'SSD_1_v2.txt',
    )
    expect(second.ssd.id).toBe(id) // matched by disk serial
    const rematch = await saveImport(second, db)
    expect(rematch).toEqual({ rematched: 1, orphaned: 1 })

    const state = await loadAll(db)
    const kept = state.decisions[dkey(id, 'SSD 1:Hypedrop Logos')]
    expect(kept?.state).toBe('delete')
    expect(kept?.note).toBe('big and old')
    expect(state.decisions[dkey(id, 'SSD 1:JA Golf 25')]).toBeUndefined()
  })

  it('session JSON export/import restores everything', async () => {
    const db1 = freshDb()
    const parsed = parseNeoFinderExport(toBuffer(sampleSsd1()), 'SSD_1.txt')
    await saveImport(parsed, db1)
    await db1.decisions.put({
      key: dkey(parsed.ssd.id, 'SSD 1:JA Golf 25'),
      ssdId: parsed.ssd.id,
      path: 'SSD 1:JA Golf 25',
      state: 'review',
      note: 'ask client',
      decidedAt: 1,
    })

    const blob = await exportSession(db1)
    const json = await blob.text()

    const db2 = freshDb()
    const state = await importSession(json, db2)
    expect(state.ssds).toHaveLength(1)
    expect(await db2.nodes.count()).toBe(await db1.nodes.count())
    expect(state.decisions[dkey(parsed.ssd.id, 'SSD 1:JA Golf 25')]?.note).toBe('ask client')
  })

  it('rejects a non-session JSON file', async () => {
    const db = freshDb()
    await expect(importSession('{"hello":"world"}', db)).rejects.toThrow(/Not a Purge session/)
  })
})
