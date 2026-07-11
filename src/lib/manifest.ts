import type { Decision, NodeRec, SsdMeta } from './types'
import { dkey } from './types'
import { fmtDate, humanBytes, todayStamp } from './format'
import { resolveDeletions } from './resolve'
import { getDirectFiles } from './db'

export interface ManifestEntry {
  node: NodeRec
  note: string
}

/**
 * Full manifest for one SSD: maximal deletable folder subtrees, plus the
 * direct child files of delete-marked folders that couldn't be deleted
 * wholesale (a kept descendant blocks them).
 */
export async function buildManifest(
  ssdId: string,
  folders: NodeRec[],
  decisions: Record<string, Decision>,
  fetchDirectFiles: (ssdId: string, parentPath: string) => Promise<NodeRec[]> = (id, p) =>
    getDirectFiles(id, p),
): Promise<ManifestEntry[]> {
  const { folders: whole, partialParents } = resolveDeletions(folders, decisions, ssdId)
  const noteOf = (path: string) => decisions[dkey(ssdId, path)]?.note ?? ''
  const entries: ManifestEntry[] = whole.map((node) => ({ node, note: noteOf(node.path) }))
  for (const parent of partialParents) {
    for (const file of await fetchDirectFiles(ssdId, parent.path)) {
      entries.push({ node: file, note: '' })
    }
  }
  entries.sort((a, b) => b.node.sizeBytes - a.node.sizeBytes)
  return entries
}

/** `SSD 1:Foo:Bar` → `/Volumes/SSD 1/Foo/Bar`. */
export function toPosixPath(colonPath: string): string {
  return '/Volumes/' + colonPath.split(':').join('/')
}

const csvField = (s: string): string =>
  /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s

export function manifestCsv(entries: ManifestEntry[]): string {
  const lines = ['path_posix,size_bytes,size_human,last_modified,note']
  for (const { node, note } of entries) {
    lines.push(
      [
        csvField(toPosixPath(node.path)),
        String(node.sizeBytes),
        csvField(humanBytes(node.sizeBytes)),
        csvField(fmtDate(node.modified)),
        csvField(note),
      ].join(','),
    )
  }
  return lines.join('\n') + '\n'
}

export function manifestFileName(ssdName: string, ext: 'csv' | 'sh', now = new Date()): string {
  return `purge-manifest_${ssdName.replace(/\s+/g, '-')}_${todayStamp(now)}.${ext}`
}

const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

/**
 * Guarded deletion script. DRY_RUN=1 by default (prints targets); requires an
 * explicit DRY_RUN=0 plus a typed confirmation to actually rm -rf, and refuses
 * to run if the volume isn't mounted.
 */
export function manifestScript(ssd: SsdMeta, entries: ManifestEntry[], now = new Date()): string {
  const totalBytes = entries.reduce((s, e) => s + e.node.sizeBytes, 0)
  const volume = `/Volumes/${ssd.name}`
  const targets = entries.map((e) => `  ${shQuote(toPosixPath(e.node.path))}`).join('\n')
  return `#!/bin/bash
#
# Purge deletion manifest — ${ssd.name}
# Disk serial: ${ssd.diskSerial ?? 'unknown'}
# Generated:   ${todayStamp(now)}
# Items:       ${entries.length}
# Reclaims:    ${humanBytes(totalBytes)} (${totalBytes} bytes)
#
# DRY_RUN=1 (default) only lists targets. To delete for real:
#   DRY_RUN=0 bash ${manifestFileName(ssd.name, 'sh', now)}
#
set -euo pipefail

VOLUME=${shQuote(volume)}
DRY_RUN="\${DRY_RUN:-1}"

if [ ! -d "$VOLUME" ]; then
  echo "ERROR: $VOLUME is not mounted. Wrong or unmounted drive — aborting." >&2
  exit 1
fi

TARGETS=(
${targets}
)

if [ "$DRY_RUN" != "0" ]; then
  echo "DRY RUN — listing \${#TARGETS[@]} targets, nothing will be deleted."
  for t in "\${TARGETS[@]}"; do
    ls -d "$t" || echo "MISSING: $t"
  done
  echo "Re-run with DRY_RUN=0 to delete."
  exit 0
fi

echo "About to PERMANENTLY delete \${#TARGETS[@]} items (${humanBytes(totalBytes)}) from ${ssd.name}."
read -r -p "Type YES to continue: " CONFIRM
if [ "$CONFIRM" != "YES" ]; then
  echo "Aborted."
  exit 1
fi

for t in "\${TARGETS[@]}"; do
  if [ -e "$t" ]; then
    echo "Deleting $t"
    rm -rf "$t"
  else
    echo "Skipping (missing): $t"
  fi
done
echo "Done."
`
}

/** Copyable per-SSD reclaim summary, so the user knows which drives to mount first. */
export function reclaimSummary(
  rows: { ssd: SsdMeta; count: number; bytes: number }[],
): string {
  const lines = ['Purge reclaim summary — ' + todayStamp()]
  const sorted = [...rows].sort((a, b) => b.bytes - a.bytes)
  for (const r of sorted) {
    if (r.count === 0) continue
    lines.push(`${r.ssd.name}: ${humanBytes(r.bytes)} across ${r.count} items`)
  }
  const total = sorted.reduce((s, r) => s + r.bytes, 0)
  const count = sorted.reduce((s, r) => s + r.count, 0)
  lines.push(`TOTAL: ${humanBytes(total)} across ${count} items`)
  return lines.join('\n')
}
