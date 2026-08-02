I'll audit the committed Lane P/U work against the geometry, gate, merge, and import-wiring risks you flagged, then drive real API tests with fixtures.Building adversarial fixtures and running geometry/gate/merge/import probes against the real module and API.Probing `/Rotate 90` box orientation, UserUnit failure, short-receipt gate FPs, and mixed-page import next.# EXECUTION AUDIT + TEST — Batch 3

**Commit:** `ace6031` — Batch 3 ScanSnap / PDF text layer  
**Auditor did not author this code.** Live claims you already verified are not re-listed as findings.

---

## VERDICT: **pass**

No silent correctness failure on the supported path (searchable multi-line PDF → `pdf-text`, misaligned → OCR, mixed pages per-engine, generation race safe). Residual issues are **threshold tradeoffs** (short letter-page receipts force OCR; tight columns can glue tokens) and **by-design (d) limits** (structured-but-wrong geometry is not rejected). Not ship-blocking for ScanSnap-style sandwiches.

---

## Hunt results (what you could not verify)

### 1. Geometry (`itemToBox`)

| Case | Result | Evidence |
|---|---|---|
| **`/Rotate 180` / `270`** | **OK** | Accepted; all word boxes inside `ceil(viewport)` master; same `getViewport({scale:200/72})` as rasterizer |
| **`/Rotate 90`** | **OK (looks “vertical”, correctly)** | Viewport transform `[0,s,s,0,…]` maps user-horizontal runs to tall thin AABBs; raster uses the same transform so **click-to-assign stays aligned** with the stored PNG. Suite only checked in-bounds; orientation is expected. |
| **Skewed text (~30°)** | **Loose AABB, acceptable** | e.g. `TOTAL` box ~100×161 px for 14 pt type. Inflates hit target; still same space as ink. Multi-line overlap risk if lines are tight — rare on receipts. |
| **CropBox `[50 50 562 742]`** | **OK** | `HOME` at user x=100 → `bbox.x ≈ 138.9` = `(100−50)×(200/72)`. Offset handled via viewport. |
| **UserUnit ≠ 1** | **OK when content is in-page** | `userUnit: 2` + in-box text → usable layer. Off-page text on a half MediaBox looks like “no layer”. |

**No rework required for geometry on 0/90/180/270, CropBox, or UserUnit.**

---

### 2. (d) gate thresholds

**False positives (good layer → OCR fallback) — proven:**

| Fixture | Gate | Effect |
|---|---|---|
| **2-line letter** (`PARKING METER` / `TOTAL 4.00` on 612×792) | `bands < 4` (heightPx > ~833) | **REJECT** |
| **3-line letter** (Uber-style) | same | **REJECT** |
| **4-line sparse letter** | often **coverage &lt; 2%** | **REJECT** |

`isLayerUsable` direct: 2- and 3-line sparse tokens on 1700×2200 → unusable. Same 3-line on short page (heightPx 700) → **usable** (band rule gated on tall pages only).

**5-line thermal 226×400:** **ACCEPT** (enough bands).

So: real short tickets on **letter** PDFs **do not** get the text-layer fast path; they OCR. Safe, but loses the optimization.

**False negatives (bad layer accepted) — proven:**

| Fixture | Result |
|---|---|
| **Wrong quadrant** (8+ structured lines, bottom-right only) | **ACCEPT** — positions coherent, not degenerate |
| **Constant scale / systematic offset** | Accepted if bands + coverage look document-like |

(d) catches **collapsed** geometry (shared origin, zero area, &lt;4 bands on tall pages, tiny coverage). It does **not** catch “right structure, wrong place vs image.” That matches the plan’s degenerate definition, not full image/text registration.

One-line many-x: rejected by coverage (1.6%) — accidental win, not a guarantee.

---

### 3. `mergeIntoWords` (0.6 × median char width)

| Gap between `TOTAL` and `125.01` (Helvetica 12) | Result |
|---|---|
| **1 pt** | **`TOTAL125.01`** (merge) |
| **≥ 2 pt** | separate `TOTAL` + `125.01` |
| True space (~3.3 pt) | **separate** (stock glyphstream / sandwich OK) |

**Tight column:** `LUMBER` then `2X4` with ~2 pt visual gap → **`LUMBER2X4`**.

Proportional median skewed by narrow glyphs can shrink `mergeGap` and over-merge dense money columns. Inter-glyph gaps stay ~0 so reassembly of `T`+`O`+`T`+`A`+`L` still works (glyphstream fixture).

---

### 4. `splitItem` (`box.w / chars.length`)

On one-item `"TOTAL 125.01"` (true Helvetica widths):

- `TOTAL` start error: **0**
- `125.01` start error: **≈ −2.7 pt ≈ −7.4 px @ 200 DPI**

Still stored-master pixels; region assignment remains usable. Wide/narrow mixes (e.g. `W` vs `i`) can push sub-token boundaries by a few to ~10+ px inside a long run — not a coordinate-system violation, mild hit-box drift.

---

### 5. Import wiring

