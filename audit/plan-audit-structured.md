## VERDICT: revise

Do not open implementation lanes until Lane 0 locks schema/money/FTS/split invariants and the plan fixes unowned Electron wiring, the wave/dep contradiction, native offline packaging, the OCR runtime contract, and machine-checkable acceptance.

---

## RISKS

1. **Money type + split lifecycle unspecified in PLAN (only in spikes)**  
   REAL/float totals or a still-summable origin next to children → status bar / folder / export / tax **double-count or drift by cents**. Plausible wrong numbers — worst class of bug.

2. **Split page ownership vs “all three cite original image”**  
   `page.item_id` is one owner; `split_group.origin_page_id` is group-level only. Without shared citation + relative/refcounted files → export embeds nothing for siblings, or deleting one child **orphans the image** for the rest.

3. **`item_search_src` undefined; FTS triggers/rebuild are prose**  
   `item_fts` cannot be created as written; external-content FTS does not auto-sync → acceptance #6 fails or search goes **silently stale** after edits/migrations.

4. **UNION + rank across `page_fts` and `item_fts`**  
   BM25 scores not commensurate; multi-page hits need collapse; dual hits double-list items → duplicate/noisy relevance; Lane H demos that fail product search.

5. **Electron spine unowned (`src/main`, preload, IPC registration, App compose, package.json)**  
   Lanes own leaves only → six-way merge thrash and incompatible IPC before any feature works.

6. **Wave table contradicts deps (D∥A; D wraps modules that do not exist yet)**  
   Hollow stubs rewritten in the same `src/api/**` files, or wave-2 lanes breach D ownership.

7. **Native packaging under-specified**  
   Carets, missing `abi:check`, no asarUnpack for sharp/`@img`, tesseract CDN, Mac `node_modules` on Windows → installer “launches” with **dead DB/import/OCR**.

8. **OCR pooling wrong for `tesseract.js`**  
   Outer worker pool × inner tesseract workers → OOM; no job/cancel/partial-fail/write protocol → import freezes, stale OCR clobbers edits, “responsive” untestable.

9. **Word bbox coordinate space + rotation/crop undefined**  
   Searchable PDF and region→field misalign after rotate/crop → #5/#8 look green while wrong.

10. **Backup “byte-identical” without relative paths / WAL protocol / manifest**  
    Absolute paths + live WAL copy → restore only works same machine/path; Mac→Windows library broken.

11. **Combine/separate has no merge journal**  
    Page reassignment alone cannot restore original receipt fields → money lost; irreversible merge.

12. **Soft-delete vs FTS / default filters**  
    Trash in search, or recover without index consistency; empty-trash file GC undefined → leaks or broken citations.

13. **Tax + currency columns without split/sum rules**  
    Cloned `tax_breakdown_json` triple-counts; mixed currencies summed in status bar; Phase 4 inherits scale/float poison.

14. **Acceptance API incomplete for stated criteria**  
    No folders/bulk/trash recover/page ops/combine/rules/reviewed → “machine-checkable via 17915” is aspirational.

15. **`specs/` empty; SPEC authorship unassigned**  
    “Build to SPEC only” unenforceable; fast models invent incompatible ports.

---

## GAPS

**Missing subtasks / ownership**
- Lane M or Lane 0 deliverable: `src/main/**`, preload, IPC handler map, App layout slots, shared UI state  
- Rules engine home (`src/rules/**` or A) — acceptance #2  
- Image/file store service (ingest, OCR, export, backup, split citation)  
- Job queue service (types in 0; impl owned) — C→B, D `/jobs`, progress  
- Per-lane SPEC.md written by orchestrator **before** wave 1  
- Native contract in Lane 0: exact pins, asarUnpack, offline tessdata, Electron `abi:check`, Windows clean-install  
- OCR job state machine + partial failure  
- Geometry invariant + re-OCR on rotate/crop  
- Extraction pure core vs main `applyExtraction`  
- Canonical sum gate (`v_summable_receipts` or equivalent) for status bar / export / folder sums  
- Inbox semantics (system folder vs `folder_id NULL`)  
- Field provenance / per-field confidence  
- Migration runner (user_version, FTS rebuild, seed vs data, backup-before-migrate)  
- Promote spike money/remainder decisions into PLAN (not only `spikes/`)

