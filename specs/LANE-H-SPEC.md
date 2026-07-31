# Lane H — Search

**Executor:** grok · **Wave:** 4 · **Depends on:** Lane 0, A

## You own
```
src/search/**
```
**Read** `src/db/schema/001_initial.sql` (the FTS section AND `v_searchable_pages`),
`spikes/schema-verify.ts`, `src/shared/types.ts` (`SearchQuery`, `SearchHit`,
`SearchResult`), `src/db/repo/items.ts` for the `GridRow` mapping pattern.

**Do NOT touch** anything outside `src/search/**`. No new dependencies.

## Non-negotiable
1. **Read pages through `v_searchable_pages`, never `page_fts` alone.** `page_fts`
   indexes OCR text regardless of `item.trashed_at`, so a raw MATCH surfaces
   deleted receipts. The schema test proves it: the raw index still matches a
   trashed item.
2. **Never SUM outside the canonical views.** If you return totals, use
   `v_summable_receipts` / `v_folder_tot als`. Per-currency, always.
3. **Ranking must be defined, not accidental.** BM25 scores from `page_fts` and
   `item_fts` are NOT commensurate — you cannot UNION and ORDER BY rank. Normalize
   each side, fuse explicitly, and document the formula in a comment. Collapse
   multiple page hits to one item hit.
4. **`SearchResult.truncated`** must be honest, so a capped result set is never
   presented as complete.
5. Escape FTS5 syntax in user input: a bare `"` or `*` or `AND` must not become an
   operator by accident, and must not throw.

## Deliverables
- `search(db, q: SearchQuery): SearchResult` — free text over OCR body and fields,
  plus every structured filter in `SearchQuery` (date range, amount range, vendor,
  category, tax category, project, folder + subfolders, type, reviewed).
- `missingKeyData(db, folderId?)` — via `v_missing_key_data`.
- Wildcards: trailing `*` allowed, leading rejected with a clear reason.

## Tests — `src/search/__tests__/`
1. A token present ONLY in `ocr_text` is found.
2. A trashed item's OCR token is NOT found by default, and IS with `includeTrashed`.
3. An item matching in both indexes appears **once**, not twice.
4. A multi-page item matching on two pages appears once.
5. Combined filters: date range AND amount range AND vendor narrows correctly.
6. `missing=vendor,total` returns exactly the incomplete fixtures.
7. A query of `"` or `*` or `AND OR NOT` returns a result or a clean error, never
   an exception.
8. `limit` sets `truncated: true` and the count reflects the true total.
9. Ranking: an item with the term in its vendor field outranks one with a single
   incidental OCR occurrence — assert the order.

## Report
`DONE | OPEN | BLOCKED` / FILES / TESTS / DECISIONS / BLOCKERS.
