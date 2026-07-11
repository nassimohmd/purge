import { useEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useStore, nodeKey } from '../state/store'
import type { NodeRec } from '../lib/types'
import { dkey } from '../lib/types'
import { buildTriageList, hasDescendantDecisions, kindLabel, type SortCol } from '../lib/board'
import { effectiveState } from '../lib/resolve'
import { humanBytes, relAge } from '../lib/format'
import FilterBar from './FilterBar'

type FlatRow =
  | { type: 'folder'; node: NodeRec; level: number }
  | { type: 'file'; node: NodeRec; level: number }
  | { type: 'more'; node: NodeRec; level: number; remaining: number }

const rowId = (r: FlatRow): string =>
  r.type === 'more' ? nodeKey(r.node) + '\u0000#more' : nodeKey(r.node)

const GLYPH: Record<string, string> = { keep: '●', review: '○', delete: '●', undecided: '' }

const COLS: { col: SortCol | null; label: string; cls?: string }[] = [
  { col: 'state', label: '' },
  { col: 'name', label: 'folder' },
  { col: 'ssd', label: 'ssd' },
  { col: 'size', label: 'size', cls: 'num' },
  { col: 'modified', label: 'modified', cls: 'num' },
  { col: 'files', label: 'files', cls: 'num' },
  { col: 'kind', label: 'kind' },
  { col: null, label: '' },
]

export default function TriageBoard() {
  const ssds = useStore((s) => s.ssds)
  const foldersBySsd = useStore((s) => s.foldersBySsd)
  const decisions = useStore((s) => s.decisions)
  const filters = useStore((s) => s.filters)
  const sort = useStore((s) => s.sort)
  const focusKey = useStore((s) => s.focusKey)
  const selected = useStore((s) => s.selected)
  const expanded = useStore((s) => s.expanded)

  const ssdNames = useMemo(() => new Map(ssds.map((s) => [s.id, s.name])), [ssds])

  const triage = useMemo(
    () => buildTriageList(ssds, foldersBySsd, decisions, filters, sort),
    [ssds, foldersBySsd, decisions, filters, sort],
  )

  // Child-folder index per SSD, size-desc, for expansion.
  const childIdx = useMemo(() => {
    const idx = new Map<string, NodeRec[]>()
    for (const ssd of ssds) {
      for (const f of foldersBySsd[ssd.id] ?? []) {
        if (f.parentPath === null || f.depth < 2) continue
        const key = dkey(f.ssdId, f.parentPath)
        const arr = idx.get(key)
        if (arr) arr.push(f)
        else idx.set(key, [f])
      }
    }
    for (const arr of idx.values()) arr.sort((a, b) => b.sizeBytes - a.sizeBytes)
    return idx
  }, [ssds, foldersBySsd])

  const flatRows = useMemo(() => {
    const rows: FlatRow[] = []
    const push = (node: NodeRec, level: number) => {
      rows.push({ type: 'folder', node, level })
      const ex = expanded[nodeKey(node)]
      if (!ex) return
      for (const sub of childIdx.get(dkey(node.ssdId, node.path)) ?? []) {
        push(sub, level + 1)
      }
      if (ex.files) {
        for (const f of ex.files) rows.push({ type: 'file', node: f, level: level + 1 })
        if (!ex.all && ex.total > ex.files.length) {
          rows.push({ type: 'more', node, level: level + 1, remaining: ex.total - ex.files.length })
        }
      }
    }
    for (const n of triage) push(n, 0)
    return rows
  }, [triage, expanded, childIdx])

  const idxById = useMemo(() => {
    const m = new Map<string, number>()
    flatRows.forEach((r, i) => m.set(rowId(r), i))
    return m
  }, [flatRows])

  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 34,
    overscan: 12,
  })

  // Keyboard triage — the whole point of the tool.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }
      const s = useStore.getState()
      if (s.helpOpen || s.noteFor || s.focusMode || s.screen !== 'board') return

      const focusIdx = s.focusKey !== null ? (idxById.get(s.focusKey) ?? -1) : -1
      const focusedRow = focusIdx >= 0 ? flatRows[focusIdx] : null

      const markTargets = (): NodeRec[] => {
        if (s.selected.size > 0) {
          const out: NodeRec[] = []
          for (const r of flatRows) {
            if (r.type === 'folder' && s.selected.has(rowId(r))) out.push(r.node)
          }
          if (out.length > 0) return out
        }
        return focusedRow && focusedRow.type === 'folder' ? [focusedRow.node] : []
      }

      const move = (delta: number) => {
        const next = Math.max(0, Math.min(flatRows.length - 1, focusIdx < 0 ? 0 : focusIdx + delta))
        if (flatRows[next]) {
          s.setFocusKey(rowId(flatRows[next]))
          virtualizer.scrollToIndex(next, { align: 'auto' })
        }
      }

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault()
          move(1)
          break
        case 'k':
        case 'ArrowUp':
          e.preventDefault()
          move(-1)
          break
        case 'Enter':
          e.preventDefault()
          if (!focusedRow) break
          if (focusedRow.type === 'folder') s.toggleExpanded(focusedRow.node)
          else if (focusedRow.type === 'more') s.loadAllFiles(focusedRow.node)
          break
        case 'x':
          if (focusedRow?.type === 'folder') {
            s.toggleSelect(rowId(focusedRow))
            move(1)
          }
          break
        case 'd':
          s.mark(markTargets(), 'delete')
          s.clearSelection()
          if (s.selected.size === 0) move(1)
          break
        case 'f':
          s.mark(markTargets(), 'keep')
          s.clearSelection()
          if (s.selected.size === 0) move(1)
          break
        case 'r':
          s.mark(markTargets(), 'review')
          s.clearSelection()
          if (s.selected.size === 0) move(1)
          break
        case 'u':
          s.mark(markTargets(), null)
          s.clearSelection()
          break
        case 'n':
          e.preventDefault()
          s.openNoteEditor(markTargets())
          break
        case 'z':
          s.undo()
          break
        case '/': {
          e.preventDefault()
          const el = document.getElementById('board-search')
          el?.focus()
          break
        }
        case 'g':
          s.cycleSsdFilter()
          break
        case 'm':
          s.setScreen('manifest')
          break
        case ' ':
          e.preventDefault()
          if (focusedRow?.type === 'folder') s.setFocusKey(rowId(focusedRow))
          s.setFocusMode(true)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flatRows, idxById, virtualizer])

  const store = useStore.getState()

  if (ssds.length === 0) {
    return (
      <div className="empty">
        <div>No catalogs imported yet.</div>
        <div>
          Drop NeoFinder exports on the import screen — File → Export as Text in NeoFinder.
        </div>
        <button onClick={() => store.setScreen('import')}>go to import</button>
      </div>
    )
  }

  return (
    <div className="board">
      <FilterBar />
      <div className="thead">
        {COLS.map(({ col, label, cls }, i) => (
          <span
            key={i}
            className={`th ${cls ?? ''} ${col && sort.col === col ? 'active' : ''}`}
            style={cls === 'num' ? { textAlign: 'right' } : undefined}
            onClick={col ? () => store.setSort(col) : undefined}
          >
            {label}
            {col && sort.col === col ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}
          </span>
        ))}
      </div>
      <div className="tbody" ref={parentRef} tabIndex={0}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const row = flatRows[vi.index]
            return (
              <Row
                key={rowId(row)}
                row={row}
                top={vi.start}
                ssdName={ssdNames.get(row.node.ssdId) ?? ''}
                focused={focusKey === rowId(row)}
                isSelected={selected.has(rowId(row))}
              />
            )
          })}
        </div>
        {flatRows.length === 0 && (
          <div className="empty">No folders match the current filters.</div>
        )}
      </div>
    </div>
  )
}

