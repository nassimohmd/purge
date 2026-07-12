import type { SsdMeta } from '../lib/types'
import { effectiveCapacity } from '../lib/types'
import { humanBytes } from '../lib/format'

/**
 * The drive-space bar: kept (cataloged minus marked) · reclaim (red, same
 * language as the manifest bar) · free. When capacity is unknown the track is
 * just the cataloged bytes and no free segment is drawn.
 */
export default function CapacityBar({
  ssd,
  reclaimBytes,
  height = 6,
}: {
  ssd: SsdMeta
  reclaimBytes: number
  height?: number
}) {
  const capacity = effectiveCapacity(ssd)
  const track = Math.max(1, capacity ?? ssd.totalBytes)
  const used = Math.min(ssd.totalBytes, track)
  const reclaim = Math.min(reclaimBytes, used)
  const keptPct = ((used - reclaim) / track) * 100
  const reclaimPct = (reclaim / track) * 100
  const free = capacity !== null ? Math.max(0, capacity - used) : null

  const title = [
    `used ${humanBytes(ssd.totalBytes)}`,
    reclaim > 0 ? `marked ${humanBytes(reclaim)}` : null,
    free !== null ? `free ${humanBytes(free)}` : null,
    capacity !== null ? `of ${humanBytes(capacity)}` : 'capacity unknown',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className={`capacity-bar${capacity === null ? ' unknown' : ''}`} style={{ height }} title={title}>
      <div className="seg kept" style={{ width: `${keptPct}%` }} />
      {reclaim > 0 && <div className="seg reclaim" style={{ width: `${reclaimPct}%` }} />}
    </div>
  )
}
