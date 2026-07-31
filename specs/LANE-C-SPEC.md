# Lane C — Ingest: import, Inbox queue, OCR orchestration

**Executor:** grok · **Wave:** 4 · **Depends on:** Lane 0, A, B

## You own
```
src/ingest/**
```
**Read** `src/shared/types.ts`, `src/shared/ipc.ts` (`ImportRequest`,
`ImportResult`), `src/db/repo/**` (the repositories you call), `src/ocr/**`
(`OcrProvider`, `parseReceipt`), `src/workers/imagePool.ts`, `src/store/fileStore.ts`,
`src/main/jobQueue.ts`, `PLAN.md` §5.

**Do NOT touch** anything outside `src/ingest/**`. Lanes H, I, J, K are working in
this directory right now. No new npm dependencies.

## Goal
Turn files on disk into reviewable items. This is the lane that finally puts a
receipt in the library — **every acceptance criterion depends on it.**

## Deliverables
`src/ingest/import.ts`
```ts
importFiles(deps: IngestDeps, req: ImportRequest): Promise<ImportResult>
```
- Accepts JPEG/PNG/TIFF/BMP/WEBP, PDF, and `.vcf`.
- **PDF:** rasterize each page via the image pool, one `page` row per PDF page,
  one item per PDF unless `splitPages` is set.
- **Images:** one item per file.
- **vCard:** one contact item per card, no OCR.
- Unreadable files land in `ImportResult.rejected` with a reason. **Never throw
  away a file silently and never abort the whole batch for one bad file.**
- Everything goes through `FileStore.put` — never join a path yourself, never
  store an absolute path.
- Creates a `job` and returns its id immediately; OCR continues in the background.
- Default target is the **Inbox** folder (`folder.kind='inbox'`), not a user folder.

`src/ingest/ocrRunner.ts`
- Consumes the queue, calls the `OcrProvider`, writes results via
  `pages.setOcrResult`. **Workers return data; only this runner writes.**
- Honours `ocr_generation`: a result whose generation no longer matches is
  discarded, not applied. A slow OCR finishing after the user edited a field must
  not clobber the edit.
- Per page: `pending → queued → running → done | failed`. Page failure does not
  fail the job; the job ends `partial`.
- Cancellable: `jobs.isCancelled(id)` stops further work.
- Bounded concurrency. **Do not create a second worker pool** — use the one
  supplied. tesseract.js already runs its own threads; nesting pools exhausts memory.

`src/ingest/extract.ts`
- Runs `parseReceipt`, applies rules via `src/rules/engine.ts`, writes fields
  through `items.patch`.
- **Fills EMPTY fields only.** Never overwrites a field marked `pinned` in
  `extraction_json` unless `force` is set. Records confidence and bbox per field.

`src/ingest/inbox.ts`
- `listInbox`, `markReviewed`, `fileInto(itemId, folderId)`, `nextUnreviewed`.

## Tests — `src/ingest/__tests__/`
In-memory DB from `src/db/schema/001_initial.sql` (see `spikes/schema-verify.ts`
for the pattern) and a **stub OcrProvider** — do not run real OCR in tests.

1. Importing 3 images creates 3 items in the Inbox, each with one page.
2. A 4-page PDF creates 1 item with 4 pages in correct `seq` order.
3. A corrupt file is reported in `rejected` and the other files still import.
4. Stored page paths are relative and resolve through the FileStore.
5. Importing the same image twice stores **one** file (content-addressed) but two
   page rows citing it.
6. OCR writes text and the token becomes findable in `page_fts`.
7. A stale-generation OCR result is **discarded** — assert the row is unchanged.
8. A page whose OCR fails leaves `ocr_status='failed'` and the job ends `partial`.
9. Extraction fills an empty vendor but does **not** overwrite a pinned one.
10. Cancelling mid-import stops further pages and the job ends `cancelled`.
11. vCard import creates a contact item with parsed name and email.

## Report
`DONE | OPEN | BLOCKED` / FILES / TESTS / DECISIONS / BLOCKERS. Real numbers.
