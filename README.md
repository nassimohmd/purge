# Purge — SSD deletion triage

A local-first web app for triaging deletion decisions across a fleet of ~30 offline SSDs,
using NeoFinder catalog exports as input. Purge is a decision-making tool, not a file
manager: **it never touches real files.** Its output is a reviewed deletion manifest per
SSD (CSV, plus an optional guarded shell script) that you execute manually when each
drive is mounted.

## How it works

1. **Import** — drop 1–30 NeoFinder tabbed-text exports (`File → Export as Text`).
   Parsing runs in a Web Worker: BOM sniffing (UTF-8/UTF-16), classic-Mac CR line
   endings, header-name column mapping, disk-serial identity, cumulative folder sizes
   with a >2% sanity check, tolerant date parsing. Each import shows a report
   (rows/folders/files/size/date range/warnings) so you can trust the parse.
2. **Fleet overview** (landing screen) — every SSD as a card: capacity bar showing
   used / marked-for-delete (red) / free space, triage progress, oldest data.
   Capacity and free space are parsed from the export's disk metadata when present;
   otherwise type it once (e.g. "2 TB") on the import screen or card. `j/k/h/l`
   moves, `Enter` triages that drive, `o` opens its sunburst.
3. **Triage board** — one flat virtualized table of project folders across all SSDs,
   sorted size-desc by default. Filter by SSD, age, min size, kind, decision state,
   fuzzy name search. Mark folders `delete`/`keep`/`review` by keyboard (press `?` for
   the map), expand rows for subfolders and largest files as evidence. Inline
   log-scale size bars and age-heat shading make big, stale folders pop. `v` opens a
   live sunburst side panel that tints red as you mark; clicking a segment jumps the
   board to that folder. Every decision auto-saves to IndexedDB instantly.
4. **Sunburst drill-in** (`o`) — full-screen zoomable sunburst of one drive's folder
   tree, colored by content kind (video/image/project/other), brighter with age, red
   where marked delete. Click zooms in, `Enter` opens the board at the zoom root,
   `[` `]` walk the fleet.
5. **Focus mode** (`space`) — one folder at a time, single keypress decides and
   advances through the undecided queue.
6. **Manifest** — decisions resolve nearest-ancestor-wins: a `keep` child inside a
   `delete` parent means the parent is never emitted wholesale; the maximal deletable
   subtrees (and the parent's loose files) are exported instead. Per-SSD CSV, an
   optional `DRY_RUN=1`-default shell script behind an "I understand" toggle, and a
   copyable reclaim summary.

Session backup: export/import the entire state (all SSDs + decisions) as one JSON file
from the import screen.

## Development

```bash
pnpm install
pnpm dev        # Vite dev server
pnpm test       # parser / resolution / manifest / persistence tests (vitest)
pnpm build      # typecheck + production build
```

Stack: Vite + React + TypeScript, Dexie (IndexedDB), zustand, `@tanstack/react-virtual`.
No backend, no component library — everything is local to the browser.

This app lives in `purge/` as an independent pnpm workspace (own lockfile); it does not
share dependencies with the SSD Vault app at the repo root.
