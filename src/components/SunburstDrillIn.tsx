import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import type { NodeRec } from '../lib/types'
import { parentPathOf } from '../lib/types'
import { humanBytes, relAge } from '../lib/format'
import { computeSsdStats } from '../lib/stats'
import CapacityBar from './CapacityBar'
import Sunburst from './Sunburst'

/**
 * Full-screen sunburst for one SSD (from the fleet card, board `o`, or the
 * panel's expand). Click a segment to zoom into it; Enter opens the board at
 * the current zoom root; [ and ] walk the fleet without leaving the overlay.
 */
export default function SunburstDrillIn() {
  const ssds = useStore((s) => s.ssds)
  const foldersBySsd = useStore((s) => s.foldersBySsd)
  const decisions = useStore((s) => s.decisions)
  const drillSsdId = useStore((s) => s.drillSsdId)
  const [zoomPath, setZoomPath] = useState<string | null>(null)

  // Reset zoom whenever the drive changes.
  useEffect(() => setZoomPath(null), [drillSsdId])

  const ssd = ssds.find((s) => s.id === drillSsdId) ?? null
  const folders = ssd ? (foldersBySsd[ssd.id] ?? []) : []
  const stats = useMemo(
    () => (ssd ? computeSsdStats(ssd, folders, decisions) : null),
    [ssd, folders, decisions],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }
      const s = useStore.getState()
      if (!s.drillSsdId || s.helpOpen || s.noteFor) return
      const idx = s.ssds.findIndex((x) => x.id === s.drillSsdId)
      switch (e.key) {
        case 'Backspace':
        case 'u':
          e.preventDefault()
          setZoomPath((p) => (p !== null ? nextZoomOut(p) : null))
          break
        case 'Enter':
          e.preventDefault()
          if (s.drillSsdId) {
            s.openBoardForSsd(s.drillSsdId, zoomPath ?? undefined)
          }
          break
        case '[':
          if (idx > 0) s.setDrillSsd(s.ssds[idx - 1].id)
          break
        case ']':
          if (idx >= 0 && idx < s.ssds.length - 1) s.setDrillSsd(s.ssds[idx + 1].id)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomPath])

  if (!ssd || !stats) return null
  const s = useStore.getState()

  const crumbs = zoomPath ? zoomPath.split(':') : []
  const chartSize = Math.round(Math.min(window.innerHeight, window.innerWidth) * 0.7)

  const onSelect = (node: NodeRec) => {
    // Aggregates have no real subtree; zoom to their parent instead.
    const path = folders.some((f) => f.path === node.path) ? node.path : node.parentPath
    if (path) setZoomPath(path)
  }

  return (
    <div className="focus drill">
      <div className="drill-body">
        <div className="drill-side">
          <div className="ssd-label">{ssd.name}</div>
          <CapacityBar ssd={ssd} reclaimBytes={stats.reclaimBytes} height={8} />
          <div className="drill-figures">
            <div>{humanBytes(stats.usedBytes)} used</div>
            {stats.freeBytes !== null && <div>{humanBytes(stats.freeBytes)} free</div>}
            {stats.reclaimBytes > 0 && (
              <div className="marked">−{humanBytes(stats.reclaimBytes)} marked</div>
            )}
            {stats.oldestModified !== null && <div>oldest {relAge(stats.oldestModified)}</div>}
          </div>
          <div className="drill-crumbs">
            <button className="ghost" onClick={() => setZoomPath(null)}>
              {ssd.name}
            </button>
            {crumbs.slice(1).map((seg, i) => (
              <span key={i}>
                {' / '}
                <button
                  className="ghost"
                  onClick={() => setZoomPath(crumbs.slice(0, i + 2).join(':'))}
                >
                  {seg}
                </button>
              </span>
            ))}
          </div>
          <div className="drill-legend">
            <div>
              <i style={{ background: 'var(--k-video)' }} /> video
              <i style={{ background: 'var(--k-image)' }} /> image
              <i style={{ background: 'var(--k-project)' }} /> project
              <i style={{ background: 'var(--k-other)' }} /> other
            </div>
            <div>
              <i style={{ background: 'var(--del-dim)', borderColor: 'var(--del)' }} /> marked
              delete · brighter = older
            </div>
          </div>
          <div className="drill-keys">
            click zoom in · hover for mark buttons · center/backspace zoom out · enter open in
            board · [ ] other SSDs · esc close
          </div>
          <button onClick={() => s.openBoardForSsd(ssd.id, zoomPath ?? undefined)}>
            open in board ↵
          </button>
        </div>
        <Sunburst
          ssdId={ssd.id}
          folders={folders}
          decisions={decisions}
          rootPath={zoomPath}
          size={chartSize}
          centerLabel
          onSelect={onSelect}
          onZoomOut={() => setZoomPath((p) => (p !== null ? nextZoomOut(p) : null))}
          onMark={(node, state) => s.mark([node], state)}
        />
      </div>
    </div>
  )
}

/** One ring out: parent path, or all the way out at depth 1. */
function nextZoomOut(path: string): string | null {
  const parent = parentPathOf(path)
  return parent !== null && parent.includes(':') ? parent : null
}
