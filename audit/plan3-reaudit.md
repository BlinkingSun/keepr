I'll re-read PLAN-3 rev 2 and both SPECs against the seven minimums, then check for executability holes that could still ship the (d) bug.Checking contracts the SPECs depend on (`shell:openPath`, raster viewport, export geometry inverse) for contradictions.# PLAN-3 RE-AUDIT (cycle 2 of 2)

**Inputs:** `PLAN-3.md` rev 2, `specs/SPEC-P.md`, `specs/SPEC-U.md`  
**Cross-check:** `shell:openPath`, `pages.setOcrResult`, `masterBBoxToPdfText`, rasterizer viewport, `ScanPanel` purity  

---

## VERDICT: **revise**

Rev 2 closes almost everything from the seven minimums. Direction, ownership, waves, binding fact, confidence, docs, and the public extract API are solid. One **blocking SPEC-P hole** remains: the (d) gate is written correctly in PLAN-3 but is **not enforced in a way that a green Lane-P suite guarantees**, and `isLayerUsable` as frozen cannot implement all of P3 without unit/order ambiguity. That is the only thing keeping this from approve.

Wire contract for wave 2 is fine; do not renegotiate `extractPdfPageText` shape. Tighten SPEC-P gate order + tests (+ one signature fix). No plan rewrite.

---

## Per-minimum

### 1. Coordinate algorithm — **SEALED**

PLAN-3 P1 and SPEC-P Geometry lock:

- same `getViewport({ scale: dpi/72 })` as rasterizer  
- 4-corner `convertToViewportPoint` AABB  
- unrotated user space / baseline-left / user-space width·height  
- hand-rolled `792 - f` only as upright assertion  

**Non-blocking note (do not re-open unless you touch the test line):**  
Round-trip vs `masterBBoxToPdfText` is underspecified. Export uses `scale` as *points per master pixel* (default **1** = 1px→1pt) and applies **metadata** `page.rotation`. Import bakes PDF `/Rotate` into the PNG via viewport and stores `rotation = 0` on `pages.add`. A correct dual is:

- `scale = 72/dpi`  
- `rotation = 0` (stored-master already matches the rendered viewport)  
- not `masterBBoxToPdfText(..., 90)` for `rotated90.pdf`

Without that sentence an executor can “pass” a round-trip that does not exercise the real dual. Algorithm itself is sealed.

---

### 2. Degenerate-geometry gate (d) — **STILL-OPEN**

**What is sealed:** PLAN-3 P3 table (unique positions, zero w/h, shared transform, Y-bands, coverage &lt;2%) and the intent to reject (d).

**Exact holes:**

| Hole | Why it matters |
|---|---|
| **`isLayerUsable(words, {widthPt, heightPt})` cannot implement P3 as written** | Words are in **stored-master pixels**. Page size is in **points**. Union-area / page-area mixes units → effective coverage threshold is off by ~(dpi/72)² (~7.7× at 200 DPI), so the published “&lt;2% of page” gate is not what the code will compute unless they also take `dpi` or pixel page size. |
| **“all items share one transform” is not on `Word[]`** | `Word` has only `bbox`/`text`/`confidence`. Shared **transform matrix** requires raw pdfjs items (or an internal pre-adapter stage the export doesn’t expose). |
| **Gate order vs adapter unstated** | P3’s “item count ≥ 8” is raw-item language. If the gate runs **after** gap-merge, a misaligned glyph dump can collapse to 1–3 words at one origin → unique-positions rule never arms (`count ≥ 8` false). |
| **Tests don’t close the extract path** | SPEC requires `misaligned → isLayerUsable false`, **not** `extractPdfPageText(misaligned.pdf) === null`. Image-only/whitespace require `extract → null`. **(d) can ship with green tests:** unit-test `isLayerUsable` on hand-built multi-word garbage; `extract` only checks empty/low-count and returns a usable-looking layer. |

This is exactly “pass own tests while shipping (d).” **Blocking.**

**Minimum seal (SPEC-P only):**

1. Prescribe pipeline: raw items → **geometry tokens (1:1, no merge)** → `isLayerUsable` → on pass, **adapter merge** → result.  
2. Give `isLayerUsable` page size in **the same space as word bboxes** (pixel `width`/`height` from `ceil(viewport.*)`, or pass `dpi` and convert once).  
3. Map “shared transform” → checkable rule on tokens (e.g. all origins within 1 pt **and** median box area absurd / same transform if still holding raw matrices internally).  
4. **Mandatory:** `extractPdfPageText(…, misaligned.pdf) === null` with a stable `reason` containing e.g. `degenerate-geometry`.

---

### 3. Adapter not 1:1 — **SEALED**

P2 + SPEC-P Adapter: gap re-tokenization, unicode normalize, drop whitespace words, verify through real `buildLines` + money parser, glyphstream fixture.

**Non-blocking ambiguity:** “split a run where gap &gt; ~0.3× median char advance” is really **between-item clustering** (pdfjs rarely exposes per-glyph advances inside one `TextItem`). Competent implementer: Y-band → sort X → merge if gap &lt; threshold; split/normalize spaces inside `str`. Good enough; no further product question required.

