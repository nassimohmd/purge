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
import * as shareLib from '../lib/share'

export type Screen = 'import' | 'fleet' | 'board' | 'manifest'

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
  /** Focused card index on the fleet screen. */
  fleetFocusIdx: number
  /** SSD shown in the full-screen sunburst drill-in; null = closed. */
  drillSsdId: string | null
  /** Board side panel. */
  boardPanel: 'none' | 'sunburst'
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

  /** Non-null while viewing/editing a published shared session (`/s/<id>`). */
  shareId: string | null
  publishing: boolean
  shareError: string | null

  init: () => Promise<void>
  /** Boot into a shared session instead of the local one — see `shareId`. */
  initShared: (id: string) => Promise<void>
  /** Publish (or re-publish) the current local session; returns its share id. */
  publish: () => Promise<string>
  reloadFromDb: () => Promise<void>
  applyImport: (result: ParseResult) => Promise<dbi.RematchReport>
  removeSsd: (ssdId: string) => Promise<void>

  setSsdCapacity: (ssdId: string, bytes: number | null) => Promise<void>
  mark: (nodes: NodeRec[], state: DecisionState | null) => void
  setNote: (nodes: NodeRec[], note: string) => void
  undo: () => void

  setScreen: (s: Screen) => void
  setFleetFocusIdx: (i: number) => void
  setDrillSsd: (ssdId: string | null) => void
  toggleBoardPanel: () => void
  /** Jump to the board filtered to one SSD, optionally focused on a folder. */
  openBoardForSsd: (ssdId: string, focusPath?: string) => void
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

/** Push a decision write/removal through to shared storage when in shared mode. */
const syncPut = (shareId: string | null, d: Decision) => {
  if (shareId) shareLib.pushDecision(shareId, d)
}
const syncRemove = (shareId: string | null, ssdId: string, path: string) => {
  if (shareId) shareLib.pushDecisionRemoval(shareId, ssdId, path)
}

export const useStore = create<PurgeState>((set, get) => ({
  loaded: false,
  screen: 'import',
  focusMode: false,
  helpOpen: false,
  fleetFocusIdx: 0,
  drillSsdId: null,
  boardPanel: 'none',
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
  shareId: null,
  publishing: false,
  shareError: null,

  init: async () => {
    const state = await dbi.loadAll()
    set({
      ...state,
      loaded: true,
      screen: state.ssds.length > 0 ? 'fleet' : 'import',
    })
  },

  initShared: async (id) => {
    set({ shareId: id })
    try {
      const { snapshot, decisions } = await shareLib.fetchShare(id)
      const state = await dbi.importSnapshot(snapshot, decisions)
      set({
        ...state,
        loaded: true,
        screen: state.ssds.length > 0 ? 'fleet' : 'import',
      })
    } catch (err) {
      set({ loaded: true, screen: 'import', shareError: (err as Error).message })
    }
  },

  publish: async () => {
    const id = get().shareId ?? shareLib.randomShareId()
    set({ publishing: true, shareError: null })
    try {
      await shareLib.publishShare(id)
      window.history.pushState(null, '', `/s/${id}`)
      set({ shareId: id, publishing: false })
      return id
    } catch (err) {
      set({ publishing: false, shareError: (err as Error).message })
      throw err
    }
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

  setSsdCapacity: async (ssdId, bytes) => {
    await dbi.setSsdCapacity(ssdId, bytes)
    set((s) => ({
      ssds: s.ssds.map((x) => (x.id === ssdId ? { ...x, userCapacityBytes: bytes } : x)),
    }))
  },

  mark: (nodes, state) => {
    if (nodes.length === 0) return
    const { decisions, undoStack, sessionMarkedBytes, shareId } = get()
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
          syncPut(shareId, d)
        } else {
          delete next[key]
          void dbi.removeDecision(key)
          syncRemove(shareId, n.ssdId, n.path)
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
        syncPut(shareId, d)
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
    const { decisions, shareId } = get()
    const next = { ...decisions }
    const now = Date.now()
    for (const n of nodes) {
      const key = nodeKey(n)
      const prev = decisions[key]
      if (!note && !prev) continue
      if (!note && prev && prev.state === 'undecided') {
        delete next[key]
        void dbi.removeDecision(key)
        syncRemove(shareId, n.ssdId, n.path)
        continue
      }
      const d: Decision = prev
        ? { ...prev, note }
        : { key, ssdId: n.ssdId, path: n.path, state: 'undecided', note, decidedAt: now }
      next[key] = d
      void dbi.putDecision(d)
      syncPut(shareId, d)
    }
    set({ decisions: next, noteFor: null })
  },

  undo: () => {
    const { undoStack, decisions, shareId } = get()
    const entry = undoStack[undoStack.length - 1]
    if (!entry) return
    const next = { ...decisions }
    for (const step of entry.steps) {
      if (step.prev) {
        next[step.key] = step.prev
        void dbi.putDecision(step.prev)
        syncPut(shareId, step.prev)
      } else {
        const removed = next[step.key]
        delete next[step.key]
        void dbi.removeDecision(step.key)
        if (removed) syncRemove(shareId, removed.ssdId, removed.path)
      }
    }
    set({
      decisions: next,
      undoStack: undoStack.slice(0, -1),
      toast: { msg: `undid: ${entry.label}`, undoable: false, at: Date.now() },
    })
  },

  setScreen: (s) => set({ screen: s }),
  setFleetFocusIdx: (i) => set({ fleetFocusIdx: i }),
  setDrillSsd: (ssdId) => set({ drillSsdId: ssdId }),
  toggleBoardPanel: () =>
    set((s) => ({ boardPanel: s.boardPanel === 'sunburst' ? 'none' : 'sunburst' })),

  openBoardForSsd: (ssdId, focusPath) => {
    // Focus the target folder's row, expanding ancestors below depth 1 so a
    // deep sunburst segment lands on a visible row. Unknown paths (synthetic
    // "other" aggregates) fall back to their depth-1 ancestor.
    let focusKey: string | null = null
    if (focusPath) {
      const segs = focusPath.split(':')
      if (segs.length >= 2) {
        const { foldersBySsd, expanded, toggleExpanded } = get()
        const byPath = new Map((foldersBySsd[ssdId] ?? []).map((f) => [f.path, f]))
        const target = byPath.has(focusPath) ? focusPath : segs.slice(0, 2).join(':')
        focusKey = dkey(ssdId, target)
        for (let d = 2; d < target.split(':').length; d++) {
          const anc = byPath.get(segs.slice(0, d).join(':'))
          if (anc && !expanded[dkey(ssdId, anc.path)]) toggleExpanded(anc)
        }
      }
    }
    set((s) => ({
      screen: 'board',
      drillSsdId: null,
      filters: { ...s.filters, ssdIds: [ssdId] },
      ...(focusKey !== null ? { focusKey } : {}),
    }))
  },

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
