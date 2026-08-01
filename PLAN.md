# KeepR — Phase 1 Implementation Plan (v2, post-audit)

**Program:** KeepR — offline-first receipt, expense, and document management
**Target:** Windows desktop. Develops and runs on macOS/Apple Silicon.
**Stack:** Electron + TypeScript + React + SQLite (FTS5)
**Workdir:** `~/Desktop/Internal Development/Tools/KeepR`
**Test API:** `127.0.0.1:17915` (verified free; clear of 17893/17894/17895/17896/17905/17910)
**Team slug:** `keepr` — grok master channel `master-keepr`

> **v2 supersedes v1.** The plan audit returned **REVISE** and this is the
> revision. Changes: Lane 0 expanded to own the runtime spine; the wave table
> corrected to stop contradicting its own dependency column; the OCR runtime
> contract locked; native packaging made explicit; acceptance criteria rewritten
> to be machine-checkable. Schema decisions now live in executed DDL
> (`src/db/schema/001_initial.sql`, verified by `spikes/schema-verify.mjs`),
> not in prose.

---

## 1. Scope (locked with the user 2026-07-30)

| Decision | Value |
|---|---|
| Stack | Electron + TypeScript + React + SQLite/FTS5 |
| Phase 1 breadth | Full Phase 1 as scoped |
| Scanner / TWAIN | **Deferred.** User will attach a scanner later. Build the capture interface; write no TWAIN code blind. |
| Virtual printer | **Deferred to Phase 3.** Real Windows print-driver work. |
| Name | KeepR |
| UI | **Approved** at the gate — see `design/DESIGN.md`. Accent is **TEAL**, decided 2026-07-30. Token values in `design/DESIGN.md`. |

**Deliberate non-goals.** Stated so no executor invents them: no TWAIN/WIA, no
virtual printer, no accounting bridges, no bank matching, no sync, no multi-user,
no remote LLM calls. OCR is a swappable provider so Phase 4's vision-model
upgrade needs no rewrite.

---

## 2. Architecture

```
main process        DB owner (single connection), FileStore, JobQueue supervisor,
                    IPC registration, HTTP test API :17915
  |
  +-- sharp/pdf worker pool (cores-1)   image decode, thumbnail, rotate, rasterize
  +-- tesseract.js Scheduler            OCR, capped separately — see §5
  +-- preload (contextBridge)           typed least-privilege surface
  +-- renderer (React)                  UI only; no fs, no db, no direct ipc
```

**Single DB connection, in main.** No lane opens a second one. WAL plus two
writers in one process is a corruption and lock-timeout generator.

**Workers return data; main writes.** OCR workers hand back an `OcrResult` and
never touch SQLite. Main writes `page.ocr_*` and drops any result whose
`ocr_generation` no longer matches the row — otherwise a slow OCR job that
finishes after the user has already corrected a field silently overwrites their
correction.

---

## 3. Schema

Executed DDL: **`src/db/schema/001_initial.sql`**. Verified by
**`spikes/schema-verify.ts`** — 47 assertions, all passing, of which 14 are
attacks that must be *rejected for the right reason*. Read the file; its
`INVARIANT` comments are requirements with tests attached, not commentary.

**Shapes are not enough — transitions are guarded.** The first revision claimed
the double-count was structural when CHECK constraints only police a single row
at write time. This was legal SQL and it silently doubled every total:

```sql
UPDATE item SET split_group_id=NULL, split_role=NULL, superseded_at=NULL WHERE id=<origin>;
```

Triggers now make the illegal transitions impossible: un-superseding an origin
with live children, promoting a child, purging an origin out from under its
children, deleting a cited page, combining an item that is split, splitting an
item that is combined, or storing an item in the trash folder. Each has a test
asserting both the rejection and its reason.

The load-bearing decisions:

