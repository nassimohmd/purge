import type { NodeRec, SsdMeta } from '../src/lib/types'

/**
 * NeoFinder tabbed-text fixture builder. Column order intentionally differs
 * from what the app cares about (mapping must be by header name), includes
 * MP3/ratings noise columns, CR-only line endings, and a metadata block.
 */
export const HEADER = [
  'Catalog',
  'Volume Name',
  'Ratings',
  'Name',
  'Path',
  'Size',
  'Kind',
  'Date Created',
  'Date Modified',
  'Media Info',
  'Width',
  'Height',
  'Duration',
  'Video Bitrate',
  'MP3 Artist',
  'MP3 Album',
] as const

export type Cell = Partial<Record<(typeof HEADER)[number], string>>

export function row(cells: Cell): string {
  return HEADER.map((h) => cells[h] ?? '').join('\t')
}

export function folderRow(path: string, size: number, modified = '27 June 2020 at 5:22 PM'): string {
  const name = path.split(':').pop()!
  return row({
    Catalog: 'SSD 1',
    'Volume Name': 'SSD 1',
    Ratings: '☆☆☆☆☆',
    Name: name,
    Path: path,
    Size: String(size),
    Kind: 'Folder',
    'Date Modified': modified,
  })
}

export function fileRow(
  path: string,
  size: number,
  extra: Cell = {},
): string {
  const name = path.split(':').pop()!
  return row({
    Catalog: 'SSD 1',
    'Volume Name': 'SSD 1',
    Ratings: '☆☆☆☆☆',
    Name: name,
    Path: path,
    Size: String(size),
    Kind: 'MPEG-4 movie',
    'Date Created': '26 June 2020 at 11:02 AM',
    'Date Modified': '27 June 2020 at 5:22 PM',
    ...extra,
  })
}

/** Assemble an export with classic-Mac CR line endings and trailing blanks. */
export function assemble(lines: string[], metadata = true, extraMeta: string[] = []): string {
  const all = [HEADER.join('\t')]
  if (metadata) {
    all.push('Name SSD 1', 'Serial Number 8', 'Disk Serial: 3231144123', ...extraMeta)
  }
  for (const line of lines) all.push(line)
  all.push('', '   ')
  return all.join('\r')
}

export function toBuffer(text: string): ArrayBuffer {
  const u8 = new TextEncoder().encode(text)
  return u8.buffer.slice(0, u8.byteLength) as ArrayBuffer
}

export function toUtf16LeBuffer(text: string): ArrayBuffer {
  const out = new Uint8Array(2 + text.length * 2)
  out[0] = 0xff
  out[1] = 0xfe
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    out[2 + i * 2] = c & 0xff
    out[3 + i * 2] = c >> 8
  }
  return out.buffer
}

/**
 * The verified real-export shape: SSD 1 with Hypedrop Logos at its documented
 * cumulative size, children summing exactly (no warnings expected).
 */
export function sampleSsd1(): string {
  const lines: string[] = []
  lines.push(folderRow('SSD 1:Hypedrop Logos', 947979210))
  lines.push(folderRow('SSD 1:Hypedrop Logos:Snowbombing 2023', 500000000))
  lines.push(
    fileRow('SSD 1:Hypedrop Logos:Snowbombing 2023:main.mp4', 500000000, {
      'Media Info': 'H.264, AAC',
      Width: '3840',
      Height: '2160',
      Duration: '12:34',
      'Video Bitrate': '45 Mbit/s',
    }),
  )
  lines.push(fileRow('SSD 1:Hypedrop Logos:logo_v1.mov', 300000000))
  lines.push(fileRow('SSD 1:Hypedrop Logos:logo_v2.mov', 147979210))
  lines.push(folderRow('SSD 1:JA Golf 25', 3000))
  lines.push(
    fileRow('SSD 1:JA Golf 25:edit.prproj', 3000, { Kind: 'Adobe Premiere Pro project' }),
  )
  return assemble(lines)
}

// --- helpers for resolve/manifest tests (in-memory NodeRecs) ---

export function mkSsd(id: string, patch: Partial<SsdMeta> = {}): SsdMeta {
  return {
    id,
    name: 'SSD 1',
    diskSerial: '3231',
    importedAt: 0,
    totalBytes: 1000,
    fileCount: 1,
    folderCount: 1,
    sourceFileName: 'x.txt',
    capacityBytes: null,
    freeBytes: null,
    userCapacityBytes: null,
    ...patch,
  }
}

export function mkNode(
  ssdId: string,
  path: string,
  folder: 0 | 1,
  sizeBytes: number,
  patch: Partial<NodeRec> = {},
): NodeRec {
  const i = path.lastIndexOf(':')
  return {
    ssdId,
    path,
    parentPath: i === -1 ? null : path.slice(0, i),
    name: i === -1 ? path : path.slice(i + 1),
    depth: path.split(':').length - 1,
    folder,
    kind: folder ? 'Folder' : null,
    sizeBytes,
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
    ...patch,
  }
}
