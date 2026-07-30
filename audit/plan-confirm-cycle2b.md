Confirming the four fixes against the on-disk schema and verify suite.## CONFIRMED

All four are sealed. Suite passes on disk (including the new success-path tests).

**1. Restore attack dead**  
`item_split_no_unwind` (`001_initial.sql` L560–571): `EXISTS` child with `split_role='child'` — **no** `trashed_at` filter. Message requires hard-delete to dissolve.  
Verify L207–213: soft-trash all three → unwind **rejected** (`while children exi…`) → restore children → **sum still 10000**.

**2. Child detach + dual-origin**  
`item_split_child_no_detach` L586–594: clear role, null group, or change group → abort while `split_group` exists.  
`item_split_child_no_promote` L576–580: `child → origin` unconditional.  
Verify L217–223: clear role, move group, promote-with-superseded all rejected; “only one origin” passes.

**3. Currency on INSERT**  
`receipt_split_currency_guard_ins` L675–681 (+ UPDATE guard L682–688).  
Verify L232–233: child INSERT with `EUR` vs USD group rejected for `split group currency`.

**4. Tests**  
All four covered by reason-checked `rejects()`; full run ends `schema-verify: all assertions passed`. Dissolve, ordered empty-trash, soft-trash restore, legal 2-way split success paths all PASS.

Collateral fixes you named (ISS DELETE clears stale fields; currency-scoped sum helper) also green in the suite.

---

## NOT_SEALED

None of the four. No reproducing sequence reopens those specific holes.

---

## COLLATERAL

**No legitimate user workflow is made impossible by these four broadenings** that your success tests miss.

Still possible: legal N-way split; soft-trash/restore children; hard-delete one child; edit/review/move live siblings; dissolve (hard-delete children → unwind origin); empty-trash children-then-origin; combine/separate (unchanged by these four).

What the guards intentionally force (and your dissolve test encodes): “unsplit back to the original” = hard-delete children first, then unwind — not detach-in-place. That is the correct dissolve API, not a false block.

**Not a false block from these four**, residual only: `page_cited_delete_guard` still ignores soft-trashed children, so with all children soft-trashed the origin page can still be deleted and restore loses the citation. That is an older asymmetry, not introduced by no_unwind/detach/currency/promote, and it does not make a primary path *impossible*—it is a remaining citation hole for Lane I/K if you want one more guard later. **Not grounds to hold this gate.**

---

## VERDICT: **approve-to-execute**
