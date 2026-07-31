# Lane I — Receipt splitting, combine, separate

**Executor:** grok (schema triggers now enforce the invariants; orchestrator verifies independently)
**Wave:** 4 · **Depends on:** Lane 0, A

## You own
```
src/splitting/**
```
**Read** `src/db/schema/001_initial.sql` — **especially the STATE-TRANSITION
GUARDS section** — `spikes/schema-verify.ts`, `src/shared/types.ts` (`allocate`,
`allocateByWeight`), `src/shared/ipc.ts` (`SplitPart`, `SplitResult`).

**Do NOT touch** anything outside `src/splitting/**`. No new dependencies.

## This is the highest-stakes lane in the application
A wrong total here is a plausible-looking number the user files with their taxes.
The schema will physically stop you from creating most illegal states — the
triggers abort with readable messages. **Do not fight them; they are correct.**

## Non-negotiable invariants
1. **Use `allocate` / `allocateByWeight` from `src/shared/types.ts`.** Do not write
   your own division. They guarantee parts sum EXACTLY to the original, remainder
   cents to the earliest parts: `10000/3 → 3334,3333,3333`.
2. **One transaction per operation.** A half-applied split is corruption.
3. **Assert before commit:** query `v_split_reconciliation` inside the transaction
   and abort if `drift_minor <> 0`, `tax_drift_minor <> 0`, or
   `currency_mismatch_count > 0`. SQLite has no deferred CHECK, so this is the
   only way to enforce the sum.
4. **Tax splits alongside money.** Allocate `tax_total_minor` and write child
   `receipt_tax_line` rows. Tax silently vanishing after a split was a real bug
   caught in audit.
5. **Children own no page rows.** They cite the origin through `v_item_pages`.
6. **Origin becomes `split_role='origin'` with `superseded_at` set** so it leaves
   `v_summable_receipts`. Children share `split_group_id` and the origin currency.
7. **Dissolve order:** hard-delete children, then unwind the origin. Detaching a
   child in place is refused by trigger, and correctly so.
8. **Combine and split are mutually exclusive** — the triggers enforce both
   directions. Separate restores from `merge_group_member.snapshot_json`.

## Deliverables
- `splitReceipt(db, itemId, parts: SplitPart[]): SplitResult` — parts may carry an
  explicit amount OR a weight, never both in one call.
- `dissolveSplit(db, splitGroupId)` — children first, then origin.
- `combineItems(db, itemIds[]): { itemId, mergeGroupId }` — reassign pages onto the
  result in order, snapshot every absorbed item, soft-trash the originals.
- `separateItem(db, itemId): { itemIds[] }` — restore from snapshots, re-home pages,
  delete the merge group.

## Tests — `src/splitting/__tests__/`
1. 3-way split of $100.00 → `[3334,3333,3333]`, `sumMinor === originTotalMinor`.
2. **Folder total is unchanged by the split** — not doubled. Query
   `v_summable_receipts`, not `receipt_data`.
3. Tax 825 splits to `[275,275,275]` and `v_summable_tax` still totals 825.
4. All children resolve the **same** `content_hash` through `v_item_pages`.
5. Weighted 60/40 of $100 → `[6000,4000]`; 1 cent across 3 weights still sums to 1.
6. A part list that does not sum to the origin is **rejected**, and the database is
   unchanged afterwards (assert the row count and the total).
7. Dissolve restores the origin to summable with its original amount.
8. Combine 3 items into one 3-page item with correct `seq`; separate restores all
   three with their **original field values** from the snapshots.
9. Splitting a combined item is refused; combining a split item is refused. Assert
   the trigger messages.
10. A concurrent second split of the same origin does not produce two split groups.

## Report
`DONE | OPEN | BLOCKED` / FILES / TESTS / DECISIONS / BLOCKERS.
Report honestly. If an invariant test fails, say so — do not weaken the test.
