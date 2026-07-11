import type {
  ImportReport,
  ImportWarning,
  NodeRec,
  ParseResult,
  SsdMeta,
} from '../types'
import { lastSegment, parentPathOf } from '../types'

// ---------------------------------------------------------------------------
// Decoding & line endings
// ---------------------------------------------------------------------------

/** Sniff BOM (NeoFinder can emit UTF-8 or UTF-16), decode accordingly. */
export function decodeExport(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf)
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(b.subarray(2))
  }
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(b.subarray(2))
  }
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(b.subarray(3))
  }
  return new TextDecoder('utf-8').decode(b)
}

/** CRLF → LF, then lone CR (classic Mac, what NeoFinder actually emits) → LF. */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

// ---------------------------------------------------------------------------
// Dates — "27 June 2020 at 5:22 PM", day-name optional, never fail a row
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {}
for (const [i, m] of [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
].entries()) {
  MONTHS[m] = i
  MONTHS[m.slice(0, 3)] = i
}

const DMY = /(\d{1,2})\.?\s+([A-Za-z]+)\.?\s+(\d{4})/
const MDY = /([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/
const TIME = /at\s+(\d{1,2})[:.](\d{2})(?::(\d{2}))?\s*([AP]\.?M\.?)?/i

export function parseNeoDate(raw: string): number | null {
  const s = raw.trim()
  if (!s) return null
  let day: number | undefined
  let month: number | undefined
  let year: number | undefined
  let m = s.match(DMY)
  if (m) {
    day = Number(m[1])
    month = MONTHS[m[2].toLowerCase()]
    year = Number(m[3])
  } else if ((m = s.match(MDY))) {
    month = MONTHS[m[1].toLowerCase()]
    day = Number(m[2])
    year = Number(m[3])
  }
  if (day === undefined || month === undefined || year === undefined) return null
  if (day < 1 || day > 31) return null
  let h = 0
  let min = 0
  let sec = 0
  const t = s.match(TIME)
  if (t) {
    h = Number(t[1])
    min = Number(t[2])
    sec = t[3] ? Number(t[3]) : 0
    const ampm = t[4]?.toUpperCase().replace(/\./g, '')
    if (ampm === 'PM' && h < 12) h += 12
    if (ampm === 'AM' && h === 12) h = 0
  }
  const d = new Date(year, month, day, h, min, sec)
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

// ---------------------------------------------------------------------------
// Kind buckets (dominant-kind evidence: "84% video")
// ---------------------------------------------------------------------------

export type KindBucket = 'video' | 'image' | 'project' | 'other'

const VIDEO_EXT =
  /\.(mp4|mov|mxf|m4v|avi|mkv|mts|m2ts|mpg|mpeg|webm|r3d|braw|crm|arri|ari|insv|360|wmv|flv)$/i
const IMAGE_EXT =
  /\.(jpe?g|png|tiff?|gif|bmp|heic|heif|webp|cr2|cr3|arw|dng|raf|nef|orf|rw2|exr|dpx)$/i
const PROJECT_EXT =
  /\.(prproj|aep|aet|drp|dra|fcpxmld?|fcpbundle|xml|aaf|edl|otio|cube|look|mogrt|motn|psd|ai|indd|c4d|blend|plist|json|txt|pek|cfa|xmp|srt)$/i

export function classifyKind(name: string, kind: string | null): KindBucket {
  const k = (kind ?? '').toLowerCase()
  if (k.includes('movie') || k.includes('video')) return 'video'
  if (k.includes('image') || k.includes('picture') || k.includes('photo')) return 'image'
  if (VIDEO_EXT.test(name)) return 'video'
  if (IMAGE_EXT.test(name)) return 'image'
  if (PROJECT_EXT.test(name)) return 'project'
  return 'other'
}

// ---------------------------------------------------------------------------
// Main parse
// ---------------------------------------------------------------------------

const WARN_CAP = 25 // per warning type, so a mangled export can't flood the report

interface Counters {
  badDates: number
  duplicates: number
  skipped: number
}

const emptyToNull = (s: string | undefined): string | null => {
  const t = s?.trim()
  return t ? t : null
}

const numOrNull = (s: string | undefined): number | null => {
  const t = s?.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function parseNeoFinderExport(
  buf: ArrayBuffer,
  sourceFileName: string,
  onProgress?: (done: number, total: number) => void,
): ParseResult {
  const text = normalizeLineEndings(decodeExport(buf))
  const lines = text.split('\n')

  // Header row: the first line with several tab fields including Name + Path.
  let headerIdx = -1
  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    const f = lines[i].split('\t')
    if (f.length >= 5 && f.includes('Path') && f.includes('Name')) {
      headerIdx = i
      break
    }
  }
  if (headerIdx === -1) {
    throw new Error(
      'Not a NeoFinder tabbed text export — no header row with Name/Path columns found. ' +
        'In NeoFinder use File → Export as Text.',
    )
  }

  // Map columns by header name, never by position.
  const headers = lines[headerIdx].split('\t').map((h) => h.trim())
  const col: Record<string, number> = {}
  headers.forEach((h, i) => {
    if (h && !(h in col)) col[h] = i
  })
  const cName = col['Name'] ?? -1
  const cPath = col['Path'] ?? -1
  const cSize = col['Size'] ?? -1
  const cCreated = col['Date Created'] ?? -1
  const cModified = col['Date Modified'] ?? -1
  const cMediaInfo = col['Media Info'] ?? -1
  const cVideoBitrate = col['Video Bitrate'] ?? -1
  const cHeight = col['Height'] ?? -1
  const cWidth = col['Width'] ?? -1
  const cDuration = col['Duration'] ?? -1
  const cKind = col['Kind'] ?? -1
  if (cPath === -1) throw new Error('Export has no Path column')

  const warnings: ImportWarning[] = []
  const counters: Counters = { badDates: 0, duplicates: 0, skipped: 0 }
  const warn = (type: ImportWarning['type'], message: string) => {
    if (warnings.filter((w) => w.type === type).length < WARN_CAP) {
      warnings.push({ type, message })
    }
  }

  let metaName: string | null = null
  let diskSerial: string | null = null

  const nodes = new Map<string, NodeRec>()
  const synthetic = new Set<string>()
  const field = (f: string[], i: number) => (i >= 0 && i < f.length ? f[i] : '')

  const total = lines.length
  for (let i = headerIdx + 1; i < total; i++) {
    if (onProgress && i % 20000 === 0) onProgress(i, total)
    const line = lines[i]
    if (!line.trim()) continue

    const f = line.split('\t')
    if (f.length < 3) {
      // Disk metadata block: non-tabbed lines like "Name SSD 1", "Disk Serial: 3231…".
      const t = line.trim()
      let m: RegExpMatchArray | null
      if ((m = t.match(/^Disk Serial\s*:?\s*(.+)$/i))) {
        diskSerial = m[1].trim()
      } else if ((m = t.match(/^Name\s*:?\s*(.+)$/)) && !/^Serial/i.test(t)) {
        if (metaName == null) metaName = m[1].trim()
      }
      // "Serial Number N" is the catalog number, not disk identity — ignored.
      continue
    }

    const path = field(f, cPath).trim()
    if (!path) {
      counters.skipped++
      continue
    }

    const kind = emptyToNull(field(f, cKind))
    const isFolder = kind === 'Folder'
    const name = emptyToNull(field(f, cName)) ?? lastSegment(path)
    const sizeRaw = field(f, cSize).trim()
    const sizeBytes = /^\d+$/.test(sizeRaw) ? Number(sizeRaw) : 0

    const parseDateField = (raw: string): number | null => {
      const t = raw.trim()
      if (!t) return null
      const ms = parseNeoDate(t)
      if (ms === null) {
        counters.badDates++
        warn('bad-date', `Unparseable date "${t}" on ${path}`)
      }
      return ms
    }

    const rec: NodeRec = {
      ssdId: '', // filled in below once identity is known
      path,
      parentPath: parentPathOf(path),
      name,
      depth: path.split(':').length - 1,
      folder: isFolder ? 1 : 0,
      kind,
      sizeBytes,
      created: parseDateField(field(f, cCreated)),
      modified: parseDateField(field(f, cModified)),
      mediaInfo: emptyToNull(field(f, cMediaInfo)),
      width: numOrNull(field(f, cWidth)),
      height: numOrNull(field(f, cHeight)),
      duration: emptyToNull(field(f, cDuration)),
      videoBitrate: emptyToNull(field(f, cVideoBitrate)),
      fileCount: 0,
      videoBytes: 0,
      imageBytes: 0,
      projectBytes: 0,
      otherBytes: 0,
    }
    if (nodes.has(path)) {
      counters.duplicates++
      warn('duplicate-path', `Duplicate row for ${path} (last one wins)`)
    }
    nodes.set(path, rec)
    synthetic.delete(path)
  }
  onProgress?.(total, total)

  // Create any missing ancestors (always includes the depth-0 volume root,
  // which NeoFinder does not emit as a row).
  for (const node of [...nodes.values()]) {
    let pp = node.parentPath
    while (pp !== null && !nodes.has(pp)) {
      nodes.set(pp, {
        ssdId: '',
        path: pp,
        parentPath: parentPathOf(pp),
        name: lastSegment(pp),
        depth: pp.split(':').length - 1,
        folder: 1,
        kind: 'Folder',
        sizeBytes: 0,
        created: null,
        modified: null,
        mediaInfo: null,
        width: null,
        height: null,
        duration: null,
        videoBitrate: null,
        fileCount: 0,
        videoBytes: 0,
        imageBytes: 0,
        projectBytes: 0,
        otherBytes: 0,
      })
      synthetic.add(pp)
      pp = parentPathOf(pp)
    }
  }

  // Synthetic folders have no declared size — fill from children, deepest first.
  const synthPaths = [...synthetic].sort(
    (a, b) => b.split(':').length - a.split(':').length,
  )
  const childrenOf = new Map<string, NodeRec[]>()
  for (const n of nodes.values()) {
    if (n.parentPath !== null) {
      const arr = childrenOf.get(n.parentPath)
      if (arr) arr.push(n)
      else childrenOf.set(n.parentPath, [n])
    }
  }
  for (const p of synthPaths) {
    const rec = nodes.get(p)!
    rec.sizeBytes = (childrenOf.get(p) ?? []).reduce((s, c) => s + c.sizeBytes, 0)
  }

  // Sanity check: folder rows carry authoritative CUMULATIVE sizes, but a
  // declared size deviating >2% from the sum of direct children flags a
  // truncated/partial export.
  for (const n of nodes.values()) {
    if (!n.folder || synthetic.has(n.path) || n.sizeBytes <= 0) continue
    const kids = childrenOf.get(n.path) ?? []
    const sum = kids.reduce((s, c) => s + c.sizeBytes, 0)
    if (kids.length === 0) {
      warn('no-children', `Folder ${n.path} declares ${n.sizeBytes} B but has no child rows`)
    } else if (Math.abs(n.sizeBytes - sum) / n.sizeBytes > 0.02) {
      warn(
        'size-mismatch',
        `Folder ${n.path} declares ${n.sizeBytes} B but children sum to ${sum} B`,
      )
    }
  }

  // Cumulative per-folder aggregates: file count + kind byte buckets.
  let fileCount = 0
  let folderCount = 0
  let dateMin: number | null = null
  let dateMax: number | null = null
  for (const n of nodes.values()) {
    if (n.folder) {
      folderCount++
      continue
    }
    fileCount++
    if (n.modified !== null) {
      if (dateMin === null || n.modified < dateMin) dateMin = n.modified
      if (dateMax === null || n.modified > dateMax) dateMax = n.modified
    }
    const bucket = classifyKind(n.name, n.kind)
    let pp = n.parentPath
    while (pp !== null) {
      const parent = nodes.get(pp)
      if (!parent) break
      parent.fileCount++
      if (bucket === 'video') parent.videoBytes += n.sizeBytes
      else if (bucket === 'image') parent.imageBytes += n.sizeBytes
      else if (bucket === 'project') parent.projectBytes += n.sizeBytes
      else parent.otherBytes += n.sizeBytes
      pp = parent.parentPath
    }
  }

  if (counters.skipped > 0) {
    warn('skipped-row', `${counters.skipped} row(s) skipped (no Path)`)
  }

  // Identity: prefer the disk serial (stable even if the drive is renamed).
  const roots = [...nodes.values()].filter((n) => n.depth === 0)
  const ssdName = metaName ?? roots[0]?.name ?? sourceFileName.replace(/\.txt$/i, '')
  const ssdId = diskSerial ? `sn:${diskSerial}` : `name:${ssdName}`
  const totalBytes = roots.reduce((s, r) => s + r.sizeBytes, 0)
  for (const n of nodes.values()) n.ssdId = ssdId

  const ssd: SsdMeta = {
    id: ssdId,
    name: ssdName,
    diskSerial,
    importedAt: Date.now(),
    totalBytes,
    fileCount,
    folderCount,
    sourceFileName,
  }
  const report: ImportReport = {
    ssdName,
    diskSerial,
    rowCount: fileCount + folderCount,
    fileCount,
    folderCount,
    totalBytes,
    dateMin,
    dateMax,
    warnings,
    sourceFileName,
  }
  return { ssd, nodes: [...nodes.values()], report }
}
