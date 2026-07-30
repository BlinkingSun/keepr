# Lane A — Database repositories + rules engine

**Executor:** grok · **Wave:** 2 (parallel with Lane B) · **Depends on:** Lane 0

## You own exactly these paths

```
src/db/repo/**
src/rules/**
```

**You may READ** `src/shared/types.ts`, `src/shared/ipc.ts`,
`src/db/schema/001_initial.sql`, `PLAN.md`.

**You may NOT touch** `src/shared/**`, `src/db/schema/**`, `src/main/**`,
`src/preload/**`, `src/api/**`, `src/ui/**`, `package.json`, `tsconfig.json`,
`vite.config.*`, or anything under `spikes/`. Another lane owns each of those and
parallel edits will collide. If you believe you need a change in one of them,
stop and report it as a BLOCKER instead of editing.

## Goal

The data-access layer every other lane calls. No SQL outside this lane (except
the schema itself and Lane H's search queries). No lane opens its own database
connection — you receive one.

## Non-negotiable invariants

These come from a three-cycle audit. Violating one is a rejected deliverable, not
a style note.

1. **Money is `MinorUnits` (integer cents) end to end.** Never a float, never a
   formatted string. Parse user input to minor units at the boundary and validate.
2. **Never `SUM` from `receipt_data` or `item`.** Read totals ONLY from
   `v_summable_receipts`, tax ONLY from `v_summable_tax`, per-folder figures ONLY
   from `v_folder_totals`. A naive sum double-counts split receipts — the schema
   test proves it returns 20000 where the truth is 10000.
3. **Totals are always per-currency.** `v_folder_totals` groups by currency;
   preserve that shape all the way out. Never collapse currencies into one number.
4. **One connection, owned by main.** Accept a `Database` instance in your
   constructor. Do not call `new Database(...)` anywhere in this lane.
5. **Every multi-statement mutation runs in ONE transaction.** Use
   `db.transaction(...)`. A split or a combine that half-applies is corruption.
6. **`item_search_src` is maintained by database triggers.** Do NOT write to it.
   Do not "helpfully" keep it in sync — you will double-fire the FTS triggers.
7. **Respect pinned fields.** `receipt_data.extraction_json` marks fields the user
   corrected. Re-OCR and rule application must never overwrite a pinned field
   unless explicitly forced.
8. **Soft delete is `trashed_at`.** Items are never moved into the trash folder;
   a trigger blocks it. Default reads exclude `trashed_at IS NOT NULL`.

## Deliverables

### `src/db/repo/index.ts`
A `Repositories` factory taking `{ db, fileStore }` and returning the repos below.
Export types; no side effects at import time.

### `src/db/repo/folders.ts`
`list()` (tree-ordered), `create`, `update`, `delete` (RESTRICT if non-empty —
return a reason, do not throw a raw SQLite error), `pathOf(id)`,
`descendantIds(id)` for `includeSubfolders` queries.

### `src/db/repo/items.ts`
- `list(req: ListRequest): ListResponse` — returns `GridRow[]` plus `FilterTotals`.
  Must be a bounded number of queries regardless of row count: **no N+1**. The
  grid renders 10,000 rows and calls this; resolve vendor/category/payment names
  by join, not per row.
- `detail(id): ItemDetail` — pages come from `v_item_pages` so a split child
  yields its origin's image.
- `create`, `patch(id, patch: ItemPatch): PatchResult`, `bulk(op, ids)`,
  `trash`, `restore`.
- `patch` parses strings to typed values, returns per-field errors rather than
  throwing, and auto-creates newly typed list values (§1), reporting them in
  `createdListValues`.
- `GridRow.lowConfidenceFields` from `extraction_json` (threshold 0.75) and
  `missingFields` from the key fields in `v_missing_key_data`.

### `src/db/repo/pages.ts`
`listForItem` (via `v_item_pages`), `add`, `reorder` (rewrite `seq` densely in one
transaction), `setRotation`, `delete`, `setOcrResult`.

`setOcrResult` **must** drop results whose `generation` no longer matches the row's
`ocr_generation` — a slow OCR job finishing after the user edited a field must not
clobber the edit. Return `{ applied: boolean, reason?: string }`.

### `src/db/repo/lists.ts`
For vendor/category/tax_category/payment_type/project: `all()`,
`upsertByName(name)` returning `{ id, created }`. Vendor upsert computes
`normalized_name` (lowercase, strip punctuation and extra whitespace) and matches
on it before creating, so "Home Depot", "HOME DEPOT" and "Home Depot." are one
vendor rather than three.

### `src/db/repo/customFields.ts`
Definition CRUD and per-item value get/set.

### `src/rules/engine.ts`
```ts
applyRules(input: RuleInput): RuleOutcome
```
Pure and synchronous — no DB access inside; receives the rules and the candidate
values, returns proposed field values with the rule id that produced each.

- Phase 1 rule kind: `vendor_to_category`.
- Order by `priority` ascending, first match wins, ties broken by lower id for
  determinism.
- Falls back to `vendor.default_category_id` when no rule matches.
- **Never proposes a value for a pinned field.**
- Increment `hit_count` in the caller, not the pure function.

### `src/rules/seed.ts`
Seed data: a starter vendor list with sensible default categories, standard
expense categories, common payment types, and a tax-category list oriented toward
deductibility. Mark all as `is_seed = 1`. Keep it genuinely useful but modest —
roughly 60–120 vendors, not a scraped dump.

## Tests — `src/db/repo/__tests__/`

Use `node --experimental-strip-types` with `node:test` and `node:assert`. Build
each fixture against an in-memory database created by executing
`src/db/schema/001_initial.sql`. Read `spikes/schema-verify.ts` first; it shows
the intended patterns and the invariants already proven at schema level.

Required:

1. `list()` totals for a folder containing a split receipt equal the original
   amount, **not** double.
2. `list()` on a mixed-currency folder returns one entry per currency and never a
   blended figure.
3. `list()` issues a bounded query count for 5,000 seeded items — assert the
   count, do not eyeball it.
4. `patch` with `"84.37"` stores `8437`; with `"abc"` returns a field error and
   writes nothing.
5. `patch` on a new vendor name creates the vendor and reports it in
   `createdListValues`.
6. Vendor normalization: three spellings resolve to one vendor id.
7. `setOcrResult` with a stale generation returns `applied: false` and leaves the
   row untouched.
8. Re-applying rules does not overwrite a pinned field; does fill an empty one.
9. `reorder` produces dense sequential `seq` values with no gaps or duplicates.
10. `trash` then `restore` round-trips, and the item is absent from default
    `list()` while trashed.

## Report format

Reply with exactly:
```
DONE | OPEN | BLOCKED
FILES: <paths you created or modified>
TESTS: <command to run> -> <pass/fail counts>
DECISIONS: <any judgement calls you made>
BLOCKERS: <anything you needed but could not touch>
```

Do not report DONE unless your tests actually run and pass. State real numbers.
