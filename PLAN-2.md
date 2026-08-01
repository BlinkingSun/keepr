# KeepR — Batch 2: field-test feedback (task `keepr2`)

First real user testing session produced three feature requests and three defect
reports. Master channel `master-keepr` is REUSED (same codebase, warm audit
context); executor channels are `exec-keepr2-*`.

## The user's report, verbatim intent → workstream

| # | Report | Workstream |
|---|---|---|
| 1 | Import folders of files, not just files | **W** ingest recursion + Import menu |
| 2 | "New Receipts" and "Old Receipts" directories; move new→old when ingested, so the filesystem shows what has/hasn't been scanned in | **W** watched-folder service |
| 3 | Scan directly into the program; scanned images land in Old Receipts | **S** eSCL/AirScan client + scan UI |
| 4 | View buttons don't work | **T** Thumbnail view (does not exist) + Details empty-state (only renders with a selection) |
| 5 | Sorting works but not categories | **R** category ORDER BY puts SQL NULLs first, so 7 blank rows lead and the sort looks dead; Payment/Tax columns not mapped at all |
| 6 | Missing-info filter must show only missing-info receipts | **R/V** verify every smart filter end-to-end; make filters distinguishable by making *review* reachable (Mark Reviewed), since a fresh library legitimately shows the same 12 items in View All / Recent / Unreviewed / Inbox |

## Design decisions (locked)

**Folder layout** — created inside the library root on open:
```
<library>/
  New Receipts/     user-facing drop zone; also written by a failed scan
  Old Receipts/     originals archived after successful ingest; scans are born here
  images/           content-addressed store (unchanged, app-managed)
```

**Move semantics.** ONLY files inside `New Receipts/` are ever moved. Manual
imports (button, drag-drop) never relocate the user's originals — moving a file
out of ~/Downloads because the user imported it would be surprising and
destructive. A scan writes into `Old Receipts/` on success and into
`New Receipts/` on ingest failure, so an unprocessed scan stays visible as
unprocessed.

**Move safety.** Never delete: rename only; on EXDEV, copy → verify size+sha →
unlink. Collision-safe `name (2).ext`. Ingest commits BEFORE the move; a crash
between ingest and move self-heals on the next pass via content-hash dedupe
(`skipDuplicates`), which also makes re-drops of already-ingested files a no-op
that still archives the file to Old.

**Scanner scope.** eSCL (AirScan) over HTTP — the driverless protocol used by
essentially every network-capable scanner/MFP made in the last decade. Pure JS:
`multicast-dns` for discovery, `fast-xml-parser` for capabilities/status. No
native modules, no drivers, testable against an in-process mock server.
**USB-only scanners are out of scope for this batch** (they need
ImageCaptureCore/TWAIN native work) and the UI must say so honestly when nothing
is discovered. Job progress reuses job kind `'import'` with
`detail.source='scan'` — no schema migration.

**Sorting.** buildOrder whitelists EVERY grid column (category, payment, tax,
reviewed included), NULLs last in both directions, stable `item_id` tiebreak.
Unknown keys ignored, never interpolated — the whitelist is also the injection
guard.

**Reviewed workflow** (makes filters mean something): Mark Reviewed button in the
inspector, bulk "Mark n reviewed" in the status bar when a selection exists, and
Cmd/Ctrl+Enter in the grid. Unreviewed count then visibly shrinks as you work.

## Lanes

| Lane | Scope | Owns | Executor |
|---|---|---|---|
| 0 | Contract (IPC channels, GridRow.thumbRelPath, ImportResult.duplicates), deps (`multicast-dns`, `fast-xml-parser`), folder creation in context, fixture ripple | `src/shared/**`, `src/main/**` wiring, `package.json` | orchestrator |
| W | Ingest: directory recursion, `skipDuplicates` by content hash, `watchNewReceipts` service (pure Node, injectable timers), move-to-Old | `src/ingest/**` | grok |
| S | eSCL: discovery, capabilities, scan job lifecycle, save-to-Old + ingest orchestration, ScanPanel (pure props), mock-server tests | `src/scan/**`, `src/ui/scan/**` | grok |
| R | Repo: complete sort map + NULLs-last, `GridRow.thumbRelPath` (first page, correlated subselect — query count must stay ≤6), verify filter totals under needsReview/unreviewed | `src/db/repo/**` | grok |
| T | Thumbnail view: responsive card grid, row-windowed via computeWindow, 2D keyboard nav, flag/split/unreviewed badges | `src/ui/thumbs/**` | grok |
| V | Integrate: Import dropdown (Files/Folder/Open-folders), Scan modal wiring, view switcher, Details empty state, Mark Reviewed everywhere, watcher startup | `src/ui/app/**`, `src/main/**` | orchestrator |

Waves: 0 → W ∥ S ∥ R ∥ T → V (integrate) → audit+test → verify loop (≤3).

## Acceptance (API-checkable + UI-verified)

1. `POST /import {paths:[dir]}` walks recursively, skips unsupported/hidden files silently with a count, imports the rest.
2. Drop 3 files into `New Receipts/` → within 10s: 3 items in Inbox, files moved to `Old Receipts/`, originals byte-identical (hash), `New Receipts/` empty.
3. Re-drop an already-ingested file → no new item, file still archives to Old.
4. Kill between ingest and move (simulated) → next pass archives without duplicating.
5. Scan (mock server in CI; real device if available): 2-page ADF job → 2 pages saved `Old Receipts/Scan <timestamp> p<N>.jpg`, one 2-page item in Inbox, progress events fired.
6. Grid sorts by Category/Payment/Tax both directions, NULLs last, stable.
7. Thumbnail button shows a card grid; Details without selection shows an instructive empty state; all three view buttons visibly change the center pane.
8. Needs Review lists exactly the flagged items; Unreviewed shrinks as items are marked reviewed; each smart filter returns a distinct, correct set (verified via `GET /items?filter=` and by screenshot).
9. 254+ existing tests still green; tsc clean.
