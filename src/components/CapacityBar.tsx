import type { SsdMeta } from '../lib/types'
import { effectiveCapacity } from '../lib/types'
import { humanBytes } from '../lib/format'

// Muted green → amber → red, CVD-validated against --bg-0 (see styles.css
// --fill-low/-mid/-high). CSS custom properties can't interpolate colors, so
// the "how full" fill is computed here from usedPct and applied inline.
const FILL_LOW: [number, number, number] = [95, 158, 106] // #5f9e6a
const FILL_MID: [number, number, number] = [184, 135, 58] // #b8873a
const FILL_HIGH: [number, number, number] = [193, 82, 63] // #c1523f

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t)
}

function fillColor(pct: number): string {
  const t = Math.max(0, Math.min(1, pct))
  const [from, to, u] = t <= 0.5 ? [FILL_LOW, FILL_MID, t / 0.5] : [FILL_MID, FILL_HIGH, (t - 0.5) / 0.5]
  return `rgb(${lerp(from[0], to[0], u)}, ${lerp(from[1], to[1], u)}, ${lerp(from[2], to[2], u)})`
}

/**
 * The drive-space bar: kept (cataloged minus marked, tinted green→red by how
 * full the drive is) · reclaim (red, same language as the manifest bar) ·
 * free. When capacity is unknown the track is just the cataloged bytes, the
 * fill stays neutral (no real fill % to encode), and no free segment is drawn.
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
  const keptColor = capacity !== null ? fillColor(used / track) : undefined

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
      <div
        className="seg kept"
        style={{ width: `${keptPct}%`, backgroundColor: keptColor }}
      />
      {reclaim > 0 && <div className="seg reclaim" style={{ width: `${reclaimPct}%` }} />}
    </div>
  )
}
