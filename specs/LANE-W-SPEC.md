# Lane W — Folder ingestion + New/Old receipts workflow

**Executor:** grok · **Depends on:** Lane 0 contract (already on disk)

## You own
```
src/ingest/**   (dirwalk.ts, watchFolders.ts NEW; import.ts changes; tests)
```
Do NOT touch src/main/**, src/shared/**, src/scan/**, src/ui/**, src/db/**,
package.json. Lanes S, R, T are working in this repo concurrently.

## Why this exists (the user's words)
"Create a directory folder for new receipts and one for old receipts so that we
can tell what has and hasn't been scanned in. Move new to old when ingested."
The filesystem itself becomes the progress indicator. That only works if the move
NEVER lies: a file must reach Old Receipts if and only if its content is in the
library.

## Deliverables

### 1. `src/ingest/dirwalk.ts`
`walkForImportable(root: string): Promise<{ files: string[]; skippedUnsupported: number }>`
- Recursive, cycle-safe (realpath visited-set), depth cap 25.
- Supported extensions: jpg jpeg png tif tiff bmp webp pdf vcf (case-insensitive).
- Ignore dotfiles/dirs, `desktop.ini`, `Thumbs.db`. Deterministic sort.
- Unsupported files are counted, not rejected — a folder with stray .txt notes
  must not spam the rejected list.

### 2. `importFiles` changes (src/ingest/import.ts)
- Any request path that is a DIRECTORY → expand via walkForImportable. Aggregate
  `skippedUnsupported` into the result (contract field already added).
- `req.skipDuplicates?: boolean`: after fileStore.put (content-addressed, so this
  is idempotent), if a `page.content_hash` row already exists for that hash →
  create NO item; report in `result.duplicates: [{path, existingItemId}]`
  (contract field exists). The thumbnail for a skipped duplicate must not create
  an item either.
- Empty directory → 0 items, not an error.

### 3. `src/ingest/watchFolders.ts` — the service
```ts
createNewReceiptsWatcher(deps: IngestDeps, opts: {
  newDir: string; oldDir: string;
  pollMs?: number;                  // default 4000
  now?: () => number;               // injectable clock
}): {
  start(): void; stop(): void;
  tick(): Promise<TickResult>;      // one full pass, awaitable — THE test surface
  status(): { watching: boolean; pendingCount: number;
              failed: Array<{ name: string; reason: string }> }
  onActivity(fn: (e: { ingested: number; duplicates: number; failed: number }) => void): () => void
}
```
Pure Node. NO Electron imports. Timers via setInterval + fs.watch hint
(debounced ~500ms → tick), but ALL behavior must be drivable through `tick()`
with fake `now` so tests never sleep.

**Tick algorithm:**
1. Walk newDir (reuse walkForImportable; preserve relative subpaths).
2. Stability gate: a file is eligible only if (size, mtimeMs) matches the
   previous tick's observation — a file mid-copy must not be ingested. First
   sighting → record, skip this tick.
3. Eligible batch → `importFiles({ paths, toInbox: true, skipDuplicates: true, awaitOcr: false })`.
4. Per file, on SUCCESS (item created OR confirmed duplicate): move to oldDir
   preserving the relative subpath. Collision → `name (2).ext`, `(3)`, ….
   Move = rename; on EXDEV: copy → verify size + sha256 → unlink. NEVER unlink
   an unverified copy. Rejected files STAY in newDir (visible as un-ingested),
   recorded in `failed` with the reason; retry only when mtime changes (no hot
   loop).
5. start() performs an immediate tick — files dropped while the app was closed
   are picked up on launch.

**Crash-window property (test it):** ingest succeeds, move throws once → file
remains in New; next tick: skipDuplicates confirms content already present →
file still archives to Old, no second item. The system self-heals; the user
never sees a duplicate.

## Tests — src/ingest/__tests__/ (extend; use the existing harness + stub OCR)
1. Directory with nested subfolders + a .txt + a .DS_Store → correct file set,
   skippedUnsupported=1, hidden ignored.
2. Import of a directory path creates items for every supported file.
3. skipDuplicates: same file twice → 1 item, duplicates[] names the existing item.
4. tick(): unstable file (size changes between ticks) is NOT ingested; becomes
   stable → ingested and moved; original bytes in Old are hash-identical.
5. Collision: Old already has `r.jpg` → arrives as `r (2).jpg`.
6. Move-fails-once (inject rename throwing once) → self-heal on next tick, no
   duplicate item, file lands in Old.
7. Rejected (corrupt) file stays in New, appears in status().failed, is NOT
   retried until its mtime changes.
8. Subfolder `2026/q3/a.png` in New → `Old Receipts/2026/q3/a.png`.
9. start() initial tick ingests pre-existing files.
10. Watcher never deletes: assert no code path unlinks without a verified copy
    (EXDEV branch test with hash mismatch → source NOT unlinked, error surfaced).

Run: node --experimental-strip-types --test src/ingest/__tests__/*.ts
Typecheck must stay clean (ignore other lanes' mid-flight errors outside your paths).

## Report
DONE|OPEN|BLOCKED / FILES / TESTS (real counts) / DECISIONS / BLOCKERS

## AUDIT REVISIONS (binding — from the batch-2 plan audit)

1. **The Old⟺library invariant, stated once:** a file reaches Old Receipts if and
   only if its content is committed to the library. importFiles NEVER moves
   anything; only the WATCHER moves, and only after item-created-or-duplicate.
2. **Symlink containment (file-loss class):** walkForImportable resolves realpath
   per entry and REFUSES anything outside the walk root; the watcher additionally
   refuses to move/unlink any path whose realpath is not under newDir. A symlink
   in New pointing at the user's only original elsewhere must be ingested-by-copy
   at most, never moved, never unlinked. Test with an out-of-tree symlink.
3. **Single-flight tick:** overlapping tick() (poll + fs.watch hint) must coalesce
   — a busy flag; concurrent callers await the in-flight pass. Test that two
   concurrent tick() calls produce one import batch.
4. **Serialize per-file import→verify→move** inside a tick; collision naming uses
   an exclusive-create retry loop (open 'wx' / COPYFILE_EXCL semantics), never
   check-then-rename. Test EEXIST retry.
5. **Stability gate = 3 consecutive identical (size, mtimeMs) observations**, not
   2 — preallocate-then-fill copiers defeat 2. Test a growing file across ticks.
6. **Dedupe key = ORIGINAL SOURCE BYTES via migration 002 (`item_source_file`).**
   importFiles: put() the original file's bytes into the store (PDFs and vCards
   included — the original document is preserved, not only rasters), record
   {source_sha256, source_relpath, original_name} for EVERY created item, and
   skipDuplicates consults item_source_file.source_sha256 — NOT page.content_hash.
   This makes PDF and vCard dedupe correct and uniform. PDFs: all-or-nothing —
   an item whose pages partially rasterized must be rolled back (item deleted,
   job unit failed), never half-imported then archived.
7. **New API `importPagesAsItem(deps, {paths, targetFolderId?, toInbox?})`** →
   ONE item with N pages in order, one source_file row per... use the FIRST page's
   source or a combined hash? Decision: record source_sha256 of each page file is
   impossible (one row per item) — hash the CONCATENATION of page hashes
   (sha256 of joined per-file sha256s, documented) so a re-scan of identical pages
   dedupes. IPC channel 'ingest:importPagesAsItem' already in the contract; you
   implement the ingest function + wire the handler is the orchestrator's.
   Tests: 3 files → 1 item, 3 pages, seq order; OCR queued per page.
8. vcf files: watcher ingests them (dedupe now works via source hash); unchanged
   otherwise.