**Missing / underspecified schema**
- `item_search_src` + triggers; `total_minor`/`tax_total_minor`; split origin snapshots + role; page share model; relative media paths; merge journal; job table or “ephemeral only”; `vendor.default_category_id`; indexes/FKs; civil-date vs timestamp; trash/FTS invariants; clarify/remove `txn_id` and `action_type`

**Untested / non-machine-checkable criteria**
- #1 responsive: no numeric budget, no partial-fail API  
- #3 no folder tree/move endpoints  
- #4 grid perf visual; bulk ops not in API  
- #5 no rotate/crop/reorder/combine endpoints  
- #7 split body/response/invariant not in PLAN  
- #9 byte-identical ≠ graph integrity  
- #10 no trash recover endpoint  
- #11 launch ≠ native smoke (import+OCR+DB)

**Edge cases unhandled in PLAN**
- 100.00/3 remainder (spikes only); non-summing user amounts; soft-delete 1 of 3; edit child after split; concurrent split 409; re-OCR vs pinned fields; thermal/multi-total OCR; PDF password/corrupt/memory; WAL backup; vendor rename → FTS refresh

---

## EXECUTOR

| Lane | Proposed | Right? | Flag |
|---|---|---|---|
| **0** | orchestrator | **Yes — expand** | Own SPECs, hub scaffold, native contract, money/split DDL — not types-only |
| **A** | grok | OK if ports frozen | Churn if I/H/K force ad-hoc repos |
| **B** | grok (parser flagged) | **Risky** | Fast model: double-pool tesseract.js, wrong bbox space, CDN lang. Hard SPEC + mandatory review; sonnet optional for pool/geometry |
| **C** | grok | OK after A+B/job | Deps incomplete without B |
| **D** | grok | **Wrong wave** | Skeleton after A only; full routes after C/H/I/J/K |
| **E** | grok | OK as panel-only | With F/G will fight App/store unless single App owner |
| **F** | grok (virtualization flagged) | OK | Virtualization + selection store boundaries |
| **G** | grok | OK as panel-only | Combine/separate integrity is **not** casual UI — escalate or hand to I-tier |
| **H** | grok (FTS flagged) | OK with ranking SPEC | Will invent broken UNION-rank without contract |
| **I** | **sonnet** | **Yes** | Keep; also combine/separate money/page integrity |
| **J** | grok (PDF flagged) | OK if geometry locked | PDF layer wrong if bbox space wrong |
| **K** | grok | OK | Must call A for soft-delete; not reimplement |
| **L** | orchestrator | **Yes** | Extend #11 to functional native smoke |

**Fast-model magnets:** float money; shell+children both summable; absolute paths; tesseract CDN; missing asarUnpack; second SQLite connection; combine without journal; D stubbing later lanes’ surfaces.

---

## SPLIT

**Safe concurrent (after 0 closed + hub skeleton + dep budget)**  
- **A ∥ B** — strict globs; job types only from shared  
- **E ∥ F ∥ G** — panels only; **no** App.tsx / shared store / package.json  
- **H ∥ I ∥ J ∥ K** — after A freeze; libraries only; no main/api/package edits  
- **C** — after A **and** job/OCR port  

**Must serialize**  
- **0 → all**  
- **A → D (real routes)**  
- **A → C, H, I, J, K**  
- **B → C** (or job port in 0 + main bridge)  
- **Feature libs → D route fill** (single writer for `src/api/**`)  
- **F/G panel exports → E App compose** (one direction only)  
- **A sum-view freeze → I, E status bar, J export**  
- **Native dep freeze → L**  

**Illegal as drawn**  
- **A ∥ D** while D depends on A  
- **D full surface** before C/H/I/J/K  
- Any parallel edits to `package.json`, `src/main/**`, preload, schema  

**Revised wave sketch**  
1. Expanded **0**  
2. **A ∥ B**  
3. **E ∥ F ∥ G** (panels) + **D skeleton** (health + item CRUD via A)  
4. **C, H, I, J, K**  
5. Orchestrator integrate: App, IPC registration, D full routes  
6. **L** on CT-113199  

---

## Five blockers expanded

### 1. Unowned Electron wiring

**No lane owns these files/concerns** (table only partitions leaf domains):

