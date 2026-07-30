Auditing Wave 2 against the specs and the defects you flagged. Inspecting the diff and source now.## VERDICT: **rework**

Wave 2 is largely competent against the specs (totals views for status bar, no `item_search_src` writes, one Tesseract scheduler, offline paths, integer money at boundaries, real transactions, reorder two-phase works, tests green). It is **not** shippable as-is because **default `list()` still surfaces the superseded split origin with its full `total_minor` beside the children**, so the grid’s visible money sums to **20000** while the status-bar totals correctly say **10000**. That is the double-count bug returning as a product surface, not as SQL `SUM(receipt_data)`.

---

## SPEC_DEVIATIONS

| Area | Spec | Code | Better/worse |
|---|---|---|---|
| Totals source | Only `v_summable_*` / `v_folder_totals` | Filter totals use `v_summable_receipts` (+ `GROUP BY currency`). **Does not** query `v_folder_totals` or `v_summable_tax` (uses `SUM(sr.tax_total_minor)` on the money view). Comment claims tax views. | **OK / slightly worse** — money double-count in totals is avoided; tax path is equivalent only if `tax_total_minor` stays in sync with lines. Prefer `v_summable_tax` or keep both equal. |
| Grid rows | Implied summable truth for money UX | `list()` joins raw `receipt_data` and does **not** exclude `superseded_at`. Split folder shows **origin + 3 children**; row totals sum to **2×**. | **Worse — defect** |
| Query bound | Bounded queries, join names | ~4 prepare statements; names joined. `has_images` is a **correlated** `EXISTS (v_item_pages)` per row (one statement, O(n) work). | **Meets letter, weak on spirit** |
| `item_search_src` | Triggers only | No app writes (only schema triggers). | **Correct** |
| Money | Integer minor end-to-end | `parseMoneyText` / OCR `parseMoney` use digit→integer; no float storage. Intermediate `Number(major)` on digit strings is safe for normal amounts. | **Correct** |
| Pinning | Respect pinned; re-OCR/rules | `patch` sets `pinned: true`, `confidence: 1` for edited extractable fields. Rules pure engine skips `pinnedFields`. **No** repo path that re-applies extraction into receipt fields. | **OK for A**; OCR→fields wiring is later. Pin-at-1 on edit is coherent. |
| Reorder | Dense seq in one txn | Two-phase `+1_000_000` then `1..n` in `db.transaction`. Full reverse tested. | **Correct** (offset must stay > any real seq; fine for Phase 1). |
| Transactions | Multi-statement in txn | `patch`, `bulk`, `reorder`, create path use `db.transaction`. Single-statement trash/restore/add OK. | **Correct** |
| Tesseract | One scheduler; not nested in sharp pool | One scheduler per provider; PDF raster via image pool **then** recognize on buffer — sequential, not nested. | **Correct** |
| Offline | No CDN | `paths.ts` local worker/core/tessdata; `gzip: false`, `cacheMethod: 'readOnly'`. | **Correct** |
| Geometry | Metadata-only rotation | `PagesRepo.setRotation` only updates DB. **`imagePool.rotate` bakes pixels** (and test documents that). | **Split API**: metadata path OK; bake path is a footgun if G/I call it for “rotate” without invalidating OCR. |
| Tax view | `v_summable_tax` | Not used in repo. | Mild deviation |
| Fixtures | ≥12 synthetic covering listed shapes | 12 clean labelled texts; 12/12 on parser. | Spec allows synthetic; **not hard OCR**. |

---

## DEFECTS

Ordered by severity.

### 1. **HIGH — Grid double-counts split money (status bar does not)**

**Where:** `src/db/repo/items.ts` `list()` / `buildWhere` — filters trash, not `superseded_at`.  
**Repro (measured):** after `seedSplitReceipt`, `list({ folderId })` returns **4 rows** with totals `10000 + 3334 + 3333 + 3333 = 20000`; `totals.byCurrency[0].totalMinor === 10000`.  
**Failure:** User selects “all”, sees four amounts that sum to 2×, or multi-selects and any future “sum selection from rows” will lie. Status bar alone is not enough.  
**Fix:** Default list exclude `i.superseded_at IS NOT NULL`, **or** force `totalMinor`/`taxTotalMinor` null (or zero) and a clear `isSuperseded` flag for origin shells. Tests must assert row-money sum ≤ canonical total.

### 2. **MEDIUM — Bare integer OCR money heuristic will misread real totals**

**Where:** `src/ocr/parse/money.ts` L169–178.  
**Behavior (probed):** `'100' → 100` minor ($1.00) conf **0.55**; `'25' → 2500` ($25.00) conf **0.4**. Confidence is **higher** for the cents interpretation of 3+ digit bare integers, so it **wins** over weaker dollar guesses in multi-token scan.  
**Real receipt:** `TOTAL 100` / `TOTAL 1000` without decimals → $1.00 / $10.00.  
**Mitigation:** conf 0.55 &lt; grid threshold 0.75 → amber, not silent high-trust. Still a wrong **value** if user bulk-accepts Inbox.  
**Read:** Acceptable only as “low-confidence guess” with Inbox review; **not** as 12/12 proof of field quality. Prefer: labelled TOTAL without decimal → **major units** at moderate conf, or omit if no decimal and no currency symbol.

### 3. **MEDIUM — PDF raster = pure-JS canvas stub**

**Where:** `src/workers/imagePool.ts` (~L296+).  
**Failure:** Vector/text PDFs and complex draws will raster blank/garbage → OCR empty → extraction fails. Image-only / simple PDFs may limp.  
**Phase 1:** Not a full stop if import is mostly photos + simple “Print to PDF” scans, but **acceptance “10-page PDF every page OCR’d” is at risk**. Not a silent money bug; it’s a capability gap. Prefer `@napi-rs/canvas` / proper canvas later; flag for C/L integration.