function Row({
  row,
  top,
  ssdName,
  focused,
  isSelected,
}: {
  row: FlatRow
  top: number
  ssdName: string
  focused: boolean
  isSelected: boolean
}) {
  const decisions = useStore((s) => s.decisions)
  const s = useStore.getState()
  const { node, level } = row
  const indent = { paddingLeft: level * 20 }

  if (row.type === 'more') {
    return (
      <div
        className="row child more"
        style={{ transform: `translateY(${top}px)` }}
        onClick={() => s.loadAllFiles(node)}
      >
        <span />
        <span className="name" style={indent}>
          … load all {row.remaining} remaining files
        </span>
      </div>
    )
  }

  if (row.type === 'file') {
    const media = [
      node.width && node.height ? `${node.width}×${node.height}` : null,
      node.duration,
      node.videoBitrate,
    ]
      .filter(Boolean)
      .join(' · ')
    return (
      <div
        className={`row child file ${focused ? 'focused' : ''}`}
        style={{ transform: `translateY(${top}px)` }}
        onClick={() => s.setFocusKey(rowId(row))}
      >
        <span />
        <span className="name" style={indent} title={node.path}>
          {node.name}
        </span>
        <span className="meta">{media || (node.kind ?? '')}</span>
        <span className="num size">{humanBytes(node.sizeBytes)}</span>
        <span className="num">{relAge(node.modified)}</span>
        <span />
        <span className="meta">{media ? (node.kind ?? '') : ''}</span>
        <span />
      </div>
    )
  }

  const state = effectiveState(decisions, node.ssdId, node.path)
  const note = decisions[nodeKey(node)]?.note
  const partial = state === 'delete' && hasDescendantDecisions(decisions, node.ssdId, node.path)
  const kind = kindLabel(node)

  return (
    <div
      className={`row ${level > 0 ? 'child' : ''} ${focused ? 'focused' : ''} ${
        isSelected ? 'selected' : ''
      } ${state === 'delete' ? 'deleted' : ''}`}
      style={{ transform: `translateY(${top}px)` }}
      onClick={(e) => {
        if (e.shiftKey || e.metaKey || e.ctrlKey) s.toggleSelect(rowId(row))
        else {
          s.setFocusKey(rowId(row))
          s.toggleExpanded(node)
        }
      }}
    >
      <span className={`glyph ${state}`}>{GLYPH[state]}</span>
      <span className="name" style={indent} title={node.path}>
        {node.name}
        {partial && <span className="partial">±</span>}
      </span>
      <span className="meta">{ssdName}</span>
      <span className="num size">{humanBytes(node.sizeBytes)}</span>
      <span className="num">{relAge(node.modified)}</span>
      <span className="num">{node.fileCount.toLocaleString()}</span>
      <span className="meta">{kind.label}</span>
      <span className="meta">{note ? '▪' : ''}</span>
    </div>
  )
}