| Concern | Typical paths | Who will fight them |
|---|---|---|
| Process bootstrap, single DB connection, window, `--serve` | `src/main/**` | A, B, D, C, K, L |
| `contextBridge` / least-privilege IPC surface | `src/preload/**` | E, F, G, C, H + handler authors |
| IPC **registration** (contract ≠ handlers) | `src/main/ipc/**` or similar | Every feature lane |
| App composition / three-pane mount | `src/ui/App.tsx` (or root layout) | E, F, G, H |
| Shared UI kit + selection/folder/view store | `src/ui/components/**`, `src/ui/state/**` | E, F, G, C |
| Root tooling | `package.json`, lockfile, `vite.config.*`, `tsconfig*`, `scripts/**` | All lanes |
| Rules engine | (no `src/rules/**`) | A vs B vs C invent it |
| Image/file store | (no owner) | C, B, J, K, I |
| Job queue supervisor wiring | claimed “main” in prose, no file owner | B, C, D |

Lane 0 owns **IPC contract types** under `src/shared/**` only — not the runtime spine. Architecture says main owns DB/IPC/HTTP/workers; **file ownership is absent**.

---

### 2. Wave / dep lies

**Stated:**

| Lane | Depends on | Wave |
|---|---|---|
| D | 0, **A** | Wave 1: **A, B, D, E, F, G** parallel |
| C | 0, A | Wave 2 |
| H,I,J,K | 0, A | Wave 2 |

**Contradictions:**

1. **D depends on A but starts in the same wave as A** — one of the two claims is false.  
2. **D’s listed API is not A-shaped.** Endpoints map to later owners:
   - `POST /import`, `GET /jobs/:id` → **C + B**  
   - `POST /items/:id/split` → **I**  
   - `GET /search` → **H**  
   - `POST /export/*` → **J**  
   - `POST /backup`, `/restore` → **K**  
   So real D depends on ≈ **A + B + C + H + I + J + K + main**, not `0, A`.  
3. **C → 0, A** omits **B** (or a frozen JobQueue port) — import must enqueue OCR.  
4. **E/F/G → 0 only** is mock depth, not product depth (need preload + A queries).  
5. Wave 2 “C,H,I,J,K parallel” is only safe if they **never** touch main/api/preload/package.json — plan does not enforce that.

---

### 3. Native offline packaging (better-sqlite3 / Electron ABI / Windows)

**Facts on disk today:** carets (`electron ^33`, `better-sqlite3 ^11`, `sharp ^0.34`); `rebuild` only targets better-sqlite3; `abi:check` → missing `scripts/abi-check.mjs`; Mac install has **darwin** sharp only, not win32.

| Piece | Reality | Consequence if ignored |
|---|---|---|
| **better-sqlite3** | Classic native addon; `npm install` builds for **Node**, not Electron | `NODE_MODULE_VERSION` crash until `@electron/rebuild` / `install-app-deps` under **that** Electron |
| **Mac dev** | Rebuild on darwin-arm64 under Electron; smoke `require('better-sqlite3')` **inside Electron**, open DB, assert FTS5 | “Works in node spikes” ≠ works in Electron (spikes already admit this) |
| **sharp** | N-API prebuilds; packaging-hard: need `@img/sharp-<platform>` + libvips; **asarUnpack** for `sharp` and `@img/**` | UI launches; first thumbnail/import dies |
| **Windows NSIS** | Must **fresh clone + `npm ci` on CT-113199** (never copy Mac `node_modules`); then Electron rebuild; then builder | Mac binaries in Windows installer → instant fail |
| **Cross-build** | Do not treat `electron-builder --win` on Mac as release path with these natives | Wrong/missing `.node` / platform packages |
| **Pins** | Exact electron + rebuild + better-sqlite3 + sharp (no `^` for ABI-critical set) | Non-reproducible “fixed after random rebuild” |
| **Criterion 11** | “Installs and launches” is insufficient | Green packaging with dead DB/OCR/image path |

**Minimum Windows gate:** clean `npm ci` → rebuild → Electron abi:check (sqlite + sharp + offline OCR fixture + pdf raster) → NSIS → install → import image+PDF → job complete. Airplane-mode OCR.

---

### 4. OCR runtime contract

**Chosen dep:** `tesseract.js` (WASM), not OS Tesseract / native node bindings.

