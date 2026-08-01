# Lane R — Repo: complete sorting + thumbnails in GridRow

**Executor:** grok · **Depends on:** Lane 0 contract (on disk)

## You own
```
src/db/repo/**  (items.ts buildOrder + list query; tests)
```
Do NOT touch src/shared/**, src/ui/**, src/ingest/**, src/scan/**, package.json.

## The user-visible bugs you are fixing
1. "Sorting works but the categories not." Category IS mapped, but SQLite sorts
   NULLs FIRST ascending — 7 of 12 test receipts have no category, so the sorted
   view leads with a wall of blanks and reads as a no-op. Payment and Tax are not
   mapped at all, so those headers are genuinely dead.
2. The Thumbnail view (Lane T, parallel) needs a thumbnail per row; GridRow has
   no image reference.

## Deliverables
### 1. buildOrder — complete, safe, NULLs-last
- Whitelist map for EVERY sortable column:
  txnDate→r.txn_date, vendorName→v.name COLLATE NOCASE,
  categoryName→c.name COLLATE NOCASE, paymentTypeName→pt.name COLLATE NOCASE,
  taxTotalMinor→r.tax_total_minor, totalMinor→r.total_minor,
  reviewed→i.reviewed_at, type→i.type.
- NULLs last in BOTH directions: `CASE WHEN <col> IS NULL THEN 1 ELSE 0 END`
  leads each key.
- Stable tiebreak `i.id ASC` always appended.
- Unknown column keys are IGNORED (never interpolated) — the whitelist is the
  SQL-injection guard; add a test proving a hostile key like
  `"1; DROP TABLE item"` is a no-op.

### 2. GridRow.thumbRelPath (contract field already added)
- First page by seq: `(SELECT COALESCE(p.thumb_relpath, p.file_relpath) FROM page p
  WHERE p.item_id = i.id ORDER BY p.seq LIMIT 1)` — inline in the SAME rows
  statement. The bounded-query test (≤6) must still pass; this adds zero
  statements.
- Split children: resolve through the citation the same way v_item_pages does —
  a child must show its origin's thumbnail, not blank. If that requires the
  subselect to consult split_group, do it in SQL, still zero extra statements.

### 3. Filter totals consistency
- Verify `computeFilterTotals`/`buildSummableWhere` behave under
  smartFilter='needsReview' and 'unreviewed': the money totals shown must be for
  the FILTERED set, not the whole library. Fix + test if not.

## Tests (extend src/db/repo/__tests__/)
1. Sort by categoryName asc: non-null categories in NOCASE order FIRST, all
   null-category rows after, stable by id. Same desc.
2. paymentTypeName and taxTotalMinor sort both directions.
3. Hostile sort key ignored (row order = default), no throw.
4. thumbRelPath populated for an item with pages; null for a manually created
   item; a SPLIT CHILD returns its origin's thumb.
5. Bounded query count still ≤6 at 5,000 rows.
6. Totals under needsReview cover only flagged items.

## Report
DONE|OPEN|BLOCKED / FILES / TESTS / DECISIONS / BLOCKERS