### 4. **LOW–MEDIUM — `imagePool.rotate` bakes rotation into pixels**

Geometry invariant is metadata-only on `page.rotation`. Bake API exists and is tested as bake. If UI “rotate” rewrites the file **and** sets `rotation` metadata without re-OCR / generation bump, bboxes and PDF text layer misalign.  
**OK if** only used for one-shot “normalize master + invalidateOcr”; **defect if** dual-applied.

### 5. **LOW — Correlated `EXISTS` for `has_images`**

Not statement N+1; still scales poorly at 10k. Prefer `LEFT JOIN (SELECT DISTINCT item_id …) img` or denormalized flag maintained carefully.

### 6. **LOW — Hand-rolled `better-sqlite3.d.ts`**

Signatures used (`prepare/run/get/all/transaction/exec/pragma`) match usage. Omits many real APIs; **does not appear to hide a runtime bug** in current code. Risk: future call typed green, wrong at runtime. Prefer `@types/better-sqlite3` when package policy allows.

### 7. **LOW — Pinning only on `patch`, not on empty-field OCR apply**

No `applyExtraction` in Lane A; when main lands it, must re-read `extraction_json.pinned`. Not a Wave 2 failure by itself.

**Not defects (checked):**  
- No app writes to `item_search_src`.  
- Filter totals do not `SUM(receipt_data)`.  
- Single Tesseract scheduler (test asserts once / 20 concurrent).  
- Offline path resolution solid.  
- Word map uses Tesseract image coords as master (no display rotate applied in mapper).  
- `reorder` full reverse collision-safe in txn.  
- Multi-statement mutations in transactions.

---

## TEST_QUALITY

| Test | Assessment |
|---|---|
| A1 split totals | **Good** for status-bar path; **misses** grid row double-count (would still pass today). |
| A2 mixed currency | Good shape check. |
| A3 query count ≤20 | **Weak** — real budget is ~4; 20 allows soft N+1; does not detect correlated subquery cost. |
| A4–A7, A9–A10 | Solid, match required cases; A9 reverse reorder is real. |
| A8 rules pinned | Unit-tests pure engine only — **does not** exercise `patch` → pin → rules re-apply via DB. |
| B corpus 12/12 | **Easy corpus:** clean labels, clear `TOTAL`, vendor lists in hints, almost no line-wrap noise, no multi-column thermal chaos. Spec asked synthetic covering *shapes* — they did that; **12/12 is not evidence of hard OCR**. |
| B money table | Documents `'100'→100` as intentional; does not assert confidence vs amber UX. |
| B scheduler once | Good OOM guard (mocked tess). |
| B network | Good path + mock createWorker options checks; not a full “no DNS” integration under Electron. |
| B cancel | Reasonable; notes WASM may still finish. |
| B imagePool rotate | Explicitly tests bake — documents the geometry footgun rather than forbidding it. |

---

## Answers to the 14 hunts (short)

1. **SUM:** Only on `v_summable_receipts` for filter totals. Grid reads `receipt_data` per row (not SUM) but still double-displays.  
2. **N+1:** ~4 statements; not classic N+1; correlated `EXISTS` is the cost issue. Cap test is soft.  
3. **`item_search_src`:** No writes in repo.  
4. **Float money:** Not stored; parse uses integer composition.  
5. **Pin:** User edit → pin + conf 1; rules respect `pinnedFields`. Coherent for A.  
6. **Reorder:** Two-phase; reverse safe.  
7. **Txn:** Multi-statement paths use `db.transaction`.  
8. **Shim:** Thin but consistent with usage; low lie risk.  
9. **One scheduler:** Yes; not nested inside sharp pool.  
10. **Network:** Paths local; options discourage CDN; good.  
11. **Bboxes:** Mapped from OCR image space; metadata rotation separate; **pool.rotate bakes** if used.  
12. **`100` vs `25`:** Conf ordering favors cents for 3+ digits — **risky on round totals without decimals**; low conf helps only if users review.  
13. **Fixtures:** Clean synthetic, not messy thermal; 12/12 is expected, not impressive.  
14. **PDF stub:** Weak on real vector PDFs; **risk to acceptance #1 PDF leg**, not a money integrity blocker.

---

## REWORK (minimum)

1. **`list()` must not present superseded origins as full-value summable rows** — exclude `superseded_at IS NOT NULL` from default grid **or** null out money fields and mark shell. Add test: after split, `sum(rows.totalMinor) === originTotal` (or origin absent).  
2. **Tighten list query test** to `n ≤ 6` (or exact 4) and optionally assert no per-row prepare.  
3. **Bare-integer OCR:** for labelled TOTAL lines without decimal, prefer major units or omit; keep cents-only for ambiguous bare tokens with conf ≤0.5. Add a fixture `TOTAL 100` → 10000 or omitted, not 100.  
4. **Document / gate PDF raster:** either accept Phase 1 limitation in SPEC + integration risk, or add a real canvas backend before claiming 10-page PDF OCR.  
5. **Contract for rotate:** only `setRotation` for display; bake only with `invalidateOcr` + generation bump (comment + assert in pool callers when they land).

Items 1–2 are the accept/rework line. 3–5 can be follow-ups but 1 is mandatory.

---

**Bottom line:** Accept the architecture and most of A/B. **Reject ship until grid list cannot double-show split money.** Status-bar correctness is necessary and present; it is not sufficient.
