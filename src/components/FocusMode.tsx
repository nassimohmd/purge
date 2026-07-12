import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, nodeKey } from '../state/store'
import type { NodeRec } from '../lib/types'
import { buildTriageList, kindLabel } from '../lib/board'
import { effectiveState } from '../lib/resolve'
import { getDescendantFiles } from '../lib/db'
import { humanBytes, relAge } from '../lib/format'

/**
 * Focus Mode: one folder at a time, single-keypress decisions, auto-advance
 * through the undecided queue (respecting current board filters/sort).
 */
export default function FocusMode() {
  const ssds = useStore((s) => s.ssds)
  const foldersBySsd = useStore((s) => s.foldersBySsd)
  const decisions = useStore((s) => s.decisions)
  const filters = useStore((s) => s.filters)
  const sort = useStore((s) => s.sort)
  const sessionMarkedBytes = useStore((s) => s.sessionMarkedBytes)
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set())

  const queue = useMemo(() => {
    const list = buildTriageList(ssds, foldersBySsd, decisions, filters, sort)
    return list.filter((n) => effectiveState(decisions, n.ssdId, n.path) === 'undecided')
  }, [ssds, foldersBySsd, decisions, filters, sort])

  const ordered = useMemo(() => {
    const notSkipped = queue.filter((n) => !skipped.has(nodeKey(n)))
    const skippedTail = queue.filter((n) => skipped.has(nodeKey(n)))
    return [...notSkipped, ...skippedTail]
  }, [queue, skipped])

  const node: NodeRec | undefined = ordered[0]
  const initialTotal = useRef<number | null>(null)
  if (initialTotal.current === null) initialTotal.current = queue.length
  const total = Math.max(initialTotal.current, queue.length)
  const position = Math.min(total - ordered.length + 1, total)

  const ssdName = node
    ? (ssds.find((s) => s.id === node.ssdId)?.name ?? node.ssdId)
    : ''

  const [files, setFiles] = useState<NodeRec[] | null>(null)
  useEffect(() => {
    setFiles(null)
    if (!node) return
    let live = true
    void getDescendantFiles(node.ssdId, node.path, 10).then(({ files }) => {
      if (live) setFiles(files)
    })
    return () => {
      live = false
    }
  }, [node?.ssdId, node?.path]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      const s = useStore.getState()
      if (s.helpOpen || s.noteFor) return
      if (!node) {
        if (e.key === 'Enter') s.setFocusMode(false)
        return
      }
      switch (e.key) {
        case 'd':
          s.mark([node], 'delete')
          break
        case 'f':
          s.mark([node], 'keep')
          break
        case 'r':
          s.mark([node], 'review')
          break
        case 'j':
        case 'ArrowDown':
          e.preventDefault()
          setSkipped((prev) => new Set(prev).add(nodeKey(node)))
          break
        case 'n':
          e.preventDefault()
          s.openNoteEditor([node])
          break
        case 'z':
          s.undo()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [node])

  const kind = node ? kindLabel(node) : null

  return (
    <div className="focus">
      {node ? (
        <div className="focus-card">
          <div className="ssd-label">{ssdName}</div>
          <h1>{node.name}</h1>
          <div className="size">{humanBytes(node.sizeBytes)}</div>
          <div className="facts">
            <span>modified {relAge(node.modified)} ago</span>
            <span>
              {node.fileCount.toLocaleString()} {node.fileCount === 1 ? 'file' : 'files'}
            </span>
            <span>{kind?.label}</span>
          </div>
          <div className="path">{node.path}</div>
          <div className="files">
            {files === null && <div className="frow">loading largest files…</div>}
            {files?.map((f) => (
              <div className="frow" key={f.path}>
                <span className="fname">{f.name}</span>
                <span className="fmeta">
                  {[
                    f.width && f.height ? `${f.width}×${f.height}` : null,
                    f.duration,
                    f.videoBitrate,
                    humanBytes(f.sizeBytes),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
            ))}
            {files !== null && files.length === 0 && <div className="frow">no files</div>}
          </div>
        </div>
      ) : (
        <div className="focus-card">
          <div className="focus-done">
            <h1>Queue clear.</h1>
            <p>No undecided folders match the current filters.</p>
          </div>
        </div>
      )}
      <div className="focus-bottom">
        <span>
          {ordered.length > 0 ? `${position} of ${total} undecided` : '0 undecided'} ·{' '}
          {humanBytes(sessionMarkedBytes)} marked this session
        </span>
        <span className="keys">
          <button
            className="ghost"
            disabled={!node}
            onClick={() => node && useStore.getState().mark([node], 'delete')}
          >
            <b>d</b> delete
          </button>
          <button
            className="ghost"
            disabled={!node}
            onClick={() => node && useStore.getState().mark([node], 'keep')}
          >
            <b>f</b> keep
          </button>
          <button
            className="ghost"
            disabled={!node}
            onClick={() => node && useStore.getState().mark([node], 'review')}
          >
            <b>r</b> review
          </button>
          <span>
            <b>j</b> skip
          </span>
          <span>
            <b>n</b> note
          </span>
          <span>
            <b>z</b> undo
          </span>
          <span>
            <b>esc</b> exit
          </span>
        </span>
      </div>
    </div>
  )
}
