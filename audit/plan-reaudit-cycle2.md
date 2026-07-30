Reading the revised schema, verify suite, shared types, and plan to pressure-test the six blockers and legal workflows.Running the verify suite and adversarial workflow walks against the new triggers.## CLOSED

All six named blockers are **substantially** closed in code. Evidence:

| # | Blocker | Evidence |
|---|---|---|
| **1** | Double-count by transition rules | Biconditional CHECK `001_initial.sql` L145–147; `item_split_no_unwind` L531–543; `item_split_child_no_promote` L546–552. Verify: clear-origin / null-superseded / demote-origin **rejected** with `un-supersede` fragment (`schema-verify.ts` L102–114). Happy path still sums **10000** after attacks. |
| **2** | Tax split contract | `v_summable_tax` L645–649; children get `tax_total_minor` + `receipt_tax_line` in verify L84–88; tax before/after **825** L67, L92; `v_split_reconciliation` tax_drift **0** L97–98; `allocate()` imported from `types.ts` L16, L73–76. |
| **3** | Origin purge / citation | `item_split_origin_purge_guard` L557–565; `page_cited_delete_guard` L569–582; `v_item_pages` honours `origin_page_id` L505–515. Verify L118–126. Adversarial: children-first empty-trash **works**; origin-first **blocked** with readable message; uncited page deletable, cited page not. |
| **4** | Merge × split | `item_no_split_of_active_merge` L587–593; `merge_no_combine_of_split` L598–603; defence `merge_no_separate_after_split` L608–613. Verify L128–154 both directions. |
| **5** | Hardened verify | Real `allocate` import; reason-checked `rejects()`; 47 paths cover clear-origin, tax, merge×split, purge, citation, FTS∩trash via `v_searchable_pages`, currency, ISS triggers. **All passed** on disk. |
| **6** | Accent | `PLAN.md` L29 TEAL; open-item closed L257; `design/DESIGN.md` L19 matches. |

Also closed from NEW_ISSUES cycle 1: single trash model (`item_no_trash_folder_*` L618–627), `ocr_conf` CHECK, currency GLOB, ISS trigger maintenance + vendor rename, negative totals + `allocate` sign handling (`types.ts` L77–84).

Legal happy paths **work**: 3-way split (sum/tax/recon clean), combine (pages reassigned + merge journal), separate (pages restored, merge_group deleted), empty-trash if **children hard-deleted before origin**.

---

## STILL_OPEN

Blocker **1 is not fully closed** against a realistic multi-step sequence. The other five are closed for the attacks they named; residual holes below are smaller or new.

### 1. Soft-trash → unwind origin → restore children = **20000 again**

`item_split_no_unwind` only cares about children with `trashed_at IS NULL` (L536–540).

Reproduced:

1. Split $100 → origin superseded + 3 children.  
2. Soft-trash all children.  
3. `UPDATE` origin clear flags — **ALLOWED**.  
4. Restore children (`trashed_at = NULL`).  
5. `v_summable_receipts` sum = **20000**.

Acceptance #10 (restore) makes this a product path, not a lab toy. Soft-trash is the normal delete; restore is first-class. **Same double-count class as cycle 1**, one extra step.

**Fix direction:** treat any child row (including trashed) as blocking unwind, same as purge guard — or forbid clearing origin flags whenever `EXISTS (child in group)` regardless of `trashed_at`. Unwind only after children are **hard-deleted**.

### 2. Child may detach freely (no transition guard)

```sql
UPDATE item SET split_group_id=NULL, split_role=NULL WHERE id = <child>;
```

**Allowed.** Not always a double-count (origin stays superseded), but:

- breaks citation/`via_split` for that child  
- if all children detach, origin stays non-summable with full historical total → **money vanishes** from books unless someone re-activates origin  
- partial detach + edit amounts can desync `v_split_reconciliation` with no hard stop  

No mirror of `item_split_no_unwind` for children.

### 3. Currency mismatch on **INSERT** still open

`receipt_split_currency_guard` is `BEFORE UPDATE OF currency` only (L630–636).  
**INSERT** of child `receipt_data` with `EUR` while group is `USD` succeeds; `currency_mismatch_count = 1`. Repo “assert recon before commit” is process again.

### 4. Dual `origin` in one group

`item_split_child_no_promote` only blocks `child → origin` **without** `superseded_at`.  
`child → origin` **with** `superseded_at` is **allowed** → two `split_role='origin'` rows on one `split_group_id`. Weird, mostly non-summable, but pollutes purge/citation semantics.

### 5. Tax / negative (acceptable residual)

Removing `total_minor >= 0` is sound for refunds.  
`receipt_tax_line.amount_minor` has **no** sign discipline (rate_bp ≥ 0 only). Fine if tax can be negative on credits; not tested as invariant.

### 6. `v_split_reconciliation` after soft-trash one child shows **drift**

