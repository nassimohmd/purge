import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import type { NodeRec } from '../lib/types'
import { nodeKey } from '../state/store'

export default function NoteEditor() {
  const noteFor = useStore((s) => s.noteFor)
  const closeNoteEditor = useStore((s) => s.closeNoteEditor)
  const setNote = useStore((s) => s.setNote)
  const ssds = useStore((s) => s.ssds)
  const foldersBySsd = useStore((s) => s.foldersBySsd)
  const [value, setValue] = useState(noteFor?.initial ?? '')
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  if (!noteFor) return null

  const keys = new Set(noteFor.keys)
  const nodes: NodeRec[] = []
  for (const ssd of ssds) {
    for (const f of foldersBySsd[ssd.id] ?? []) {
      if (keys.has(nodeKey(f))) nodes.push(f)
    }
  }

  const save = () => setNote(nodes, value.trim())

  return (
    <div className="overlay" onClick={closeNoteEditor}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <h2>
          Note — {nodes.length === 1 ? nodes[0].name : `${nodes.length} folders`}
        </h2>
        <textarea
          ref={ref}
          rows={4}
          style={{ width: '100%' }}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
            e.stopPropagation()
          }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <button className="ghost" onClick={closeNoteEditor}>
            cancel
          </button>
          <button className="primary" onClick={save}>
            save note
          </button>
        </div>
      </div>
    </div>
  )
}
