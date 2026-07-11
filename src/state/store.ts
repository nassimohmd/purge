import { create } from 'zustand'
import type { Decision, DecisionState, NodeRec, ParseResult, SsdMeta } from '../lib/types'
import { dkey } from '../lib/types'
import {
  DEFAULT_FILTERS,
  DEFAULT_SORT,
  type Filters,
  type Sort,
  type SortCol,
} from '../lib/board'
import * as dbi from '../lib/db'

export type Screen = 'import' | 'board' | 'manifest'

interface UndoStep {
  key: string
  prev: Decision | null
}
interface UndoEntry {
  label: string
  steps: UndoStep[]
}

export interface ToastState {
  msg: string
  undoable: boolean
  at: number
}

interface PurgeState {
  loaded: boolean
  screen: Screen
  focusMode: boolean
  helpOpen: boolean
  /** Node keys a note is being edited for; null = editor closed. */
  noteFor: { keys: string[]; initial: string } | null

  ssds: SsdMeta[]
  foldersBySsd: Record<string, NodeRec[]>
  decisions: Record<string, Decision>

  filters: Filters
  sort: Sort
  focusKey: string | null
  selected: ReadonlySet<string>
  /** Expanded folder keys → loaded largest-descendant files (null = loading). */
  expanded: Record<string, { files: NodeRec[] | null; total: number; all: boolean }>

  undoStack: UndoEntry[]
  toast: ToastState | null
  sessionMarkedBytes: number

  init: () => Promise<void>
  reloadFromDb: () => Promise<void>
  applyImport: (result: ParseResult) => Promise<dbi.RematchReport>
  removeSsd: (ssdId: string) => Promise<void>

  mark: (nodes: NodeRec[], state: DecisionState | null) => void
  setNote: (nodes: NodeRec[], note: string) => void
  undo: () => void

  setScreen: (s: Screen) => void
  setFocusMode: (on: boolean) => void
  setHelpOpen: (on: boolean) => void
  openNoteEditor: (nodes: NodeRec[]) => void
  closeNoteEditor: () => void
  setFilters: (patch: Partial<Filters>) => void
  cycleSsdFilter: () => void
  setSort: (col: SortCol) => void
  setFocusKey: (key: string | null) => void
  toggleSelect: (key: string) => void
  clearSelection: () => void
  toggleExpanded: (node: NodeRec) => void
  loadAllFiles: (node: NodeRec) => void
  clearToast: () => void
}

export const nodeKey = (n: NodeRec): string => dkey(n.ssdId, n.path)

const UNDO_LIMIT = 50

