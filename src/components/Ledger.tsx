import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { buildManifest } from '../lib/manifest'
import { humanBytes } from '../lib/format'

interface Totals {
  bytes: number
  folders: number
  files: number
  ssdCount: number
}

/**
 * The reclaim ledger — always visible. Computed with the same resolution as
 * the manifest exporter, so the number here is the number that ships.
 */
export default function Ledger() {
  const ssds = useStore((s) => s.ssds)
  const foldersBySsd = useStore((s) => s.foldersBySsd)
  const decisions = useStore((s) => s.decisions)
  const setScreen = useStore((s) => s.setScreen)
  const [totals, setTotals] = useState<Totals>({ bytes: 0, folders: 0, files: 0, ssdCount: 0 })

  useEffect(() => {
    let live = true
    void (async () => {
      const next: Totals = { bytes: 0, folders: 0, files: 0, ssdCount: 0 }
      for (const ssd of ssds) {
        const entries = await buildManifest(ssd.id, foldersBySsd[ssd.id] ?? [], decisions)
        if (entries.length > 0) next.ssdCount++
        for (const e of entries) {
          next.bytes += e.node.sizeBytes
          if (e.node.folder) next.folders++
          else next.files++
        }
      }
      if (live) setTotals(next)
    })()
    return () => {
      live = false
    }
  }, [ssds, foldersBySsd, decisions])

  const { bytes, folders, files, ssdCount } = totals
  const items = folders + files

  return (
    <div className="ledger">
      {items > 0 ? (
        <span>
          Marked: <span className="marked">{humanBytes(bytes)}</span> across {ssdCount}{' '}
          {ssdCount === 1 ? 'SSD' : 'SSDs'} · {folders} {folders === 1 ? 'folder' : 'folders'}
          {files > 0 ? ` + ${files} ${files === 1 ? 'file' : 'files'}` : ''}
        </span>
      ) : (
        <span>Nothing marked for deletion yet</span>
      )}
      <span className="spacer" />
      <button onClick={() => setScreen('manifest')}>Review manifest →</button>
    </div>
  )
}
