import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import type { ImportReport, ParseResult, SsdMeta } from '../lib/types'
import { effectiveCapacity } from '../lib/types'
import type { WorkerRequest, WorkerResponse } from '../lib/parser/worker'
import { db, exportSession, importSession } from '../lib/db'
import { fmtDate, humanBytes, parseHumanSize, todayStamp } from '../lib/format'
import { shareUrl } from '../lib/share'

interface QueueItem {
  id: number
  fileName: string
  status: 'queued' | 'parsing' | 'awaiting-confirm' | 'saving' | 'done' | 'error' | 'cancelled'
  progress: number
  report?: ImportReport
  rematched?: number
  orphaned?: number
  error?: string
}

let nextId = 1

export default function ImportScreen() {
  const ssds = useStore((s) => s.ssds)
  const applyImport = useStore((s) => s.applyImport)
  const removeSsd = useStore((s) => s.removeSsd)
  const reloadFromDb = useStore((s) => s.reloadFromDb)
  const setScreen = useStore((s) => s.setScreen)

  const [queue, setQueue] = useState<QueueItem[]>([])
  const [over, setOver] = useState(false)
  const [confirm, setConfirm] = useState<{
    item: QueueItem
    result: ParseResult
    decisionCount: number
  } | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const getWorker = () => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('../lib/parser/worker.ts', import.meta.url), {
        type: 'module',
      })
    }
    return workerRef.current
  }
  useEffect(() => () => workerRef.current?.terminate(), [])

  const patchItem = (id: number, patch: Partial<QueueItem>) =>
    setQueue((q) => q.map((it) => (it.id === id ? { ...it, ...patch } : it)))

  const finishImport = useCallback(
    async (id: number, result: ParseResult) => {
      patchItem(id, { status: 'saving', report: result.report })
      try {
        const rematch = await applyImport(result)
        patchItem(id, { status: 'done', ...rematch })
      } catch (err) {
        patchItem(id, { status: 'error', error: String(err) })
      }
    },
    [applyImport],
  )

  const parseFile = useCallback(
    async (file: File) => {
      const id = nextId++
      setQueue((q) => [...q, { id, fileName: file.name, status: 'queued', progress: 0 }])
      const buffer = await file.arrayBuffer()
      patchItem(id, { status: 'parsing' })
      const worker = getWorker()
      const onMsg = async (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data
        if (msg.id !== id) return
        if (msg.type === 'progress') {
          patchItem(id, { progress: msg.total > 0 ? msg.done / msg.total : 0 })
          return
        }
        worker.removeEventListener('message', onMsg)
        if (msg.type === 'error') {
          patchItem(id, { status: 'error', error: msg.message })
          return
        }
        const result = msg.result
        // Known serial (or name) → confirm re-import, decisions re-match by path.
        const known = useStore.getState().ssds.find((s) => s.id === result.ssd.id)
        if (known) {
          const decisionCount = await db.decisions.where('ssdId').equals(result.ssd.id).count()
          patchItem(id, { status: 'awaiting-confirm', report: result.report })
          setConfirm({
            item: { id, fileName: file.name, status: 'awaiting-confirm', progress: 1 },
            result,
            decisionCount,
          })
        } else {
          await finishImport(id, result)
        }
      }
      worker.addEventListener('message', onMsg)
      worker.postMessage({ id, buffer, fileName: file.name } satisfies WorkerRequest, [buffer])
    },
    [finishImport],
  )

  const onFiles = useCallback(
    (files: FileList | File[]) => {
      for (const f of Array.from(files)) {
        if (/\.(txt|text)$/i.test(f.name)) void parseFile(f)
      }
    },
    [parseFile],
  )

  const onSessionFile = async (file: File) => {
    try {
      const state = await importSession(await file.text())
      await reloadFromDb()
      if (state.ssds.length > 0) setScreen('board')
    } catch (err) {
      alert(`Session import failed: ${String(err)}`)
    }
  }

  return (
    <div
      className="import"
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        onFiles(e.dataTransfer.files)
      }}
    >
      <div className={`dropzone ${over ? 'over' : ''}`} onClick={() => fileInput.current?.click()}>
        <div className="big">Drop NeoFinder exports here — 1 to 30 .txt files at once</div>
        <div className="hint">File → Export as Text in NeoFinder. Or click to browse.</div>
        <input
          ref={fileInput}
          type="file"
          accept=".txt,.text,text/plain"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) onFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {queue.length > 0 && (
        <section>
          <h3>Import report</h3>
          <table>
            <thead>
              <tr>
                <th>file</th>
                <th>SSD</th>
                <th>serial</th>
                <th>rows</th>
                <th>folders</th>
                <th>files</th>
                <th>total size</th>
                <th>capacity</th>
                <th>date range</th>
                <th>status</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((it) => (
                <ReportRow key={it.id} item={it} />
              ))}
            </tbody>
          </table>
        </section>
      )}

      {ssds.length > 0 && (
        <section>
          <h3>Imported SSDs</h3>
          <table>
            <thead>
              <tr>
                <th>SSD</th>
                <th>serial</th>
                <th>folders</th>
                <th>files</th>
                <th>total</th>
                <th>capacity</th>
                <th>imported</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ssds.map((ssd) => (
                <tr key={ssd.id}>
                  <td className="strong">{ssd.name}</td>
                  <td>{ssd.diskSerial ?? '—'}</td>
                  <td>{ssd.folderCount.toLocaleString()}</td>
                  <td>{ssd.fileCount.toLocaleString()}</td>
                  <td>{humanBytes(ssd.totalBytes)}</td>
                  <td>
                    <CapacityCell ssd={ssd} />
                  </td>
                  <td>{fmtDate(ssd.importedAt)}</td>
                  <td>
                    <button
                      className="danger"
                      onClick={() => {
                        if (window.confirm(`Remove ${ssd.name} and all its decisions from Purge?`)) {
                          void removeSsd(ssd.id)
                        }
                      }}
                    >
                      remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h3>Session backup</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => {
              void exportSession().then((blob) =>
                download(blob, `purge-session_${todayStamp()}.json`),
              )
            }}
          >
            export session JSON
          </button>
          <label>
            <button onClick={() => document.getElementById('session-file')?.click()}>
              import session JSON
            </button>
            <input
              id="session-file"
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onSessionFile(f)
                e.target.value = ''
              }}
            />
          </label>
          <span style={{ color: 'var(--tx-2)', fontSize: 12 }}>
            One JSON file with all SSDs + decisions. Importing replaces the current session.
          </span>
        </div>
      </section>

      <PublishSection />

      {confirm && (
        <div className="overlay">
          <div className="panel">
            <h2>Re-import {confirm.result.ssd.name}?</h2>
            <p style={{ color: 'var(--tx-1)', fontSize: 12, marginBottom: 16 }}>
              {confirm.result.ssd.name} is already imported
              {confirm.result.ssd.diskSerial
                ? ` (disk serial ${confirm.result.ssd.diskSerial})`
                : ''}
              . Its catalog will be replaced. {confirm.decisionCount}{' '}
              {confirm.decisionCount === 1 ? 'decision' : 'decisions'} will be re-matched by path;
              decisions whose path no longer exists are dropped and reported.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                className="ghost"
                onClick={() => {
                  patchItem(confirm.item.id, { status: 'cancelled' })
                  setConfirm(null)
                }}
              >
                cancel
              </button>
              <button
                className="primary"
                onClick={() => {
                  void finishImport(confirm.item.id, confirm.result)
                  setConfirm(null)
                }}
              >
                re-import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

/**
 * Click-to-edit drive capacity. Accepts "2 TB" style input; blank clears the
 * manual override (falling back to whatever the export declared, if anything).
 */
export function CapacityCell({ ssd }: { ssd: SsdMeta }) {
  const setSsdCapacity = useStore((s) => s.setSsdCapacity)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const capacity = effectiveCapacity(ssd)

  const commit = () => {
    setEditing(false)
    const t = text.trim()
    if (!t) {
      if (ssd.userCapacityBytes !== null) void setSsdCapacity(ssd.id, null)
      return
    }
    const bytes = parseHumanSize(t)
    if (bytes !== null && bytes !== ssd.userCapacityBytes) void setSsdCapacity(ssd.id, bytes)
  }

  if (editing) {
    return (
      <input
        autoFocus
        className="capacity-input"
        placeholder="e.g. 2 TB"
        defaultValue={capacity !== null ? humanBytes(capacity) : ''}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') setEditing(false)
        }}
      />
    )
  }
  return (
    <button
      className="ghost capacity-value"
      title="Click to set drive capacity (e.g. 2 TB)"
      onClick={() => {
        setText('')
        setEditing(true)
      }}
    >
      {capacity !== null ? humanBytes(capacity) : 'set…'}
      {ssd.userCapacityBytes !== null && <span className="edited"> ·edited</span>}
    </button>
  )
}

/**
 * Publish the current session to a hosted link — anyone who opens it sees
 * the fleet/board/sunburst and can mark decisions without importing
 * anything. No password: the unguessable link is the only gate.
 */
function PublishSection() {
  const ssds = useStore((s) => s.ssds)
  const shareId = useStore((s) => s.shareId)
  const publishing = useStore((s) => s.publishing)
  const shareError = useStore((s) => s.shareError)
  const publish = useStore((s) => s.publish)
  const [copied, setCopied] = useState(false)

  if (ssds.length === 0) return null

  const doPublish = () => {
    void publish()
      .then((id) => navigator.clipboard.writeText(shareUrl(id)))
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
      })
      .catch(() => {})
  }

  return (
    <section>
      <h3>Share a hosted link</h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="primary" disabled={publishing} onClick={doPublish}>
          {publishing ? 'publishing…' : shareId ? 're-publish' : 'publish for sharing'}
        </button>
        {shareId && (
          <>
            <code style={{ fontSize: 12, color: 'var(--tx-1)' }}>{shareUrl(shareId)}</code>
            {copied && <span style={{ color: 'var(--tx-2)', fontSize: 12 }}>copied</span>}
          </>
        )}
      </div>
      {shareError && (
        <div style={{ color: 'var(--del)', fontSize: 12, marginTop: 4 }}>{shareError}</div>
      )}
      <span style={{ color: 'var(--tx-2)', fontSize: 12 }}>
        Uploads the current catalog to a hosted link — anyone who opens it can view and mark
        decisions without importing anything, no login. Re-publish after new imports to update
        it; marks made on the link sync back live. No password: treat the link like the data
        itself.
      </span>
    </section>
  )
}

