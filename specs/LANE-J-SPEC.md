# Lane J — Export: CSV, Excel, searchable PDF

**Executor:** grok · **Wave:** 4 · **Depends on:** Lane 0, A

## You own
```
src/export/**
```
**Read** `src/shared/types.ts` (`Word`, `BBox`, `ResolvedPage`), `src/shared/ipc.ts`
(`ExportRequest`), `src/store/fileStore.ts`, the canonical views in
`src/db/schema/001_initial.sql`. `exceljs`, `pdf-lib` and `sharp` are installed.

**Do NOT touch** anything outside `src/export/**`. No new dependencies.

## Non-negotiable
1. **Read money from `v_summable_receipts` and tax from `v_summable_tax`.** Never
   from `receipt_data`. An export that double-counts a split receipt is a document
   the user files with their taxes.
2. **Per-currency subtotals.** Never one blended figure.
3. **Money is integer minor units.** Convert for display only, at the cell. In CSV
   emit a plain decimal with no currency symbol and no thousands separator, so
   spreadsheets parse it.
4. **Searchable PDF:** the invisible text layer is placed using `Word.bbox`, which
   is in **stored-master pixel space**. Scale from image pixels to PDF points and
   apply `page.rotation` at render time. If this is wrong the text will not sit
   over the words and selection will look plausible while being useless.
5. Never write outside the destination path you are given.

## Deliverables
- `exportCsv(db, req)` — one row per item, configurable columns, correct escaping
  for commas, quotes and newlines inside fields.
- `exportXlsx(db, req)` — via exceljs: header row, one sheet per currency when more
  than one, optional embedded page thumbnails sized to fit a cell, and a category
  cross-total block.
- `exportPdf(db, req)` — via pdf-lib: page image plus an invisible text layer from
  `ocr_words_json`, optional cover page from `cabinet.profile_json`, comments, and
  configurable images per page.
- All three report progress through the job queue and return the written path.

## Tests — `src/export/__tests__/`
Write to a temp dir and **open the artifacts back up** — asserting a file exists
proves nothing.
1. CSV row count matches the query, and the summed amount column equals
   `v_summable_receipts` for the same filter.
2. A vendor containing a comma, a quote and a newline round-trips through a CSV
   parser you write in the test.
3. CSV of a folder containing a split receipt totals the ORIGIN amount, not double.
4. XLSX opens with exceljs, has the expected sheet names and header row.
5. Mixed-currency export produces one sheet per currency, never a blended total.
6. PDF: extract the text layer and assert a known OCR token is present on the
   expected page.
7. PDF text position: a word whose bbox is at a known image coordinate lands within
   a small tolerance of the expected PDF point — assert numbers.
8. An item with no pages exports without throwing.

## Report
`DONE | OPEN | BLOCKED` / FILES / TESTS / DECISIONS / BLOCKERS.
