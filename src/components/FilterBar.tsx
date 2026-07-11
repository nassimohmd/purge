import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { humanBytes } from '../lib/format'
import type { AgeMonths, KindFilter, StateFilter } from '../lib/board'

const AGES: { v: AgeMonths; label: string }[] = [
  { v: 0, label: 'any age' },
  { v: 6, label: '>6m' },
  { v: 12, label: '>1y' },
  { v: 24, label: '>2y' },
]

// Log slider: 0 → no minimum, 1..100 → 1 MB … 1 TB.
const sliderToBytes = (v: number): number => (v <= 0 ? 0 : Math.round(10 ** (6 + (v / 100) * 6)))
const bytesToSlider = (b: number): number =>
  b <= 0 ? 0 : Math.max(1, Math.min(100, Math.round(((Math.log10(b) - 6) / 6) * 100)))

export default function FilterBar() {
  const ssds = useStore((s) => s.ssds)
  const filters = useStore((s) => s.filters)
  const setFilters = useStore((s) => s.setFilters)
  const [ssdOpen, setSsdOpen] = useState(false)
  const ddRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ssdOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!ddRef.current?.contains(e.target as Node)) setSsdOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [ssdOpen])

  const ssdLabel =
    filters.ssdIds.length === 0
      ? 'all SSDs'
      : filters.ssdIds.length === 1
        ? (ssds.find((s) => s.id === filters.ssdIds[0])?.name ?? '1 SSD')
        : `${filters.ssdIds.length} SSDs`

  return (
    <div className="filterbar">
      <div className="dd" ref={ddRef}>
        <button onClick={() => setSsdOpen(!ssdOpen)}>{ssdLabel} ▾</button>
        {ssdOpen && (
          <div className="dd-menu">
            <label>
              <input
                type="checkbox"
                checked={filters.ssdIds.length === 0}
                onChange={() => setFilters({ ssdIds: [] })}
              />
              all SSDs
            </label>
            {ssds.map((ssd) => (
              <label key={ssd.id}>
                <input
                  type="checkbox"
                  checked={filters.ssdIds.includes(ssd.id)}
                  onChange={(e) =>
                    setFilters({
                      ssdIds: e.target.checked
                        ? [...filters.ssdIds, ssd.id]
                        : filters.ssdIds.filter((id) => id !== ssd.id),
                    })
                  }
                />
                {ssd.name}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="seg">
        {AGES.map((a) => (
          <button
            key={a.v}
            className={filters.age === a.v ? 'active' : ''}
            onClick={() => setFilters({ age: a.v })}
          >
            {a.label}
          </button>
        ))}
      </div>

      <label htmlFor="minsize">min</label>
      <input
        id="minsize"
        type="range"
        min={0}
        max={100}
        value={bytesToSlider(filters.minSize)}
        onChange={(e) => setFilters({ minSize: sliderToBytes(Number(e.target.value)) })}
        style={{ width: 100 }}
      />
      <span style={{ minWidth: 56 }}>{filters.minSize > 0 ? `≥${humanBytes(filters.minSize)}` : 'any size'}</span>

      <select
        value={filters.kind}
        onChange={(e) => setFilters({ kind: e.target.value as KindFilter })}
        aria-label="kind"
      >
        <option value="all">all kinds</option>
        <option value="video">video-heavy</option>
        <option value="project">project files</option>
        <option value="mixed">mixed</option>
      </select>

      <select
        value={filters.state}
        onChange={(e) => setFilters({ state: e.target.value as StateFilter })}
        aria-label="decision state"
      >
        <option value="all">any state</option>
        <option value="undecided">undecided</option>
        <option value="keep">keep</option>
        <option value="delete">delete</option>
        <option value="review">review</option>
      </select>

      <input
        id="board-search"
        type="search"
        placeholder="/ search folders"
        value={filters.q}
        onChange={(e) => setFilters({ q: e.target.value })}
      />
    </div>
  )
}
