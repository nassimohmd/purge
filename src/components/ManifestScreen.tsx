import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import type { Decision, SsdMeta } from '../lib/types'
import {
  buildManifest,
  manifestCsv,
  manifestFileName,
  manifestScript,
  reclaimSummary,
  toPosixPath,
  type ManifestEntry,
} from '../lib/manifest'
import { humanBytes, relAge } from '../lib/format'
import CapacityBar from './CapacityBar'

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

interface Group {
  ssd: SsdMeta
  entries: ManifestEntry[]
  bytes: number
}

export default function ManifestScreen() {
  const ssds = useStore((s) => s.ssds)
  const foldersBySsd = useStore((s) => s.foldersBySsd)
  const decisions = useStore((s) => s.decisions)
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [scriptOk, setScriptOk] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      const out: Group[] = []
      for (const ssd of ssds) {
        const entries = await buildManifest(ssd.id, foldersBySsd[ssd.id] ?? [], decisions)
        out.push({ ssd, entries, bytes: entries.reduce((s, e) => s + e.node.sizeBytes, 0) })
      }
      if (live) setGroups(out)
    })()
    return () => {
      live = false
    }
  }, [ssds, foldersBySsd, decisions])

  const reviewItems = useMemo(() => {
    const items: { d: Decision; ssdName: string }[] = []
    const names = new Map(ssds.map((s) => [s.id, s.name]))
    for (const key in decisions) {
      const d = decisions[key]
      if (d.state === 'review') items.push({ d, ssdName: names.get(d.ssdId) ?? d.ssdId })
    }
    items.sort((a, b) => a.ssdName.localeCompare(b.ssdName, undefined, { numeric: true }))
    return items
  }, [decisions, ssds])

  const nonEmpty = (groups ?? []).filter((g) => g.entries.length > 0)
  const totalBytes = nonEmpty.reduce((s, g) => s + g.bytes, 0)
  const summary = reclaimSummary(
    nonEmpty.map((g) => ({ ssd: g.ssd, count: g.entries.length, bytes: g.bytes })),
  )

  const exportCsv = (g: Group) =>
    download(
      new Blob([manifestCsv(g.entries)], { type: 'text/csv' }),
      manifestFileName(g.ssd.name, 'csv'),
    )

  const exportAll = () => {
    // Staggered so the browser doesn't swallow parallel downloads.
    nonEmpty.forEach((g, i) => setTimeout(() => exportCsv(g), i * 300))
  }

  const exportScript = (g: Group) =>
    download(
      new Blob([manifestScript(g.ssd, g.entries)], { type: 'text/x-shellscript' }),
      manifestFileName(g.ssd.name, 'sh'),
    )

  return (
    <div className="manifest">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
        <h2>Deletion manifest</h2>
        <span className="safety">
          Purge never modifies your drives. Execute the manifest manually per SSD.
        </span>
        <span style={{ flex: 1 }} />
        {nonEmpty.length > 1 && (
          <button className="primary" onClick={exportAll}>
            export all CSVs ({humanBytes(totalBytes)})
          </button>
        )}
      </div>

      {groups === null && <div className="empty">Resolving decisions…</div>}
      {groups !== null && nonEmpty.length === 0 && (
        <div className="empty">
          <div>Nothing marked for deletion yet.</div>
          <div>Mark folders with d on the triage board, then come back here.</div>
        </div>
      )}

      {nonEmpty.map((g) => (
        <div className="group" key={g.ssd.id}>
          <div className="group-head">
            <span className="gname">{g.ssd.name}</span>
            <span className="gmeta">
              {g.entries.length} {g.entries.length === 1 ? 'item' : 'items'} ·{' '}
              {humanBytes(g.bytes)} of {humanBytes(g.ssd.totalBytes)} cataloged
              {g.ssd.diskSerial ? ` · serial ${g.ssd.diskSerial}` : ''}
            </span>
          </div>
          <CapacityBar ssd={g.ssd} reclaimBytes={g.bytes} height={4} />
          <div className="entries">
            {g.entries.map(({ node, note }) => (
              <div className="entry" key={node.path}>
                <span className="epath" title={toPosixPath(node.path)}>
                  {toPosixPath(node.path)}
                  {node.folder ? '/' : ''}
                  {note ? <span style={{ color: 'var(--tx-2)' }}> — {note}</span> : null}
                </span>
                <span className="esize">
                  {humanBytes(node.sizeBytes)} · {relAge(node.modified)}
                </span>
              </div>
            ))}
          </div>
          <div className="actions">
            <button onClick={() => exportCsv(g)}>export CSV</button>
            <button disabled={!scriptOk} onClick={() => exportScript(g)}>
              export shell script
            </button>
          </div>
        </div>
      ))}

      {nonEmpty.length > 0 && (
        <>
          <label className="safety" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={scriptOk}
              onChange={(e) => setScriptOk(e.target.checked)}
            />
            I understand the shell script can permanently delete files when run with DRY_RUN=0.
          </label>
          <section>
            <h2>Reclaim summary</h2>
            <pre>{summary}</pre>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(summary).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                })
              }}
            >
              {copied ? 'copied' : 'copy summary'}
            </button>
          </section>
        </>
      )}

      {reviewItems.length > 0 && (
        <section>
          <h2>Review queue ({reviewItems.length})</h2>
          {reviewItems.map(({ d, ssdName }) => (
            <div className="review-item" key={d.key}>
              <span style={{ minWidth: 80 }}>{ssdName}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {d.path.split(':').slice(1).join(' / ')}
              </span>
              <span>{d.note}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
