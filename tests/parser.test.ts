import { describe, expect, it } from 'vitest'
import {
  classifyKind,
  decodeExport,
  normalizeLineEndings,
  parseNeoDate,
  parseNeoFinderExport,
} from '../src/lib/parser/parse'
import {
  assemble,
  fileRow,
  folderRow,
  row,
  sampleSsd1,
  toBuffer,
  toUtf16LeBuffer,
} from './fixture'

describe('line endings & decoding', () => {
  it('normalizes CR-only (classic Mac) and CRLF to LF', () => {
    expect(normalizeLineEndings('a\rb\r\nc\rd')).toBe('a\nb\nc\nd')
  })

  it('decodes UTF-8 with and without BOM', () => {
    const plain = new TextEncoder().encode('héllo')
    expect(decodeExport(plain.buffer as ArrayBuffer)).toBe('héllo')
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...plain])
    expect(decodeExport(bom.buffer as ArrayBuffer)).toBe('héllo')
  })

  it('sniffs a UTF-16LE BOM', () => {
    const parsed = parseNeoFinderExport(toUtf16LeBuffer(sampleSsd1()), 'SSD_1.txt')
    expect(parsed.ssd.name).toBe('SSD 1')
    expect(parsed.report.fileCount).toBe(4)
  })
})

describe('date parsing', () => {
  it('parses "27 June 2020 at 5:22 PM"', () => {
    const ms = parseNeoDate('27 June 2020 at 5:22 PM')
    const d = new Date(ms!)
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2020, 5, 27, 17, 22,
    ])
  })

  it('tolerates a leading day name and 12 AM', () => {
    const ms = parseNeoDate('Saturday, 27 June 2020 at 12:05 AM')
    const d = new Date(ms!)
    expect(d.getHours()).toBe(0)
  })

  it('parses date-only and US month-first forms', () => {
    expect(parseNeoDate('27 June 2020')).not.toBeNull()
    expect(parseNeoDate('June 27, 2020 at 5:22 PM')).not.toBeNull()
  })

  it('returns null on garbage instead of throwing', () => {
    expect(parseNeoDate('yesterday-ish')).toBeNull()
    expect(parseNeoDate('')).toBeNull()
  })
})

describe('the verified SSD 1 sample shape', () => {
  const parsed = parseNeoFinderExport(toBuffer(sampleSsd1()), 'SSD_1.txt')

  it('captures SSD name and disk serial from the metadata block', () => {
    expect(parsed.ssd.name).toBe('SSD 1')
    expect(parsed.ssd.diskSerial).toBe('3231144123')
    expect(parsed.ssd.id).toBe('sn:3231144123')
  })

  it('has both project folders with authoritative cumulative sizes', () => {
    const hypedrop = parsed.nodes.find((n) => n.path === 'SSD 1:Hypedrop Logos')
    const golf = parsed.nodes.find((n) => n.path === 'SSD 1:JA Golf 25')
    expect(hypedrop?.folder).toBe(1)
    expect(hypedrop?.sizeBytes).toBe(947979210) // declared, not summed from files
    expect(golf?.sizeBytes).toBe(3000)
  })

  it('counts rows, files, folders and total size', () => {
    expect(parsed.report.fileCount).toBe(4)
    // 3 explicit folders + synthetic volume root
    expect(parsed.report.folderCount).toBe(4)
    expect(parsed.report.rowCount).toBe(8)
    expect(parsed.ssd.totalBytes).toBe(947979210 + 3000)
  })

  it('produces zero warnings on a consistent export', () => {
    expect(parsed.report.warnings).toEqual([])
  })

  it('rolls up cumulative folder aggregates (evidence for triage)', () => {
    const hypedrop = parsed.nodes.find((n) => n.path === 'SSD 1:Hypedrop Logos')!
    expect(hypedrop.fileCount).toBe(3)
    expect(hypedrop.videoBytes).toBe(947979210)
    const golf = parsed.nodes.find((n) => n.path === 'SSD 1:JA Golf 25')!
    expect(golf.projectBytes).toBe(3000)
  })

  it('maps media evidence columns by header name', () => {
    const main = parsed.nodes.find((n) => n.name === 'main.mp4')!
    expect(main.width).toBe(3840)
    expect(main.height).toBe(2160)
    expect(main.duration).toBe('12:34')
    expect(main.videoBitrate).toBe('45 Mbit/s')
    expect(main.mediaInfo).toBe('H.264, AAC')
  })

  it('reports the modified-date range', () => {
    expect(parsed.report.dateMin).not.toBeNull()
    expect(parsed.report.dateMax).not.toBeNull()
    expect(parsed.report.dateMax!).toBeGreaterThanOrEqual(parsed.report.dateMin!)
  })
})