| Decision | Why |
|---|---|
| Money as `*_minor` INTEGER, never REAL | A float total in an expense report is a wrong number that looks right |
| Splits: origin marked `superseded_at`, children share `split_group_id` | `v_summable_receipts` is the only sanctioned way to sum. The verify script proves a naive `SUM(receipt_data)` returns 20000 where the truth is 10000 |
| Split remainder: largest-remainder to earliest children | `10000/3 → 3334, 3333, 3333`, sums exactly |
| Split children own no page rows; cite origin via `v_item_pages` | Image stored once; deleting one child cannot orphan its siblings' citation |
| `file_relpath` relative to library root, never absolute | Absolute paths make a library non-portable — Mac-authored libraries would break on Windows |
| Civil dates `TEXT 'YYYY-MM-DD'`; instants INTEGER unix ms | One convention each |
| `item_search_src` is a real table | v1 referenced it as FTS content without defining it, so `item_fts` could not have been created |
| Normalized `receipt_tax_line` | §7 needs tax grouped and summed; a JSON blob cannot be |
| `merge_group` + `snapshot_json` | Page reassignment alone cannot restore absorbed receipts' fields, so combine would be lossy and acceptance #5 unmeetable |
| Inbox is `folder.kind='inbox'` | Not `folder_id IS NULL`; a query that forgets the special case silently hides items |
| `job.status` includes `'partial'` | A 10-page PDF where page 7 fails is neither success nor failure |
| `v_summable_tax` gates tax the way `v_summable_receipts` gates money | Without it, tax after a split summed to **zero** while the superseded origin still held the real lines — tax vanished from the status bar and every tax report |
| `v_folder_totals` groups by currency, always | A single blended figure across USD and EUR is not a total, it is a lie with a currency symbol on it |
| `v_split_reconciliation` exposes drift for assertion | SQLite has no deferred CHECK, so a mid-transaction split cannot be row-constrained; the repo asserts zero drift before commit |
| `v_searchable_pages` filters trashed items | `page_fts` indexes OCR text regardless of `trashed_at`, so a raw MATCH surfaces deleted receipts. Search reads through the view |
| `item_search_src` maintained by trigger, not app code | Leaving it to the repository meant any forgotten write path rotted structured search with no visible symptom |
| Negative totals allowed | A refund is a real receipt. Blocking negatives means the user cannot enter a return at all; `allocate()` handles sign for the same reason |

---

## 4. Build lanes

Lane 0 owns the **hub**: the contract, the schema, the runtime spine, the shared
UI kit, root tooling, and every `SPEC.md`. The v1 table partitioned only leaf
domains, which left `src/main`, preload, IPC registration, `App.tsx`,
`package.json`, the file store, and the job supervisor unowned — meaning six
lanes would have fought over them.

| Lane | Scope | Files owned | Executor | Depends on |
|---|---|---|---|---|
| **0** | Contract + schema + **runtime spine**: `src/main` bootstrap, preload, IPC registration, App shell composition, shared UI kit + stores, design tokens, FileStore, JobQueue port, root tooling, **all SPEC.md files** | `src/shared/**`, `src/main/**`, `src/preload/**`, `src/ui/app/**`, `src/ui/kit/**`, `src/ui/state/**`, `src/db/schema/**`, `src/store/**`, `package.json`, `tsconfig*`, `vite.config.*`, `scripts/**` | **orchestrator** | — |
| A | DB repositories, transactions, list auto-add, `item_search_src` maintenance, **rules engine** | `src/db/repo/**`, `src/rules/**` | grok | 0 |
| B | OCR: tesseract Scheduler, provider, receipt field parser | `src/ocr/**`, `src/workers/**` | grok, parser + pool **reviewed** | 0 |
| C | Ingest: image/PDF/vCard import, drag-drop, Inbox queue | `src/ingest/**` | grok | 0, A, B |
| D | HTTP test API + `keepr-cli` — **single writer** for `src/api/**` | `src/api/**`, `src/cli/**` | grok | see waves |
| E | Nav pane, folder tree, smart filters (**panel only**) | `src/ui/nav/**` | grok | 0 |
| F | Grid: editable, virtualized, columns, multi-sort, bulk (**panel only**) | `src/ui/grid/**` | grok | 0 |
| G | Details + thumbnail + filmstrip + image tools (**panel only**) | `src/ui/viewer/**` | grok | 0 |
| H | Search: FTS, advanced criteria, find-missing-key-data | `src/search/**` | grok, ranking **specified** | 0, A |
| I | Receipt splitting **and combine/separate** | `src/splitting/**` | **sonnet** | 0, A |
| J | Export: CSV, Excel, searchable PDF | `src/export/**` | grok, geometry **locked** | 0, A |
| K | Backup / restore / archive / trash | `src/maintenance/**` | grok | 0, A |
| L | Packaging: electron-builder, Windows NSIS on the Windows build machine, icon | `build/**` | **orchestrator only** | all |

