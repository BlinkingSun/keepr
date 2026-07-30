Reading the revised plan, DDL, verify script, and related files for a grounded delta re-audit.Running adversarial checks against the DDL to validate the claimed invariants.## RESOLVED

Evidence is file/line, not claims in chat.

| Original finding | Evidence it is closed |
|---|---|
| Money as float / unspecified | `001_initial.sql` L11–14, L155–170: `total_minor` / `tax_total_minor` INTEGER + `CHECK (... >= 0)`. No REAL money columns. |
| Largest-remainder only in spikes | `001_initial.sql` L261–263; `schema-verify.mjs` L62–66 produces `3334+3333+3333` and asserts exact sum. (Algorithm still lives in app/tests, not SQL — but it is no longer plan-silent.) |
| Double-count via summable origin (happy path) | `item.superseded_at` + `split_role` L127–144; `v_summable_receipts` L435–443; verify L80–87 proves view 10000 vs naive 20000. |
| Split children own pages / orphan image on child delete | `v_item_pages` L449–458; verify L88–99: shared `page_id`, `via_split=1`, hard-delete child leaves page. |
| `item_search_src` undefined | Real table L371–378; `item_fts` L386–390; triggers L405–418; verify L104–110. |
| Absolute paths | `file_relpath` / `thumb_relpath` L217–221. |
| Civil date vs instant | Conventions L15–18; `txn_date` TEXT, timestamps INTEGER. |
| `tax_breakdown_json` only | `receipt_tax_line` L179–187. |
| Combine irreversible | `merge_group` / `merge_group_member` + `snapshot_json` L272–286. |
| Inbox as NULL folder | `folder.kind` L55–70 + unique partial index L70. |
| Job / partial failure | `job` L327–341 with `'partial'`. |
| Electron spine unowned | `PLAN.md` L87–95: Lane 0 owns `src/main`, preload, App, kit, state, FileStore, JobQueue, root tooling, SPECs. |
| Wave D∥A contradiction | `PLAN.md` L112–126: `0 → A∥B → panels+D skeleton → C,H,I,J,K → integrate → L`. |
| OCR double-pool / CDN / geometry | `PLAN.md` L132–160; `package.json` L34–44; `abi-check.mjs` L66–86 offline tessdata/wasm. |
| Missing `abi:check` | `scripts/abi-check.mjs` exists; `package.json` L14–15. |
| Caret pins on ABI-critical | `package.json` L19–20, L28–29 exact versions + pin note L10. |
| asarUnpack missing | `package.json` L34–41. |
| Acceptance not API-checkable / byte-identical | `PLAN.md` L178–222: endpoints + graph-integrity #9. |
| Combine/separate integrity on G | `PLAN.md` L104, L109–110 → Lane I. |
| Rules / image store / jobs unowned | Lane 0 FileStore + JobQueue; Lane A rules (`PLAN.md` L96). |
| UI accent undecided for build | `design/DESIGN.md` L19: teal approved (see NEW_ISSUES for PLAN drift). |

---

## STILL_OPEN

Harsh on claimed fixes that are incomplete.

### 1. Double-count is **not** structural — legal UPDATEs restore it

CHECKs only constrain single-row shapes at write time:

```142:144:src/db/schema/001_initial.sql
  CHECK ((split_role IS NULL AND split_group_id IS NULL) OR split_group_id IS NOT NULL),
  CHECK (split_role <> 'origin' OR superseded_at IS NOT NULL)
```

Adversarial result: after a correct split (view sum 10000), this is allowed:

```sql
UPDATE item SET split_group_id=NULL, split_role=NULL, superseded_at=NULL WHERE id = origin;
```

→ view sum becomes **20000** (origin + children). No trigger, no FK, no CHECK blocks it.

Also allowed: `split_group_id` set with `split_role` NULL (verify script’s shape is optional). Also allowed: origin marked `split_role='child'` **without** `superseded_at` → origin stays in `v_summable_receipts`.

**Claim “only way to sum is the view” is process, not DDL.** Any repo method, export, or status-bar path that uses `receipt_data` / raw `item` reopens the bug; clearing origin flags reopens it even through the view.

### 2. Tax after split is broken in the “happy” path the schema encourages

Children in verify get `total_minor` only, not `tax_total_minor` / `receipt_tax_line`. Adversarial: after split, `sum(tax_total_minor)` on `v_summable_receipts` = **0** while `receipt_tax_line` on the superseded origin still holds **825**. Live status-bar “Tax” and tax reports either lose tax or must query origin lines and double-count if they also sum children later. Plan/spike talk about tax remainder allocation; **DDL + verify do not enforce or test it.**