describe('tolerance & warnings', () => {
  it('keeps a row whose date fails to parse, with a warning', () => {
    const text = assemble([
      folderRow('SSD 1:X', 10),
      fileRow('SSD 1:X:a.mov', 10, { 'Date Modified': 'not a date at all' }),
    ])
    const parsed = parseNeoFinderExport(toBuffer(text), 'x.txt')
    const file = parsed.nodes.find((n) => n.name === 'a.mov')!
    expect(file.modified).toBeNull()
    expect(parsed.report.warnings.some((w) => w.type === 'bad-date')).toBe(true)
  })

  it('warns when a folder size deviates >2% from the sum of its children', () => {
    const text = assemble([
      folderRow('SSD 1:X', 1000),
      fileRow('SSD 1:X:a.mov', 500), // 50% off — truncated export
    ])
    const parsed = parseNeoFinderExport(toBuffer(text), 'x.txt')
    expect(parsed.report.warnings.some((w) => w.type === 'size-mismatch')).toBe(true)
  })

  it('does not warn within the 2% tolerance', () => {
    const text = assemble([folderRow('SSD 1:X', 1000), fileRow('SSD 1:X:a.mov', 990)])
    const parsed = parseNeoFinderExport(toBuffer(text), 'x.txt')
    expect(parsed.report.warnings.filter((w) => w.type === 'size-mismatch')).toEqual([])
  })

  it('warns on a sized folder with no child rows (truncated export)', () => {
    const text = assemble([folderRow('SSD 1:X', 1000)])
    const parsed = parseNeoFinderExport(toBuffer(text), 'x.txt')
    expect(parsed.report.warnings.some((w) => w.type === 'no-children')).toBe(true)
  })

  it('skips rows without a Path and blank/whitespace lines', () => {
    const text = assemble([
      folderRow('SSD 1:X', 10),
      fileRow('SSD 1:X:a.mov', 10),
      row({ Name: 'orphan-without-path', Size: '5' }),
    ])
    const parsed = parseNeoFinderExport(toBuffer(text), 'x.txt')
    expect(parsed.report.fileCount).toBe(1)
    expect(parsed.report.warnings.some((w) => w.type === 'skipped-row')).toBe(true)
  })

  it('empty columns become nulls', () => {
    const text = assemble([
      folderRow('SSD 1:X', 10),
      fileRow('SSD 1:X:sidecar.xml', 10, {
        Kind: 'XML document',
        Width: '',
        Height: '',
        Duration: '',
        'Video Bitrate': '',
        'Media Info': '',
        'Date Created': '',
        'Date Modified': '',
      }),
    ])
    const file = parseNeoFinderExport(toBuffer(text), 'x.txt').nodes.find(
      (n) => n.name === 'sidecar.xml',
    )!
    expect(file.width).toBeNull()
    expect(file.duration).toBeNull()
    expect(file.created).toBeNull()
  })

  it('warns on duplicate paths (last row wins)', () => {
    const text = assemble([
      folderRow('SSD 1:X', 20),
      fileRow('SSD 1:X:a.mov', 5),
      fileRow('SSD 1:X:a.mov', 20),
    ])
    const parsed = parseNeoFinderExport(toBuffer(text), 'x.txt')
    expect(parsed.nodes.find((n) => n.name === 'a.mov')!.sizeBytes).toBe(20)
    expect(parsed.report.warnings.some((w) => w.type === 'duplicate-path')).toBe(true)
    expect(parsed.report.duplicateCount).toBe(1)
  })

  it('falls back to volume name when the metadata block is missing', () => {
    const text = assemble([folderRow('SSD 9:X', 10), fileRow('SSD 9:X:a.mov', 10)], false)
    const parsed = parseNeoFinderExport(toBuffer(text), 'ssd9.txt')
    expect(parsed.ssd.name).toBe('SSD 9')
    expect(parsed.ssd.id).toBe('name:SSD 9')
    expect(parsed.ssd.diskSerial).toBeNull()
  })

  it('rejects non-NeoFinder files with a clear error', () => {
    expect(() => parseNeoFinderExport(toBuffer('just some\nrandom text'), 'x.txt')).toThrow(
      /Export as Text/,
    )
  })
})