**Combine/separate moved from G to I.** It is a money-and-page integrity
operation wearing a UI costume — G builds the buttons, I owns the transaction.

### Waves (corrected)

v1 claimed `D` ran parallel with `A` while also declaring `D` depends on `A`, and
D's endpoint list actually spans A+B+C+H+I+J+K. Corrected:

1. **Lane 0** — contract, schema, spine, SPECs. Everything blocks on this.
2. **A ∥ B** — strict globs, no shared files.
3. **E ∥ F ∥ G** (panels, exporting components only) **+ D skeleton** (`/health`, folder and item CRUD over A).
4. **C, H, I, J, K** — libraries only; none may touch `src/main`, `src/api`, preload, or `package.json`.
5. **Orchestrator integrates** — App composition, IPC registration, D's full route surface.
6. **L** — native gate on the Windows build machine.

**Must serialize:** `0 → all` · `A → C,H,I,J,K` · `B → C` · feature libs → D route
fill (one writer for `src/api/**`) · panels → App compose (one direction) ·
`v_summable_receipts` freeze → I, status bar, J · native dep freeze → L.

**Never in parallel:** edits to `package.json`, `src/main/**`, preload, or schema.

---

## 5. OCR runtime contract (locked)

Engine is **`tesseract.js` only** for Phase 1. `node-tesseract-ocr` and any
system-binary Tesseract are forbidden — they turn NSIS packaging into a
dependency hunt on the user's machine.

**Threading.** `tesseract.js` already runs its own worker threads. Nesting it
inside a `cores-1` pool multiplies WASM heaps and exhausts memory. So:
- **One** tesseract Scheduler, supervised from main, with its own small worker count.
- A **separate** sharp/pdf pool at `cores-1` for decode, thumbnail, rotate, rasterize.
- These two are sized independently and never nested.

**Offline is mandatory.** `workerPath`, `corePath` (wasm), and `langPath`
(`eng.traineddata`) all resolve to bundled files. No CDN fetch at runtime — an
offline-first app that quietly downloads language data just fails later, on
someone else's machine. `scripts/abi-check.mjs` asserts the files exist on disk
and the release gate runs it with the network blocked.

**Geometry invariant.** Word bboxes are in **stored-master pixel space** — the
pixels of `file_relpath` as it sits on disk. Rotation is metadata-only, applied
at display and export time, **never also baked into the file**. Doing both is how
the searchable-PDF text layer and region-to-field mapping drift out of alignment
while looking correct. A crop rewrites the master and therefore invalidates
`ocr_*` and re-queues OCR.

**Job state machine.** `pending → queued → running → done | failed | cancelled`,
with `partial` at the job level. Cancel mid-import is supported. Re-OCR fills
**empty fields only** unless forced, and never overwrites a field the user
pinned by correcting it.

---

## 6. Native packaging contract

| Piece | Requirement |
|---|---|
| Pins | `electron`, `better-sqlite3`, `sharp`, `@electron/rebuild` pinned **exactly**, no carets. A minor bump changes ABI expectations and produces "it fixed itself after a rebuild" |
| Rebuild | `better-sqlite3` builds for Node on install; it must be rebuilt for the Electron ABI |
| asar | `sharp`, `@img/**`, `better-sqlite3`, `tesseract.js`, `tesseract.js-core`, and `resources/tessdata` are **unpacked**. Left inside the archive the app launches and dies on first import |
| Windows | **Fresh clone + `npm ci` on the Windows build machine.** Never copy macOS `node_modules` — Mac binaries in a Windows installer fail instantly |
| Cross-build | `electron-builder --win` on macOS is **not** the release path for these natives |
| Gate | `npm ci` → rebuild → `abi:check` under Electron → NSIS → install → import image + PDF → OCR job reaches `done` → one export, **with the network blocked** |

---

## 7. Test API (`keepr --serve --port 17915`)

Every acceptance criterion is a call against this. v1's surface was too thin to
assert what it claimed.