function ReportRow({ item }: { item: QueueItem }) {
  const r = item.report
  const status =
    item.status === 'parsing'
      ? `parsing ${Math.round(item.progress * 100)}%`
      : item.status === 'done'
        ? item.orphaned || item.rematched
          ? `done · ${item.rematched ?? 0} decisions re-matched, ${item.orphaned ?? 0} orphaned`
          : 'done'
        : item.status === 'error'
          ? `error: ${item.error}`
          : item.status
  return (
    <>
      <tr>
        <td>{item.fileName}</td>
        <td className="strong">{r?.ssdName ?? '…'}</td>
        <td>{r?.diskSerial ?? '—'}</td>
        <td>{r ? r.rowCount.toLocaleString() : ''}</td>
        <td>{r ? r.folderCount.toLocaleString() : ''}</td>
        <td>{r ? r.fileCount.toLocaleString() : ''}</td>
        <td>{r ? humanBytes(r.totalBytes) : ''}</td>
        <td>{r?.capacityBytes != null ? humanBytes(r.capacityBytes) : r ? '—' : ''}</td>
        <td>
          {r?.dateMin != null ? `${fmtDate(r.dateMin)} → ${fmtDate(r.dateMax)}` : ''}
        </td>
        <td style={{ color: item.status === 'error' ? 'var(--del)' : undefined }}>{status}</td>
      </tr>
      {r && (r.warnings.length > 0 || r.duplicateCount > 0) && (
        <tr>
          <td colSpan={10} className="warnings">
            {r.duplicateCount > 0 && (
              <div>
                ⚠ {r.duplicateCount.toLocaleString()} row(s) had a duplicate path (last one wins)
              </div>
            )}
            {r.warnings.map((w, i) => (
              <div key={i}>
                ⚠ [{w.type}] {w.message}
              </div>
            ))}
          </td>
        </tr>
      )}
    </>
  )
}