describe('multiple top-level folders (no common volume-name prefix)', () => {
  // Some NeoFinder exports don't prefix Path with the volume name at all —
  // every top-level project folder is then its own depth-0 "root". This is
  // normal and must never be treated as a merged/duplicate scan: a prior fix
  // that kept only one such root and discarded the rest caused real data
  // loss (a user's drive went from the correct ~981 GB / thousands of rows
  // down to ~300 GB / 3,134 rows after import). All top-level folders must
  // be kept and summed.
  it('keeps and sums every top-level folder, none are dropped', () => {
    const text = assemble(
      [
        folderRow('Alpha', 100),
        fileRow('Alpha:a.mov', 100),
        folderRow('Beta', 900),
        fileRow('Beta:b.mov', 900),
        folderRow('Gamma', 50),
        fileRow('Gamma:c.mov', 50),
      ],
      false,
    )
    const parsed = parseNeoFinderExport(toBuffer(text), 'x.txt')
    expect(parsed.report.warnings).toEqual([])
    expect(parsed.ssd.totalBytes).toBe(100 + 900 + 50)
    expect(parsed.report.fileCount).toBe(3)
    expect(parsed.nodes.some((n) => n.path === 'Alpha')).toBe(true)
    expect(parsed.nodes.some((n) => n.path === 'Beta')).toBe(true)
    expect(parsed.nodes.some((n) => n.path === 'Gamma')).toBe(true)
  })
})

describe('capacity metadata', () => {
  const body = [folderRow('SSD 1:X', 10), fileRow('SSD 1:X:a.mov', 10)]

  it('parses capacity and free space from the metadata block', () => {
    const text = assemble(body, true, [
      'Size 2 TB (2,000,398,934,016 Bytes)',
      'Free Space: 483,35 GB',
    ])
    const parsed = parseNeoFinderExport(toBuffer(text), 'x.txt')
    expect(parsed.ssd.capacityBytes).toBe(2000398934016)
    expect(parsed.ssd.freeBytes).toBe(483350000000)
    expect(parsed.report.capacityBytes).toBe(2000398934016)
    expect(parsed.ssd.userCapacityBytes).toBeNull()
  })

  it('leaves capacity null when the export has no capacity lines', () => {
    const parsed = parseNeoFinderExport(toBuffer(assemble(body)), 'x.txt')
    expect(parsed.ssd.capacityBytes).toBeNull()
    expect(parsed.ssd.freeBytes).toBeNull()
  })

  it('ignores unparseable capacity values without warnings', () => {
    const text = assemble(body, true, ['Size enormous', 'Free Space: loads'])
    const parsed = parseNeoFinderExport(toBuffer(text), 'x.txt')
    expect(parsed.ssd.capacityBytes).toBeNull()
    expect(parsed.ssd.freeBytes).toBeNull()
    expect(parsed.report.warnings).toEqual([])
  })

  it('does not confuse capacity lines with name or serial', () => {
    const text = assemble(body, true, ['Total Size 1 TB'])
    const parsed = parseNeoFinderExport(toBuffer(text), 'x.txt')
    expect(parsed.ssd.name).toBe('SSD 1')
    expect(parsed.ssd.diskSerial).toBe('3231144123')
    expect(parsed.ssd.capacityBytes).toBe(1e12)
  })
})

describe('kind classification', () => {
  it('classifies by Kind string first, extension second', () => {
    expect(classifyKind('clip.weird', 'QuickTime movie')).toBe('video')
    expect(classifyKind('clip.mxf', null)).toBe('video')
    expect(classifyKind('frame.cr2', null)).toBe('image')
    expect(classifyKind('edit.prproj', null)).toBe('project')
    expect(classifyKind('whatever.bin', null)).toBe('other')
  })
})

describe('scale', () => {
  it('parses a ~300k-row synthetic export without errors', () => {
    const lines: string[] = []
    const FOLDERS = 300
    const FILES = 1000
    for (let d = 0; d < FOLDERS; d++) {
      lines.push(folderRow(`SSD 1:Project ${d}`, FILES * 1000))
      for (let f = 0; f < FILES; f++) {
        lines.push(fileRow(`SSD 1:Project ${d}:clip_${f}.mov`, 1000))
      }
    }
    const buf = toBuffer(assemble(lines))
    const start = performance.now()
    const parsed = parseNeoFinderExport(buf, 'big.txt')
    const elapsed = performance.now() - start
    expect(parsed.report.fileCount).toBe(FOLDERS * FILES)
    expect(parsed.report.folderCount).toBe(FOLDERS + 1)
    expect(parsed.report.warnings).toEqual([])
    // Worker-thread parse; just ensure it's not pathological.
    expect(elapsed).toBeLessThan(30000)
  }, 60000)
})