### 3. `v_item_pages` vs origin trash/delete

| Case | Behavior | Problem |
|---|---|---|
| Origin **soft-trashed** | Children still resolve pages (join ignores `trashed_at`) | OK for citation; trash UI of origin still shows pages (no filter) — product ambiguity |
| Origin **page rows deleted** | Children get **zero** rows from the view | Silent broken citation; no CHECK that a split_group with live children must keep ≥1 page |
| Origin **hard-deleted** | Delete **fails**: `ON DELETE SET NULL` on children’ `split_group_id` violates CHECK (`role='child'` with NULL group) | Cannot empty-trash a superseded origin while children exist; CASCADE/page cleanup deadlocks |

So “deleting a child does not orphan the image” is true; **deleting/purging the origin is either impossible or, if CHECKs were relaxed, would orphan citations.** Neither path is specified as app policy in DDL.

### 4. Merge journal does **not** support combine → split → separate

No constraint between `merge_group` and `split_group`. Adversarial: combine pages onto result, then split that result — both journals exist; children cite origin pages that separate-back wants to reassign to pre-merge items. **Separate-back after a later split is undefined and schema-legal.** Verify never touches merge tables.

### 5. `item_search_src` “fixed” only as a table, not as a maintenance system

Triggers sync `item_search_src` → `item_fts` only (`001_initial.sql` L405–418). Comment L420–423: **Lane A must maintain `item_search_src` in app code.** No triggers on `receipt_data` / `document_data` / `contact_data` / `vendor`. Forget one write path → structured search silently stale. Vendor rename is tested only when the test updates `item_search_src` by hand.

### 6. Soft-delete × FTS still open

`page_fts` indexes OCR regardless of `item.trashed_at`. Adversarial: trashed item’s OCR token still matches. Default search must filter in app; schema/verify do not. Same class of bug as original audit.

### 7. Currency / multi-currency discipline incomplete

`currency` free TEXT; no FK/check to `cabinet.base_currency`. `v_summable_receipts` has no `GROUP BY currency`. Blind `sum(total_minor)` across USD+EUR is legal and returns one number. Plan L244–245 says sums never cross currencies — **not enforced**.

### 8. CHECK circumvention summary (incomplete “structural” story)

| Sequence | Result |
|---|---|
| Clear origin split flags | Double-count via view |
| Origin as `child` without supersede | Origin remains summable |
| `split_group_id` without `split_role` | Ambiguous row; still summable |
| Negative tax line amount | **Allowed** (`receipt_tax_line.amount_minor` has no ≥0 CHECK) |
| Refunds / negative totals | Blocked on receipt_data (may be intentional) |

### 9. `schema-verify.mjs` is too weak for its marketing

| Assertion gap | Why it can pass on a broken system |
|---|---|
| Largest-remainder | Only checks `sum(parts)===total` for parts **computed inside the test**. Wrong app algorithm or `[5000,5000,0]` would not be caught by a schema test that never calls Lane I. |
| No assert on exact shape | Does not `deepEqual([3334,3333,3333])` as a required contract (only prints join). |
| No tax allocation | Tax vanishes post-split unnoticed. |
| No merge journal | Acceptance #5 untested at schema level. |
| No clear-origin attack | Double-count regression not in suite. |
| No hard-delete origin | Purge deadlock not seen. |
| No FTS∩trash | Trashed OCR still searchable. |
| No mixed currency | Blind sum OK. |
| No `item_search_src` auto-path | Only tests manual updates. |
| FTS integrity-check | Passes on empty/healthy indexes; does not prove trigger coverage of all write paths. |

“24 assertions, all passing” is true and still compatible with several integrity failures.

### 10. Wave order — mostly fixed; residual hazards

| Item | Status |
|---|---|
| D∥A | Fixed |
| C after B | Fixed (`PLAN.md` L98, L124) |
| Panels don’t touch App | Fixed by rule; **not mechanically enforced** |
| B owns `src/workers/**` but main owns Scheduler/pool | Wiring still **orchestrator integrate** — OK if SPECs freeze ports; hidden if B invents main hooks |
| D skeleton in wave 3 needs A | A finished wave 2 — OK |
| `package.json` / schema only Lane 0 | Stated — OK |

No second hard wave/dep **lie** like v1. Residual risk is process, not a contradictory table.

### 11. Native/OCR claims mostly closed; still thin