---

### 4. Confidence policy — **SEALED**

Fixed **0.80**, `engine: 'pdf-text'`, no `LOW_CONFIDENCE_THRESHOLD` retune. Honest relative to rev 1’s 0.95 claim.

**Residual (not a minimum reopen):** pattern-weighted field conf can still sit high on clean-wrong totals; dual-path disagreement is still wave-2 product choice, not SPEC-P.

---

### 5. ScanSnap docs — **SEALED**

PLAN-3 Lane U + SPEC-U: Type = **`Mac (Scan to file)`** vs Manage-in-Home + broken-library consequence; Send to None; Save to New Receipts; rename off; searchable PDF **opt-in**; Manager path; 3-obs / ~8s gate; cloud-folder warning; no third-party network drive claim.

`shell:openPath` + `target: 'newReceipts'` **exists** and matches App’s import menu. UI copy matches binding fact.

**Non-blocking:** SPEC-U has the button call `invoke` inside `ScanPanel`, which today is pure props. Executable (bridge import is allowed under `src/ui/scan/**`); optional cleaner: `onOpenNewReceipts` prop wired in App. Not a plan reopen.

---

### 6. Architecture / ownership — **SEALED**

- P owns only `src/ocr/pdfText.ts` + tests/fixtures  
- U owns scan UI + docs  
- Wave 2 alone wires `import.ts`  
- “No tesseract” = page not enqueued + `ocr_engine='pdf-text'` / `ocr_status='done'`  

Frozen result type maps to `setOcrResult` (`text | words | confidence | engine` + wave-2 `generation`).

**Wave-2 reminder (not SPEC-P renegotiation):** field fill lives in `ocrRunner` today. Wiring must **also** run the same post-OCR extract path when accepting pdf-text, or acceptance #1 (“fields extracted”) fails while DB says done. Contract of P stays; you already own that integration.

---

### 7. Acceptance expanded — **SEALED**

Nine criteria cover geometry golden, `/Rotate 90`, adversarial misaligned, glyph-stream, multi-page, UI, test count. Five in-repo fixtures (sandwich / image-only / glyphstream / misaligned / rotated90); cupsfilter-only rejected. Integration items (#1, #7, #8) correctly sit on wave 2 + U.

---

## SPEC-P executability

| Question | Answer |
|---|---|
| **Frozen public contract enough to wire wave 2 without renegotiating?** | **YES** — `extractPdfPageText(path, pageIndex, {dpi?}) → PdfTextPageResult \| null` is sufficient to branch enqueue vs `setOcrResult`. |
| **Executable by a competent implementer with no further questions?** | **NO** — gate units (pt vs px), gate-vs-adapter order, “shared transform” on `Word[]`, and round-trip scale/rotation need one more SPEC sentence each. Without them, green tests can still ship (d). |
| **Would tests let (d) ship?** | **YES, today** — misaligned only asserts `isLayerUsable`, not `extract → null`; post-merge count can disarm “≥ 8 items”. |

---

## Remaining **blocking** gap (only this)

**SPEC-P must make the (d) reject an end-to-end property of `extractPdfPageText`, on pre-merge geometry tokens, in pixel space consistent with the raster, with an explicit test.**

Suggested delta (for your next micro-edit, not done by me):

```text
Pipeline (mandatory):
  getTextContent → map each non-ws item to a geometry token (1:1, bbox via viewport)
  → isLayerUsable(tokens, { widthPx, heightPx })  // same space as bboxes
  → if unusable: return null
  → else adapter(tokens) → Word[] → PdfTextPageResult

isLayerUsable page metrics: widthPx/heightPx = ceil(viewport.width/height), not points.

Test: extractPdfPageText(absPathTo('misaligned.pdf'), 0) === null
      (reason includes degenerate / misaligned).
```

Optional one-liner on Geometry: round-trip uses `masterBBoxToPdfText(box, W, H, 0, 72/dpi)`.

After that: **approve** without re-auditing the rest.

---

## SPEC-U

Executable; channel real; docs complete. No blocking gap. Disjoint from P. Ship wave 1 in parallel once SPEC-P is micro-patched.

---

## Summary table

| # | Minimum | Status |
|---|---|---|
| 1 | Coordinate algorithm | **SEALED** |
| 2 | Degenerate geometry (d) | **STILL-OPEN** (SPEC enforcement / units / order / extract test) |
| 3 | Adapter not 1:1 | **SEALED** |
| 4 | Confidence 0.80 + pdf-text | **SEALED** |
| 5 | ScanSnap docs + Type | **SEALED** |
| 6 | Architecture / ownership / waves | **SEALED** |
| 7 | Expanded acceptance + fixtures | **SEALED** |

**VERDICT: revise** · **SPEC-P wireable: YES** · **SPEC-P fully executable / (d)-safe: NO** · **Blocking gap: (d) end-to-end in SPEC-P only**

No project files modified.