```
GET    /health                      version, schema_version, migration state
POST   /folders            GET /folders           PATCH /folders/:id
POST   /import   {paths[]}          -> {jobId, itemIds}
GET    /jobs/:id                    status machine + partial failures
GET    /items?folder=&type=&q=      list/filter
GET    /items/:id                   item + resolved pages + ocr text + extraction
PATCH  /items/:id                   field edit; respects pinned fields
POST   /items/bulk  {op, ids}       move | delete | export
DELETE /items/:id                   soft delete      POST /items/:id/restore
POST   /items/:id/reviewed
POST   /pages/:id/rotate | /crop | /reorder
POST   /items/combine   {ids}       -> merge_group
POST   /items/:id/separate          restores from snapshot_json
POST   /items/:id/split {parts[]}   -> {origin_total_minor, children[], sum_minor, image_sha256}
GET    /search?q= | ?date=&amount=&vendor=&category= | ?missing=vendor,date,amount
POST   /export/{csv,xlsx,pdf}
POST   /backup | /restore | /archive
GET    /rules            POST /rules
```

---

## 8. Acceptance criteria (machine-checkable)

| # | Criterion | Asserted by |
|---|---|---|
| 1 | 25 images + 10-page PDF import and OCR | every page `ocr_status='done'`; job rollup; `GET /jobs/:id` stays responsive under load |
| 2 | Fields extracted; vendor→category applied; corrections persist | fixture set vs expected values; `PATCH` then re-OCR must not clobber pinned fields |
| 3 | Folder hierarchy; items filed | folder CRUD + `PATCH /items/:id {folder_id}`. Drag-drop verified by screenshot, outcome by API |
| 4 | 10k items; inline edit; multi-sort; columns; bulk | seed 10k via API; `POST /items/bulk`; grid smoothness is a **measured** frame budget or an explicit visual gate |
| 5 | Image tools; reorder; combine 3→1; separate back | page ops + `POST /items/combine` then `/separate`; assert page `seq` **and** restored field values |
| 6 | OCR-only word found; advanced filters; missing-data | unique token present only in `ocr_text`; multi-criteria query; `?missing=` against a known-incomplete fixture |
| 7 | Split 3 ways; totals reconcile; all cite original | `sum_minor === origin_total_minor`; folder sum unchanged (**not 2×**); same `image_sha256` for all three |
| 8 | CSV / Excel+images / searchable PDF | open the artifacts: CSV row count and sums, Excel embedded-image count, PDF text extract contains a known OCR token on the expected page |
| 9 | Backup → wipe → restore | hash the library tree after WAL checkpoint, **plus** invariant queries: split sums reconcile, FKs clean, every `file_relpath` resolves |
| 10 | Trash recovers | soft delete absent from default list, present in trash, restored fields equal |
| 11 | Windows installer | after install: `--serve` health, import a fixture, OCR reaches `done`, open the DB, one export — **offline** |

"Byte-identical" was dropped from #9: bytes are neither necessary nor sufficient
for a correct library. Graph integrity is what matters.

---

## 9. Deferred phases

- **Phase 2 — Reporting:** expense report with cover page + embedded images, config wizard, spending/detail reports, tax-category summaries, drill-through, QIF/OFX/RTF, accounting bridges, email, contact sync.
- **Phase 3 — Capture hardware:** TWAIN/WIA, duplex, ADF batch, Quick Scan, virtual printer driver, diagnostics.
- **Phase 4 — Intelligence:** rules learning from corrections, item templates, multi-currency/jurisdiction, vision-model OCR provider, line items, plugin API, user-owned sync.

---

## 10. Open items

1. ~~Accent hue~~ — **CLOSED: teal.** Approved 2026-07-30 against the blue alternative; token values in `design/DESIGN.md`. UI lanes read `--accent` and never hard-code a colour.
2. **Per-lane SPEC.md** — Lane 0 deliverable, written before wave 2 opens.
3. **Re-audit the delta** — the grok master gates this revision before executors start.
4. **`action_type` list** — in the functional spec's §1 list but unused in Phase 1. Not created; revisit if Phase 2 needs it.
5. **Multi-currency** — `currency` is stored per receipt and sums never cross currencies. Full multi-jurisdiction handling is Phase 4.
