import { useMemo } from 'react'
import { useStore } from '../state/store'
import { humanBytes } from '../lib/format'
import { computeSsdStats } from '../lib/stats'
import CapacityBar from './CapacityBar'
import Sunburst from './Sunburst'

/**
 * Compact live sunburst beside the triage table (toggle `v`). Shows the SSD
 * you're working in — the single-SSD filter if set, else the focused row's
 * drive — and tints red immediately as folders are marked delete.
 */
export default function SunburstPanel() {
  const ssds = useStore((s) => s.ssds)
  const foldersBySsd = useStore((s) => s.foldersBySsd)
  const decisions = useStore((s) => s.decisions)
  const filters = useStore((s) => s.filters)
  const focusKey = useStore((s) => s.focusKey)

  const ssd = useMemo(() => {
    if (filters.ssdIds.length === 1) {
      return ssds.find((s) => s.id === filters.ssdIds[0]) ?? null
    }
    if (focusKey !== null) {
      const focusSsd = focusKey.split('\u0000')[0]
      const hit = ssds.find((s) => s.id === focusSsd)
      if (hit) return hit
    }
    return ssds[0] ?? null
  }, [ssds, filters.ssdIds, focusKey])

  const folders = ssd ? (foldersBySsd[ssd.id] ?? []) : []
  const stats = useMemo(
    () => (ssd ? computeSsdStats(ssd, folders, decisions) : null),
    [ssd, folders, decisions],
  )

  if (!ssd || !stats) return null
  const s = useStore.getState()

  return (
    <div className="sunburst-panel">
      <div className="panel-head">
        <span className="panel-name">{ssd.name}</span>
        <button className="ghost" title="open full sunburst (o)" onClick={() => s.setDrillSsd(ssd.id)}>
          expand
        </button>
      </div>
      <CapacityBar ssd={ssd} reclaimBytes={stats.reclaimBytes} height={6} />
      <div className="panel-figures">
        <span>{humanBytes(stats.usedBytes)} used</span>
        {stats.reclaimBytes > 0 && <span className="marked">−{humanBytes(stats.reclaimBytes)}</span>}
      </div>
      <Sunburst
        ssdId={ssd.id}
        folders={folders}
        decisions={decisions}
        rootPath={null}
        size={280}
        centerLabel
        onSelect={(node) => s.openBoardForSsd(ssd.id, node.path)}
        onMark={(node, state) => s.mark([node], state)}
      />
      <div className="panel-hint">click a segment to jump the board · hover for mark buttons</div>
    </div>
  )
}
