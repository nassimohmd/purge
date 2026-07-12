import { useMemo, useRef, useState } from 'react'
import type { Decision, NodeRec } from '../lib/types'
import { humanBytes, relAge } from '../lib/format'
import { effectiveState } from '../lib/resolve'
import { ageT } from '../lib/stats'
import { arcPath, buildSunburst, type SunSeg } from '../lib/sunburst'

const HOLE = 0.22
const KIND_VAR: Record<string, string> = {
  video: 'var(--k-video)',
  image: 'var(--k-image)',
  project: 'var(--k-project)',
  other: 'var(--k-other)',
}

/** Dominant content bucket by cumulative bytes (kindLabel has no image bucket). */
export function dominantBucket(n: NodeRec): keyof typeof KIND_VAR {
  const buckets = [
    ['video', n.videoBytes],
    ['image', n.imageBytes],
    ['project', n.projectBytes],
    ['other', n.otherBytes],
  ] as const
  let best: (typeof buckets)[number] = buckets[3]
  for (const b of buckets) if (b[1] > best[1]) best = b
  return best[1] > 0 ? best[0] : 'other'
}

interface Tip {
  seg: SunSeg
  x: number
  y: number
}

/**
 * Hand-rolled SVG sunburst. Layout is memoized on (folders, rootPath) only —
 * decisions tint segments at render time, so marking `d` on the board never
 * triggers a relayout.
 */
export default function Sunburst({
  ssdId,
  folders,
  decisions,
  rootPath,
  size,
  onSelect,
  onZoomOut,
  centerLabel,
}: {
  ssdId: string
  folders: NodeRec[]
  decisions: Record<string, Decision>
  rootPath: string | null
  size: number
  /** Click on a segment. */
  onSelect?: (node: NodeRec, seg: SunSeg) => void
  /** Click on the center hole. */
  onZoomOut?: () => void
  centerLabel?: boolean
}) {
  const { segs, root } = useMemo(
    () => buildSunburst(folders, ssdId, { rootPath }),
    [folders, ssdId, rootPath],
  )
  const [tip, setTip] = useState<Tip | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const maxRing = segs.reduce((m, s) => Math.max(m, s.ring), 0)
  const ringW = (1 - HOLE) / (maxRing + 1)

  const segAt = (el: Element | null): SunSeg | null => {
    const i = el instanceof SVGPathElement ? Number(el.dataset.i) : NaN
    return Number.isInteger(i) ? segs[i] : null
  }

  return (
    <div className="sunburst" ref={wrapRef} style={{ width: size, height: size }}>
      <svg
        viewBox="-1.02 -1.02 2.04 2.04"
        width={size}
        height={size}
        onMouseMove={(e) => {
          const seg = segAt(e.target as Element)
          if (!seg) {
            setTip(null)
            return
          }
          const box = wrapRef.current!.getBoundingClientRect()
          setTip({ seg, x: e.clientX - box.left, y: e.clientY - box.top })
        }}
        onMouseLeave={() => setTip(null)}
        onClick={(e) => {
          const seg = segAt(e.target as Element)
          if (seg) onSelect?.(seg.node, seg)
        }}
      >
        {segs.map((s, i) => {
          const state = s.aggregate
            ? 'undecided'
            : effectiveState(decisions, ssdId, s.node.path)
          const del = state === 'delete'
          const fill = del ? 'var(--del-dim)' : KIND_VAR[dominantBucket(s.node)]
          // Older = fuller; delete keeps full presence (red owns it); keep recedes.
          const opacity = del ? 0.9 : state === 'keep' ? 0.25 : 0.35 + 0.55 * ageT(s.node.modified)
          return (
            <path
              key={i}
              data-i={i}
              d={arcPath(s.a0, s.a1, HOLE + s.ring * ringW, HOLE + (s.ring + 1) * ringW)}
              fill={fill}
              fillOpacity={opacity}
              stroke={del ? 'var(--del)' : 'var(--bg-0)'}
              strokeWidth={del ? 0.012 : 0.008}
              strokeDasharray={state === 'review' ? '0.03 0.02' : undefined}
              style={{ cursor: onSelect ? 'pointer' : 'default' }}
            />
          )
        })}
        <circle
          cx={0}
          cy={0}
          r={HOLE - 0.01}
          fill="var(--bg-1)"
          style={{ cursor: onZoomOut ? 'pointer' : 'default' }}
          onClick={(e) => {
            e.stopPropagation()
            onZoomOut?.()
          }}
        />
        {centerLabel && root && (
          <g pointerEvents="none" fill="var(--tx-1)" textAnchor="middle" fontFamily="var(--mono)">
            <text y={-0.015} fontSize={0.062}>
              {root.name.length > 12 ? root.name.slice(0, 11) + '…' : root.name}
            </text>
            <text y={0.07} fontSize={0.052} fill="var(--tx-2)">
              {humanBytes(root.sizeBytes)}
            </text>
          </g>
        )}
      </svg>
      {tip && (
        <div
          className="sunburst-tip"
          style={{
            left: Math.min(tip.x + 12, size - 140),
            top: tip.y + 12,
          }}
        >
          <div className="tip-name">
            {tip.seg.aggregate
              ? `other: ${tip.seg.aggregate.count} folders`
              : tip.seg.node.name}
          </div>
          <div className="tip-meta">
            {humanBytes(tip.seg.node.sizeBytes)}
            {tip.seg.aggregate === null && (
              <>
                {' · '}
                {relAge(tip.seg.node.modified)}
                {tip.seg.node.fileCount > 0 &&
                  ` · ${tip.seg.node.fileCount.toLocaleString()} files`}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
