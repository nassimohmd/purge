# Purge — SSD deletion triage

A local-first web app for triaging deletion decisions across a fleet of ~30 offline SSDs,
using NeoFinder catalog exports as input. Purge is a decision-making tool, not a file
manager: **it never touches real files.** Its output is a reviewed deletion manifest per
SSD (CSV, plus an optional guarded shell script) that you execute manually when each
drive is mounted.

Importing is always local-first — your NeoFinder exports never leave the browser unless
you explicitly publish. Publishing is optional: it uploads the catalog (not the actual
files) to a hosted link so it can be viewed and triaged without anyone else re-importing.

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

### Sharing a hosted link

"Share a hosted link" on the import screen uploads the current catalog (SSDs + folder/file
metadata, never actual files) to Vercel Blob storage and gives you a `/s/<id>` link.
Anyone who opens it sees the fleet, triage board, and sunbursts immediately — no import
step — and can mark `delete`/`keep`/`review` themselves; those marks sync back live.
Re-publish after new imports to push updated catalog data to the same link.

There's no login and no password: the link itself is the only access control, so treat it
like the data it represents. Re-publishing and marking are both possible for anyone who has
the link, not just the person who first published it.

## Development

```bash
pnpm install
pnpm dev        # Vite dev server
pnpm test       # parser / resolution / manifest / persistence / share tests (vitest)
pnpm typecheck  # app + api function typecheck
pnpm build      # typecheck + production build
```

Stack: Vite + React + TypeScript, Dexie (IndexedDB), zustand, `@tanstack/react-virtual`.
No component library. Everything is local-first — import/triage/manifest never touch a
server. Sharing is the one opt-in exception: `api/` holds a handful of Vercel Functions
(`@vercel/blob`) that store/serve published snapshots and decisions; see `vercel.json` for
the SPA routing rewrite that publishing needs.

This app lives in `purge/` as an independent pnpm workspace (own lockfile); it does not
share dependencies with the SSD Vault app at the repo root.