| Scenario | Result |
|---|---|
| **`setOcrResult` → `applied: false` (stale generation)** | Stays `pending` / null engine; OCR path can apply with current gen. **Correct.** |
| **Double-write** | Import only enqueues when `!usedTextLayer` after successful apply. Success path cannot OCR-overwrite. If both ran with same gen, last write wins — **import avoids that.** |
| **Mixed PDF** (p1 text layer, p2 no text) | **1 item**, 2 pages: `pdf-text` + `counting` (OCR mock), **1 OCR call**, fields from page 1 (`Home Depot` / `6599`). **Works.** |
| **Zero OCR units** | `extractFromStoredPages` still runs (fields not blank). Confirmed by design + your live test. |

---

### 6. Tester summary

| Test | Result |
|---|---|
| In-process `extractPdfPageText` / `isLayerUsable` probes | Above |
| In-process `importFiles` mixed / race / image-only / sandwich | Mixed + race + IO OK |
| Unit suite | **370/370 pass** |
| HTTP `POST /import` on serve | Partial (server came up; imports returned job ids; kill race left incomplete OCR text in DB). **In-process path is the reliable proof.** |

---

## DEFECTS (severity-ordered)

### D1 — MEDIUM — Short letter-page layers false-reject (`bands ≥ 4`)

**Scenario:** 2–3 line parking/Uber PDF on US Letter (or any page taller than ~300 pt @ 200 DPI) with a correct text layer.  
**Effect:** Layer refused → full tesseract; slower; may be worse than ABBYY.  
**Not:** Wrong money silently filed (OCR still runs).  
**Why:** `heightPx > 300×200/72 && max(xBands,yBands) < 4`.

### D2 — MEDIUM — Tight inter-word gaps merge (`mergeGap = 0.6 × medianChar`)

**Scenario:** Columnar receipt with ~1 pt gap between label and amount, or dense `LUMBER`/`2X4`.  
**Effect:** `TOTAL125.01` or `LUMBER2X4` tokens; money/label regexes may still work on the line string, but word bboxes and click-to-assign glue tokens.  
**Normal Helvetica word space is fine** (≥ ~2–3 pt).

### D3 — LOW — Structured misalignment not rejected

**Scenario:** Text layer with full multi-line structure in the wrong quadrant vs raster (malformed producer / bad sandwich).  
**Effect:** `pdf-text` accepted; click-to-assign misses glyphs; search still works.  
**ScanSnap-aligned sandwiches:** not expected.

### D4 — LOW — Skewed/rotated text AABB inflation

**Scenario:** 30° text runs.  
**Effect:** Loose boxes; click still hits if near the word; crowded pages may pick neighbor.

### D5 — LOW — `splitItem` proportional bias (~5–10 px)

**Scenario:** Mixed-width glyphs inside one pdfjs run split on spaces.  
**Effect:** Sub-word box edges shift slightly; schema space still correct.

---

## PLAN-3 acceptance (1–9)

| # | Criterion | Status |
|---|---|---|
| 1 | Searchable PDF → `ocr_engine='pdf-text'`, no OCR queue | **pass** (your live + unit import tests; not re-proven as finding) |
| 2 | Image-only still OCRs | **pass** (in-process: `counting`/`tesseract` path) |
| 3 | Whitespace-only → OCR | **pass** (unit) |
| 4 | Geometry golden + `/Rotate 90` | **pass** (unit + 180/270 probe; boxes match viewport/raster space) |
| 5 | Adversarial misaligned → reject | **pass** (unit + import) |
| 6 | Glyph-stream → `TOTAL` / `125.01` | **pass** (unit) |
| 7 | Multi-page searchable order | **pass** for multi-page **mixed** engines; full multi-page all-`pdf-text` not re-run here — **not-checkable** in this session beyond mixed |
| 8 | Scan dialog folder route | **pass** (your live; not re-audited UI) |
| 9 | 357+ tests / tsc / CI | **pass** (370 green in this session) |

---

## REWORK minimum (optional polish — not required to pass)

If you want to clear D1/D2 only:

1. **Bands:** Require `bands < 4` **only when** `coverage < ~0.05` *or* lower the floor to 2–3 when `tokens.length ≤ 12` (short receipts). Keep strict bands for high token counts on tall pages.  
2. **Merge:** `mergeGap = max(0.6 × medianChar, 0.25 × medianH)` **or** floor at ~0.35 × em so true spaces never merge; keep sub-em for glyph reassembly.  
3. **Tests:** 2-line letter fixture must **accept** (or document intentional OCR fallback); `gap=1pt TOTAL|125.01` must stay separate if you change the floor.

No geometry rework for Rotate/CropBox/UserUnit. No import rework for race/mixed.

---

## Bottom line

Implementation matches the sealed plan and the live happy path. The aggressive tall-page band rule and tight merge threshold are the only substantive residual risks; both fail **safe** (extra OCR or glued tokens), not by writing high-confidence wrong coordinates on normal ScanSnap sandwiches. **Pass.**