- `abi-check` does **not** run an actual offline `recognize()` — only “wasm + eng.traineddata exist”.
- No worker_threads smoke that loads `sharp` under Electron.
- No `postinstall`/`setup:native` rebuild hook (only a `rebuild` script).
- `files: ["dist/**", "package.json"]` relies on electron-builder’s dependency packing defaults — workable but easy to break if someone “tightens” files later.

### 12. Accent: PLAN vs DESIGN conflict

- `design/DESIGN.md` L19: **TEAL approved**.
- `PLAN.md` L29, L236: accent still “pending comparison”.

Executors reading PLAN will treat accent as open.

---

## NEW_ISSUES

Defects introduced or locked in by the revision.

1. **Origin hard-delete / empty-trash deadlock** with live children (`ON DELETE SET NULL` + CHECK). Superseded shells may be undeletable forever without a defined child-repoint or “delete group” transaction.

2. **`v_item_pages` ignores `origin_page_id`** — always all pages of `origin_item_id`. Fine for multi-page, but the column is misleading and unused by the view; partial page delete yields empty citation with no invariant.

3. **Dual trash models**: `folder.kind='trash'` and `item.trashed_at` with no rule that they move together. Count badges and “Trash” nav can diverge.

4. **`vendor` forward-FK to `category`** works in SQLite but is fragile for tools that validate schema order; already special-cased in verify L42–43.

5. **Circular `item` ↔ `split_group` FKs** require a specific insert/update order; fine, but cascade semantics interact badly with CHECKs (see deadlock).

6. **`receipt_tax_line` without ≥0 / without summable view** — tax integrity weaker than money on `receipt_data`.

7. **Confidence as `ocr_conf REAL` on page + JSON provenance** — fine, but no CHECK 0..1; minor.

8. **PLAN L29 vs DESIGN teal** — process defect that will fork UI lanes.

9. **Status bar “Tax” has no canonical tax view** analogous to `v_summable_receipts` — only money total is gated.

10. **Verify script’s “naive sum 20000”** hard-codes full origin+children and will **fail** if origin `receipt_data` is zeroed on split (an alternate valid lifecycle). It freezes one lifecycle (supersede + keep origin amounts) without stating it as the only allowed one in a migration-safe way.

---

## Attention answers (direct)

**Is `v_summable_receipts` sufficient?**  
Necessary, not sufficient. Any path that (a) sums `receipt_data`, (b) sums `receipt_tax_line` without the same predicates, (c) sums a multi-select that includes superseded rows loaded for UI, or (d) runs after origin flags are cleared, reintroduces double-count. Enforce with: repo-only API, SQL triggers that forbid illegal split-state transitions, and/or a `BEFORE UPDATE` trigger on `item` that prevents clearing `superseded_at` while sibling children exist.

**`v_item_pages` if origin trashed / page deleted?**  
Trashed origin: citations still work. Pages deleted: children get nothing. Origin hard-delete: blocked by CHECK interaction — untested in verify.

**CHECK circumvention?**  
Yes — clear origin markers; origin-as-child; group without role. Insert-time origin-without-supersede is blocked; **update-time unwind is not**.

**Merge then split then separate?**  
Schema allows combine+split simultaneously; separate-back is not defined against live split children. Not supported; not tested.

**Verify too weak?**  
Yes — see §9 above. Passing verify ≠ money/tax/search/trash integrity under adversarial sequences.

**Hidden wave violation?**  
No v1-style contradiction. Watch B workers vs main supervisor ownership and “libraries must not touch api/main” as social rules only.

---

## VERDICT: revise-again

Most of the audit surface area is genuinely addressed (DDL exists, views, FTS table, spine ownership, waves, OCR/native contracts, acceptance rewrite). **Do not open feature lanes yet.**

Blockers for cycle 2 (minimum):

1. **Close double-count by transition rules**, not comments — e.g. triggers forbidding clearing `superseded_at` / `split_role` while other live children share `split_group_id`; forbid `split_group_id` without role; optional forbid origin money staying non-null if you choose “zero origin” lifecycle (pick one lifecycle and test both view and naive sum).  
2. **Tax split contract** + summable tax path (or allocate tax_minor/lines onto children in verify).  
3. **Origin purge / empty-trash policy** that does not CHECK-deadlock and does not orphan `v_item_pages`.  
4. **Merge vs split exclusivity or ordered state machine** (block split of an active merge result until separate, or block separate after split, with tests).  
5. **Harden `schema-verify.mjs`** with the adversarial cases above (clear-origin → still 10000; exact remainder vector; tax; trash∩FTS filter contract; hard-delete/purge; merge×split rejected or defined).  
6. **Align PLAN accent with `design/DESIGN.md` (teal).**

After those land, a second delta pass can reasonably go **approve-to-execute**.
