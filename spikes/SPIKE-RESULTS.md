# KeepR — Phase 0 spike results

Run on the dev Mac (Apple Silicon), 2026-07-30, before Lane 0 was finalized.
Purpose: retire the highest risks in `PLAN.md` §8 before any executor starts.
Reproduce with `node spikes/<file>.mjs`.

## Verified

| Claim | Result |
|---|---|
| `better-sqlite3` installs and loads on Apple Silicon | PASS — 316 packages, 22s, no build failures |
| SQLite version | 3.49.2 |
| FTS5 compiled in | PASS — `ENABLE_FTS5` present in `pragma_compile_options` |
| External-content FTS5 table + sync triggers | PASS |
| FTS finds a word present **only** in OCR text | PASS — acceptance criterion 6 is achievable as designed |
| Update trigger removes stale terms | PASS — verified with a term absent from the replacement text (see note) |
| Delete trigger removes the row from the index | PASS |
| `page_fts('integrity-check')` | PASS |
| `sharp` loads and processes | PASS — 600x900 PNG |
| Cores available for the worker pool | 14 → pool size 13 |

**Note on the update-trigger test.** The first attempt was invalid: the
replacement text still contained the search term, so a passing count of 1 proved
nothing. Re-tested in `fts5-trigger-correctness.mjs` with a term that appears
only in the pre-update text — stale term drops to 0, new term appears. Believe
that file, not the first spike.

## Money representation — decided here

Store money as **integer minor units** (cents), never float. `84.37` is `8437`.
Floats will silently misreport totals in an expense report, which is the one
thing this application cannot do.

Split remainder uses **largest-remainder distribution**: `$100.00 / 3` →
`3334, 3333, 3333` cents, which sums back to exactly `10000`. Verified in
`fts5-sharp-money.mjs`. The rule for Lane I: *the split parts must always sum to
the original total, with the remainder cents distributed to the earliest parts.*
This is asserted as a test, not left to an executor's judgement.

## Still unproven — do not assume these

- `better-sqlite3` under the **Electron** ABI (spike used plain node v24). Needs
  `electron-rebuild` and must be checked on **the Windows build machine**, not just here.
- Windows NSIS packaging on the Windows build machine (node not yet installed there).
- Tesseract accuracy on real thermal receipts — deliberately untested; the
  `OcrProvider` seam exists so this can be swapped without rework.
