import { useEffect, useMemo, useRef } from 'react'
import { useStore } from '../state/store'
import type { SsdMeta } from '../lib/types'
import { humanBytes, relAge } from '../lib/format'
import { computeSsdStats, type SsdStats } from '../lib/stats'
import CapacityBar from './CapacityBar'

/**
 * The fleet overview — every SSD as a card: capacity bar (kept · marked-red ·
 * free), reclaim figures, triage progress, oldest data. The landing screen for
 * a 30-drive fleet; Enter drops into the board filtered to one drive.
 */
export default function FleetScreen() {
  const ssds = useStore((s) => s.ssds)
  const foldersBySsd = useStore((s) => s.foldersBySsd)
  const decisions = useStore((s) => s.decisions)
  const focusIdx = useStore((s) => s.fleetFocusIdx)
  const gridRef = useRef<HTMLDivElement>(null)

  const stats = useMemo(
    () => ssds.map((ssd) => computeSsdStats(ssd, foldersBySsd[ssd.id] ?? [], decisions)),
    [ssds, foldersBySsd, decisions],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }
      const s = useStore.getState()
      if (s.helpOpen || s.noteFor || s.focusMode || s.drillSsdId || s.screen !== 'fleet') return
      if (ssds.length === 0) return

      const cols = gridCols(gridRef.current)
      const move = (delta: number) => {
        const next = Math.max(0, Math.min(ssds.length - 1, s.fleetFocusIdx + delta))
        s.setFleetFocusIdx(next)
        gridRef.current?.children[next]?.scrollIntoView({ block: 'nearest' })
      }
      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault()
          move(cols)
          break
        case 'k':
        case 'ArrowUp':
          e.preventDefault()
          move(-cols)
          break
        case 'h':
        case 'ArrowLeft':
          e.preventDefault()
          move(-1)
          break
        case 'l':
        case 'ArrowRight':
          e.preventDefault()
          move(1)
          break
        case 'Enter':
          e.preventDefault()
          if (ssds[s.fleetFocusIdx]) s.openBoardForSsd(ssds[s.fleetFocusIdx].id)
          break
        case 'o':
          if (ssds[s.fleetFocusIdx]) s.setDrillSsd(ssds[s.fleetFocusIdx].id)
          break
        case 'm':
          s.setScreen('manifest')
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ssds])

  if (ssds.length === 0) {
    return (
      <div className="empty">
        <div>No catalogs imported yet.</div>
        <div>
          Drop NeoFinder exports on the import screen — File → Export as Text in NeoFinder.
        </div>
        <button onClick={() => useStore.getState().setScreen('import')}>go to import</button>
      </div>
    )
  }

  return (
    <div className="fleet">
      <div className="fleet-grid" ref={gridRef}>
        {ssds.map((ssd, i) => (
          <FleetCard key={ssd.id} ssd={ssd} stats={stats[i]} focused={i === focusIdx} idx={i} />
        ))}
      </div>
      <div className="fleet-hint">
        j/k/h/l move · enter triage this SSD · o sunburst · m manifest
      </div>
    </div>
  )
}

/** Column count of the rendered grid, derived from actual layout. */
function gridCols(grid: HTMLDivElement | null): number {
  if (!grid || grid.children.length < 2) return 1
  const first = grid.children[0].getBoundingClientRect()
  let cols = 1
  for (let i = 1; i < grid.children.length; i++) {
    if (grid.children[i].getBoundingClientRect().top > first.top) break
    cols++
  }
  return cols
}

function FleetCard({
  ssd,
  stats,
  focused,
  idx,
}: {
  ssd: SsdMeta
  stats: SsdStats
  focused: boolean
  idx: number
}) {
  const s = useStore.getState()
  const decidedPct = Math.round(stats.decidedBytesFraction * 100)

  return (
    <div
      className={`fleet-card ${focused ? 'focused' : ''}`}
      onClick={() => {
        if (focused) s.openBoardForSsd(ssd.id)
        else s.setFleetFocusIdx(idx)
      }}
    >
      <div className="card-head">
        <span className="card-name">{ssd.name}</span>
        <button
          className="ghost card-burst"
          title="open sunburst (o)"
          onClick={(e) => {
            e.stopPropagation()
            s.setFleetFocusIdx(idx)
            s.setDrillSsd(ssd.id)
          }}
        >
          ◔ sunburst
        </button>
      </div>
      <CapacityBar ssd={ssd} reclaimBytes={stats.reclaimBytes} height={8} />
      <div className="card-figures">
        <span>{humanBytes(stats.usedBytes)} used</span>
        {stats.freeBytes !== null ? (
          <span>{humanBytes(stats.freeBytes)} free</span>
        ) : (
          <span className="dim">capacity?</span>
        )}
        {stats.reclaimBytes > 0 && (
          <span className="marked">−{humanBytes(stats.reclaimBytes)}</span>
        )}
      </div>
      <div className="card-meta">
        <span>{decidedPct}% decided</span>
        <span>
          {ssd.fileCount.toLocaleString()} files
          {stats.oldestModified !== null ? ` · oldest ${relAge(stats.oldestModified)}` : ''}
        </span>
      </div>
      <div className="card-progress">
        <div className="fill" style={{ width: `${decidedPct}%` }} />
      </div>
    </div>
  )
}