| Topic | Plan gap | Required lock |
|---|---|---|
| **Engine** | Says only “Tesseract behind OcrProvider” | Lock **tesseract.js only** for Phase 1; forbid `node-tesseract-ocr` (system binary hell on NSIS) |
| **Offline** | Silent | Bundle `workerPath`, `corePath` (wasm), `langPath` (`eng.traineddata`); **no CDN** at runtime; assert under network block |
| **Workers** | Outer pool `cores-1` for OCR + image + PDF | tesseract.js **already** uses worker_threads. Nesting ⇒ N× WASM heaps → OOM. Pick one: (a) tesseract Scheduler supervised from main + separate sharp/pdf pool, or (b) one long-lived Tesseract per outer worker, no nested scheduler, small concurrency caps |
| **Crash isolation** | “Workers” oversold | `worker_threads` share process; sharp fault can kill app. Soft recovery = replace worker + requeue; true isolation needs child/utility process if required |
| **DB** | Main owns DB | Workers return `OcrResult` only; **main** writes `page.ocr_*` + extraction; stale `jobId`/generation ignored |
| **Geometry** | `words_json` + `rotation` unscoped | One invariant: bboxes in stored-master pixel space; bake rotation into file **or** metadata-only — not both; re-OCR/invalidate on crop |
| **PageImageRef** | Named, undefined | Prefer `{kind:'path', path}` / pdf-page refs; not multi-MB buffers by default |
| **Jobs** | `/jobs/:id` vapor | Status machine: pending→queued→running→done\|failed\|cancelled; partial PDF failure; cancel mid-import; extract fills **empty fields only** unless force |

---

### 5. Non-assertable acceptance

| # | Criterion | Machine-checkable today? | Gap | Replace / add |
|---|---|---|---|---|
| **1** | 25 images + 10-page PDF OCR’d; UI responsive | **Partial** | No job status enum, partial-fail, or latency budget | Poll every page `ocr_status=done\|failed`; import rollup; e.g. `GET /jobs/:id` p99 &lt; 50ms under load; optional main-thread lag metric |
| **2** | Auto-extract; vendor→category; corrections persist | **Weak** | No rules API; overwrite policy undefined | Fixture set with expected fields; `PATCH` then re-OCR does not clobber pinned; assert category from seeded vendor/rule |
| **3** | Folder tree, file into folders, DnD | **No** | No folder CRUD/move in API | `POST/GET/PATCH /folders`, `PATCH /items/:id {folder_id}`; DnD UI still screenshot, file outcome via API |
| **4** | 10k grid smooth; inline edit; multi-sort; columns; bulk | **Mostly no** | Perf/columns are UI; no bulk endpoints | Seed 10k via API; bulk `POST /items/bulk {move\|delete\|export}`; edit via `PATCH`; smooth = measured (fps/script) or demote to visual gate |
| **5** | Details image tools; reorder; combine 3→1; separate back | **No** | No page-op or combine API | `POST /pages/:id/rotate`, reorder, `POST /items/combine`, `POST /items/:id/separate` + assert page seq + field restore policy |
| **6** | OCR-only word; advanced filters; missing-key-data | **Partial** | Search exists in list; missing-data vague | `GET /search?q=` unique OCR token; `GET /search?date&amount&vendor&category`; `GET /search?missing=vendor,date,amount` with known incomplete fixture |
| **7** | Split 3-way; totals reconcile; cite image | **No** (until contract) | No body/response/invariant | Response: `origin_total_minor`, children minors, `sum_minor`, image sha256; assert sum===origin, default folder sum===origin not 2×, same sha for all three |
| **8** | CSV / Excel+images / searchable PDF | **Partial** | Paths returned; text layer not asserted | Open artifacts: CSV row count/sums; Excel image count; PDF text extract contains OCR token at expected page |
| **9** | Backup → wipe → restore byte-identical | **Misleading** | Bytes ≠ graph OK; absolute paths break | Hash full library tree (DB after checkpoint + images); plus invariant query: split sums, FKs, relative paths resolve |
| **10** | Trash recovers item | **No** | No delete/recover routes | `DELETE /items/:id` (soft), `POST /items/:id/restore`; assert absent from default list, present in trash, restored fields equal |
| **11** | Windows installer installs and launches | **Too weak** | Launch ≠ native pipeline | After install: `--serve` health; import fixture; OCR job done; open DB; one export — offline OCR |

**Also missing for “full Phase 1 via 17915”:** reviewed toggle, bulk export already under #4, contacts/vCard if in scope, schema_version on `/health` (present) plus migration smoke.