By design (live children only). Mid empty-trash / partial trash, recon is non-zero. Safe if only checked at commit of split/edit, not as a continuous “library healthy” signal — document in Lane A/I SPEC.

---

## NEW_ISSUES

### Triggers / workflows

| Issue | Severity |
|---|---|
| **no_unwind ignores trashed children** → restore attack (above) | **High** — reopens double-count |
| **No child-detach / child-clear guard** | Medium |
| **Currency guard UPDATE-only** | Medium |
| **Promote-to-origin-with-supersede allowed** | Low–medium |
| **Purge requires hard-delete of soft-trashed children first** | By design; empty-trash **must** order children→origin. IPC has `maint:emptyTrash` — implement that order or purge fails with a clear error (good message). |
| **`page_cited_delete_guard` when `origin_page_id IS NULL` and multi-page** | Only blocks delete when **last** page (`COUNT = 1`). Correct: can delete extra pages until one remains. Good. |
| **ISS upserts** | Receipt path only sets `vendor`/`description` — does **not** null other columns. Good for multi-type. |
| **No `DELETE` trigger on receipt_data/document_data/contact_data** | Deleting `receipt_data` leaves **stale** `item_search_src` (reproduced: description still `"gone"`). Rare if rows only die with `item` CASCADE; bad if type conversion deletes side table. |
| **Vendor rename → ISS UPDATE → item_fts_au** | Chains correctly; no recursion loop observed. |
| **Trigger recursion** | No self-updating item triggers cascading. ISS → item_fts only. Fine. |
| **Legal split order** | `insert split_group` → `update origin` → `insert children` — **possible**. Marking origin before children exist is allowed (no_unwind only when children exist). Mid-flight origin is non-summable with no children → temporary **under-count** until children land; must be one transaction + recon assert (already planned). |
| **Legal combine** | Page reassign + `merge_group` insert — **possible**. Guard only blocks combine **into** an item that already has `split_group_id`. |
| **Legal separate** | Restore pages + `DELETE merge_group` — **possible** if result not split. |
| **ON CONFLICT(id)** on `item_search_src` | Correct for PK upsert; does not wipe unrelated columns. |

### Negatives

- `allocate(-10000, 3)` sums to −10000 — OK.  
- Status bar / folder totals sum negatives into net — correct for refunds; UI should show sign (Lane F/E).  
- Does **not** break CHECK/triggers.  
- Naive “all money ≥ 0” tests elsewhere would break — none left in schema-verify.

### Verify still not covering

- Restore-after-unwind attack  
- Child detach  
- Currency **INSERT** mismatch  
- Dual origin  
- Stale ISS after receipt_data delete  
- Empty-trash ordered success path as a first-class test (only purge-reject is tested)

---

## BLOCKING_WORKFLOW_CHECK

| Operation | Still possible? | Notes |
|---|---|---|
| **Legal 3-way split** | **YES** | insert `split_group` → mark origin origin+superseded → insert 3 children with allocated money/tax. Sum 10000, tax 825, drift 0. |
| **Legal combine** | **YES** | Reassign pages onto result, insert `merge_group` + members with `snapshot_json`, soft-trash absorbed items. Not blocked. |
| **Legal separate** | **YES** | Re-home pages to pre-merge items, untrash or recreate from snapshot, `DELETE merge_group`. Blocked only if result later split (correct). |
| **Legal empty-trash** | **YES, ordered** | Soft-trash alone is not enough to purge origin. **Hard-delete every child (and any other blockers), then origin.** Origin-first fails with explicit message. Soft-trashed children still count for purge guard — empty-trash must hard-delete them, not only set `trashed_at`. |

No legitimate primary workflow is **impossible**. Empty-trash has a **mandatory order**; that is correct if documented in Lane K / `maint:emptyTrash`.

**Dangerous legal-looking workflow:** soft-trash all split children → clear origin flags → restore children → silent double-count. Must be made illegal before execute.

---

## VERDICT: **revise-again**

Not a rewrite. The six blockers are real engineering progress; verify is finally adversarial; legal split/combine/separate/empty-trash all run.

**Do not open feature lanes until this one hole is sealed:**

1. **Align `item_split_no_unwind` with purge policy:** any child in the group (including `trashed_at IS NOT NULL`) blocks clearing/detaching origin. Optionally allow unwind only when `NOT EXISTS (child)`.  
2. **Add child detach guard** (cannot clear `split_role`/`split_group_id` on a child while the group/origin still exists), or define an explicit “dissolve split” transaction.  
3. **Currency guard on INSERT** (or `BEFORE INSERT OR UPDATE` on `receipt_data` for children).  
4. **Add those three as `rejects(...)` tests** in `schema-verify.ts`, plus the restore-after-unwind scenario asserting sum stays 10000.

After that, this gate should flip to **approve-to-execute** without another full architecture pass.

I am **not** re-litigating refunds/negatives, teal, spine ownership, waves, OCR contract, or the existence of the transition-trigger approach — those landed.