export const useStore = create<PurgeState>((set, get) => ({
  loaded: false,
  screen: 'import',
  focusMode: false,
  helpOpen: false,
  noteFor: null,
  ssds: [],
  foldersBySsd: {},
  decisions: {},
  filters: DEFAULT_FILTERS,
  sort: DEFAULT_SORT,
  focusKey: null,
  selected: new Set<string>(),
  expanded: {},
  undoStack: [],
  toast: null,
  sessionMarkedBytes: 0,

  init: async () => {
    const state = await dbi.loadAll()
    set({
      ...state,
      loaded: true,
      screen: state.ssds.length > 0 ? 'board' : 'import',
    })
  },

  reloadFromDb: async () => {
    const state = await dbi.loadAll()
    set({ ...state, selected: new Set(), expanded: {}, undoStack: [], focusKey: null })
  },

  applyImport: async (result) => {
    const rematch = await dbi.saveImport(result)
    const fresh = await dbi.loadAll()
    set({ ssds: fresh.ssds, foldersBySsd: fresh.foldersBySsd, decisions: fresh.decisions })
    return rematch
  },

  removeSsd: async (ssdId) => {
    await dbi.deleteSsd(ssdId)
    const fresh = await dbi.loadAll()
    set({ ssds: fresh.ssds, foldersBySsd: fresh.foldersBySsd, decisions: fresh.decisions })
  },

  mark: (nodes, state) => {
    if (nodes.length === 0) return
    const { decisions, undoStack, sessionMarkedBytes } = get()
    const next = { ...decisions }
    const steps: UndoStep[] = []
    let markedDelta = 0
    const now = Date.now()
    for (const n of nodes) {
      const key = nodeKey(n)
      const prev = decisions[key] ?? null
      steps.push({ key, prev })
      if (state === 'delete' && prev?.state !== 'delete') markedDelta += n.sizeBytes
      if (state === null || state === 'undecided') {
        if (prev?.note) {
          const d: Decision = { ...prev, state: 'undecided', decidedAt: now }
          next[key] = d
          void dbi.putDecision(d)
        } else {
          delete next[key]
          void dbi.removeDecision(key)
        }
      } else {
        const d: Decision = {
          key,
          ssdId: n.ssdId,
          path: n.path,
          state,
          note: prev?.note ?? '',
          decidedAt: now,
        }
        next[key] = d
        void dbi.putDecision(d)
      }
    }
    const verb = state === null || state === 'undecided' ? 'cleared' : `marked ${state}`
    set({
      decisions: next,
      undoStack: [...undoStack, { label: verb, steps }].slice(-UNDO_LIMIT),
      toast: {
        msg: `${nodes.length === 1 ? nodes[0].name : `${nodes.length} folders`} ${verb}`,
        undoable: true,
        at: Date.now(),
      },
      sessionMarkedBytes: sessionMarkedBytes + markedDelta,
    })
  },

  setNote: (nodes, note) => {
    if (nodes.length === 0) return
    const { decisions } = get()
    const next = { ...decisions }
    const now = Date.now()
    for (const n of nodes) {
      const key = nodeKey(n)
      const prev = decisions[key]
      if (!note && !prev) continue
      if (!note && prev && prev.state === 'undecided') {
        delete next[key]
        void dbi.removeDecision(key)
        continue
      }
      const d: Decision = prev
        ? { ...prev, note }
        : { key, ssdId: n.ssdId, path: n.path, state: 'undecided', note, decidedAt: now }
      next[key] = d
      void dbi.putDecision(d)
    }
    set({ decisions: next, noteFor: null })
  },

  undo: () => {
    const { undoStack, decisions } = get()
    const entry = undoStack[undoStack.length - 1]
    if (!entry) return
    const next = { ...decisions }
    for (const step of entry.steps) {
      if (step.prev) {
        next[step.key] = step.prev
        void dbi.putDecision(step.prev)
      } else {
        delete next[step.key]
        void dbi.removeDecision(step.key)
      }
    }
    set({
      decisions: next,
      undoStack: undoStack.slice(0, -1),
      toast: { msg: `undid: ${entry.label}`, undoable: false, at: Date.now() },
    })
  },

  setScreen: (s) => set({ screen: s }),
  setFocusMode: (on) => set({ focusMode: on }),
  setHelpOpen: (on) => set({ helpOpen: on }),
  openNoteEditor: (nodes) => {
    if (nodes.length === 0) return
    const { decisions } = get()
    const initial = decisions[nodeKey(nodes[0])]?.note ?? ''
    set({ noteFor: { keys: nodes.map(nodeKey), initial } })
  },
  closeNoteEditor: () => set({ noteFor: null }),

  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),

  cycleSsdFilter: () => {
    const { ssds, filters } = get()
    if (ssds.length === 0) return
    const current = filters.ssdIds.length === 1 ? filters.ssdIds[0] : null
    const idx = current === null ? -1 : ssds.findIndex((s) => s.id === current)
    const nextIdx = idx + 1
    set((s) => ({
      filters: {
        ...s.filters,
        ssdIds: nextIdx >= ssds.length ? [] : [ssds[nextIdx].id],
      },
    }))
  },

  setSort: (col) =>
    set((s) => ({
      sort:
        s.sort.col === col
          ? { col, dir: s.sort.dir === 1 ? -1 : 1 }
          : { col, dir: col === 'name' || col === 'ssd' ? 1 : -1 },
    })),

  setFocusKey: (key) => set({ focusKey: key }),

  toggleSelect: (key) =>
    set((s) => {
      const next = new Set(s.selected)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return { selected: next }
    }),

  clearSelection: () => set({ selected: new Set() }),

  toggleExpanded: (node) => {
    const key = nodeKey(node)
    const { expanded } = get()
    if (expanded[key]) {
      const next = { ...expanded }
      delete next[key]
      set({ expanded: next })
      return
    }
    set({ expanded: { ...expanded, [key]: { files: null, total: 0, all: false } } })
    void dbi.getDescendantFiles(node.ssdId, node.path, 50).then(({ files, total }) => {
      const cur = get().expanded
      if (!cur[key]) return // collapsed while loading
      set({ expanded: { ...cur, [key]: { files, total, all: total <= files.length } } })
    })
  },

  loadAllFiles: (node) => {
    const key = nodeKey(node)
    void dbi.getDescendantFiles(node.ssdId, node.path, 0).then(({ files, total }) => {
      const cur = get().expanded
      if (!cur[key]) return
      set({ expanded: { ...cur, [key]: { files, total, all: true } } })
    })
  },

  clearToast: () => set({ toast: null }),
}))
