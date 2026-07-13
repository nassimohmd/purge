import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { parseNeoFinderExport } from '../src/lib/parser/parse'
import {
  PurgeDB,
  exportSession,
  exportSnapshot,
  getDescendantFiles,
  getDirectFiles,
  importSession,
  importSnapshot,
  loadAll,
  saveImport,
  setSsdCapacity,
  type Snapshot,
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

describe('capacity persistence', () => {
  it('manual capacity override survives a re-import', async () => {
    const db = freshDb()
    const first = parseNeoFinderExport(toBuffer(sampleSsd1()), 'SSD_1.txt')
    await saveImport(first, db)
    await setSsdCapacity(first.ssd.id, 2e12, db)

    const second = parseNeoFinderExport(toBuffer(sampleSsd1()), 'SSD_1_v2.txt')
    await saveImport(second, db)

    const state = await loadAll(db)
    expect(state.ssds[0].userCapacityBytes).toBe(2e12)
  })

  it('a re-import without capacity lines keeps the previously parsed capacity', async () => {
    const db = freshDb()
    const withCap = parseNeoFinderExport(
      toBuffer(assemble([folderRow('SSD 1:X', 10), fileRow('SSD 1:X:a.mov', 10)], true, ['Size 2 TB'])),
      'SSD_1.txt',
    )
    await saveImport(withCap, db)
    const withoutCap = parseNeoFinderExport(
      toBuffer(assemble([folderRow('SSD 1:X', 10), fileRow('SSD 1:X:a.mov', 10)])),
      'SSD_1_v2.txt',
    )
    expect(withoutCap.ssd.capacityBytes).toBeNull()
    await saveImport(withoutCap, db)
    expect((await loadAll(db)).ssds[0].capacityBytes).toBe(2e12)
  })

  it('imports a v1 session file (no capacity fields) with nulls', async () => {
    const db1 = freshDb()
    const parsed = parseNeoFinderExport(toBuffer(sampleSsd1()), 'SSD_1.txt')
    await saveImport(parsed, db1)
    const json = await (await exportSession(db1)).text()

    // Simulate a pre-capacity (v1) session file.
    const data = JSON.parse(json)
    data.version = 1
    for (const s of data.ssds) {
      delete s.capacityBytes
      delete s.freeBytes
      delete s.userCapacityBytes
    }

    const db2 = freshDb()
    const state = await importSession(JSON.stringify(data), db2)
    expect(state.ssds[0].capacityBytes).toBeNull()
    expect(state.ssds[0].userCapacityBytes).toBeNull()
  })
})

describe('shared-session snapshots', () => {
  it('exportSnapshot omits decisions; importSnapshot restores ssds+nodes and takes decisions separately', async () => {
    const db1 = freshDb()
    const parsed = parseNeoFinderExport(toBuffer(sampleSsd1()), 'SSD_1.txt')
    await saveImport(parsed, db1)
    await db1.decisions.put({
      key: dkey(parsed.ssd.id, 'SSD 1:JA Golf 25'),
      ssdId: parsed.ssd.id,
      path: 'SSD 1:JA Golf 25',
      state: 'keep',
      note: '',
      decidedAt: 1,
    })

    const snapshot = JSON.parse(await (await exportSnapshot(db1)).text()) as Snapshot
    expect(snapshot.app).toBe('purge')
    expect('decisions' in snapshot).toBe(false)
    expect(snapshot.ssds).toHaveLength(1)
    expect(snapshot.nodes.length).toBe(await db1.nodes.count())

    // A visitor's own browser, hydrated from the fetched snapshot + separately-fetched decisions.
    const db2 = freshDb()
    const decisions = [
      {
        key: dkey(parsed.ssd.id, 'SSD 1:Hypedrop Logos'),
        ssdId: parsed.ssd.id,
        path: 'SSD 1:Hypedrop Logos',
        state: 'delete' as const,
        note: 'shared mark',
        decidedAt: 2,
      },
    ]
    const state = await importSnapshot(snapshot, decisions, db2)
    expect(state.ssds[0].name).toBe('SSD 1')
    expect(state.foldersBySsd[parsed.ssd.id].some((f) => f.path === 'SSD 1:Hypedrop Logos')).toBe(
      true,
    )
    expect(state.decisions[dkey(parsed.ssd.id, 'SSD 1:Hypedrop Logos')]?.note).toBe('shared mark')
    // The original db1-only 'keep' decision must NOT leak into db2 — decisions
    // are share-specific, not part of the snapshot.
    expect(state.decisions[dkey(parsed.ssd.id, 'SSD 1:JA Golf 25')]).toBeUndefined()
  })
})
