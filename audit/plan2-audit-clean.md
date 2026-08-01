## VERDICT: revise

**Minimum to flip to approve** (must be written into specs/PLAN-2, not left to V):

1. **Old only after ingest commit** — scan/watch stage under tmp or New; move to Old only after library has the bytes.  
2. **Watcher safety** — single-flight `tick`; realpath must stay under `newDir` (no out-of-tree symlink move/unlink); pre-move hash of source == ingested content hash for byte-identical files.  
3. **Named multi-page image ingest** (`N files → one item`) owned by W or V — acceptance “2-page scan = one item” is otherwise impossible.  
4. **Dedupe keys** — PDF skipDuplicates must not key only on raster PNG hashes; define original-PDF-bytes (or all-pages) policy + all-or-nothing before move.  
5. **Progress/cancel** — `scan:*` for device phase; typed `detail.source`/`phase`; demux job progress in UI; preload allowlist + wire `scan:*` and `watcher:activity`.  
6. **R** — thumb via `v_item_pages`; sort CASE nulls-last + whitelist; `needsReview` in summable WHERE.  
7. **T** — lock JS column math (gap), fluid rowHeight, nav2d clamps, mount budget at wide widths.

Then W∥S∥R∥T, V serial.

---

## CRITICAL

**1. Scan success → Old before ingest**  
Crash between write-to-Old and DB commit → files look “done” with no item (breaks Old iff library).  
**Fix:** stage → full ingest → move to Old (or always land in New, watcher archives).

**2. Symlink / path escape on move**  
Symlink in New pointing outside → import then rename/unlink can delete the user’s only original.  
**Fix:** only import/move realpaths under `newDir`.

**3. Concurrent tick / concurrent skipDuplicates**  
Overlapping `tick()` or import without lock → two Inbox items for one drop; racey moves.  
**Fix:** single-flight tick; serial per-file import→verify→move; in-process hash lock (hash index is not UNIQUE).

**4. Multi-page scan vs `importFiles` today**  
`importFiles([p1,p2])` = two items; no owned multi-page API.  
**Fix:** contract + owner for single multi-page item before S/V claim acceptance #5.

**5. Job/`import` progress collision + dead events**  
One global `job:progress` bar; preload may not forward `scan:*` / `watcher:activity`.  
**Fix:** demux by jobId/source; expand preload + wireEvents; scan device progress on `scan:*` only.

---

## HIGH

**1. Weak stability gate**  
Two size+mtime samples; preallocated copies → partial file ingested and moved; New empty.  
**Fix:** 3 observations or dual-hash delay; test growing files.

**2. PDF: partial import + whole-file move; raster hash ≠ source PDF**  
Fail mid-PDF → incomplete item; skipDuplicates on page raster can false-dedupe and archive the PDF.  
**Fix:** all-or-nothing before move; dedupe key on original PDF bytes (or full page-set), not a single raster alone.

**3. Collision rename check-then-act**  
Two files decide `r (2).jpg` free → lose/clobber under concurrency.  
**Fix:** serial moves; retry on EEXIST / exclusive create.

**4. COLLATE / whitelist / nulls-last (R)**  
Category “dead” = NULLS first + incomplete map; hostile/flag sorts may not fall back to default.  
**Fix:** CASE nulls-last both dirs; COLLATE NOCASE on names; full whitelist; empty whitelist → default order; stable `i.id ASC`.

**5. Split child thumbs**  
Naive `page WHERE item_id = i.id` → blank thumbs for children.  
**Fix:** subselect from `v_item_pages` only.

**6. needsReview totals**  
Rows filtered; summable WHERE often not → status bar lies.  
**Fix:** same needsReview predicate on totals path.

**7. watcherStatus stub / plumbing**  
Context may still report `watching: false`; import IPC may drop `skipDuplicates`.  
**Fix:** V starts real watcher; forward skipDuplicates on import + HTTP.

**8. eSCL field gaps**  
Auth, PDF-only ADF, ADF-empty encodings, short 503 budget, insecure XML defaults.  
**Fix:** typed refuse/copy; more fixtures; `processEntities: false`; honest TLS-only UI.

**9. vCard in New walk**  
No page hash → crash self-heal duplicates contacts.  
**Fix:** exclude vcf from watcher or add non-page dedupe.

---

## EXECUTOR (only wrong-for-grok)

None require a different model **if** the revise locks above are in the SPECs.  
**Not “wrong,” but must not ship unreviewed:** **W** (file-loss paths) and **S** (protocol/cancel/XML). Flag mandatory post-impl audit, not a different executor.

---

## PRODUCT

**(a) Manual imports do not move originals — keep.**  
Surprising/destructive if Import relocates Downloads. New Receipts = opt-in archive; Import = copy into store. Prefer move only when **caller is watcher** (or explicit archive), not merely “path under New.”

**(b) Failed scans → New — keep intent; fix success path.**  
New = not safely in library; Old = archived because library has bytes. Failed → New is coherent; success must not write Old first.

**(c) Reuse job kind `import` + `detail.source='scan'` — keep kind, no migration required.**  
`detail_json` is freeform. What fails is progress/cancel without typed detail, separate `scan:*` for device phase, and UI demux. Optional CHECK kind `'scan'` is polish, not required.

---

## Fragment confirmations

| Claim | Call |
|---|---|
| Watcher tick re-entrancy | **Confirmed** — no single-flight in plan → double ingest/move |
| PDF source-bytes vs raster hash breaks skipDuplicates | **Confirmed** — pages store raster hash; PDF file dedupe/self-heal wrong if keyed only on that |
| Collision-rename check-then-act race | **Confirmed** under concurrent ticks |
| COLLATE / whitelist notes | **Confirmed** — needed for category/payment sort; whitelist = injection guard |
| watcherStatus stub | **Confirmed** as current risk — must not remain stub after V |

**Manual no-move and failed-scan→New** stand; **scan success→Old first** does not.
