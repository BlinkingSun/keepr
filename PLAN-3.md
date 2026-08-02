# Batch 3 — ScanSnap support (rev 2, post plan-audit)

Audit verdict on rev 1 was **revise**. Direction confirmed; Lane P was
under-specified in precisely the places that corrupt data silently. This
revision lands the seven minimums the master required.

## Trigger
User's scanner is a **ScanSnap**, model unknown, not yet connected.

## Binding fact (audit-confirmed, do not relitigate)
**No ScanSnap model exposes eSCL/AirScan, WSD, or ICA** — iX1600/iX1500/iX1300/
iX500/iX100 (Wi-Fi) and S1300i/SV600 (USB-only) alike. Wi-Fi on these devices
serves ScanSnap Home / Connect / Cloud, not driverless scan. Anchors: PFU FAQ
("does not support TWAIN or ISIS"; ScanSnap Home required), `sane-fujitsu`
man page ("Network interfaces are not supported on any scanner model"),
`sane-airscan` device list (no ScanSnap entries).

**We build no ScanSnap-specific network support.** The supported path is
ScanSnap Home "Scan to file" → `New Receipts/` → watcher → `Old Receipts/`,
which already works. The UI must say so instead of showing an empty device list.

---

## Lane P — PDF embedded text layer  (owner: Claude tier; see SPEC-P.md)

Today every PDF is rasterized at 200 DPI and re-OCR'd, discarding any text
layer. ScanSnap *can* emit searchable PDFs (ABBYY) — **opt-in**, not default, so
this is an optimisation with a fallback, never an assumption.

### P1. Coordinate algorithm — locked
Word bboxes are **stored-master pixel space** (schema `page` invariant, already
in 001_initial.sql). Required:

```
viewport = page.getViewport({ scale: 200 / 72 })   // the SAME call the rasterizer makes
corners  = viewport.convertToViewportPoint(...)    // 4 corners → axis-aligned box
```

`getTextContent()` items are **unrotated user space**; `/Rotate` is NOT baked
into `item.transform`; `e,f` is the **baseline-left** origin, not ink top-left;
`width`/`height` are user-space lengths. Hand-rolling `y = 792 - f` breaks on
`/Rotate`, CropBox offset, UserUnit and skew — it may be used only as an
assertion in tests for the upright case. `src/export/geometry.ts` holds the
inverse (master → PDF); Lane P is its dual and must agree.

### P2. pdfjs items → `Word[]` — an adapter, never 1:1
pdfjs items are glyph runs, not words. Mapping them straight to `Word` yields
`T O T A L` and `12 5.01`, which the receipt parser's `\btotal\b` and money
regexes cannot match — and `buildLines()` in `src/ocr/parse/receipt.ts` groups
by baseline with a tolerance derived from median word height, so glyph-sized
items shatter its line model. Required:

- re-tokenize runs into words on **horizontal gap** (split at gaps ≳ 0.3 × median
  char advance), independent of pdfjs's synthetic spaces;
- normalize NBSP, soft hyphen (U+00AD), ligatures, full-width forms;
- drop whitespace-only words, exactly as `tesseract.ts` already does;
- emit the same `Word{text,bbox,confidence}` shape the tesseract path emits, so
  every downstream consumer is unchanged.

### P3. Useless-layer gates — must include degenerate geometry
Rev 1 gated only (a) no layer, (b) whitespace-only, (c) low item count. The
audit's state **(d) — correct words, wrong positions —** was unguarded, and it
is the dangerous one: search works, so it looks fine, while click-to-assign and
highlights silently point at the wrong pixels. Reject the layer and fall back to
OCR when **any** of:

| Gate | Signal |
|---|---|
| (a) absent | 0 items |
| (b) empty | 0 items after whitespace trim |
| (c) junk | alnum ratio < 0.45, or ≥15% `?`/`(cid:N)`, or no money/date shape on a receipt-shaped page |
| **(d) degenerate geometry** | **unique (x,y) positions <= 2 while item count >= 8; or any word w<=0/h<=0; or all items share one transform; or < 4 distinct Y-bands on a page taller than 300 pt; or union-of-boxes covers < 2% of page area** |

### P4. Confidence and provenance — honesty over convenience
Embedded text carries no per-word score. A fixed 0.95 is a claim we did not
measure, and the audit showed it barely moves total-field confidence anyway
(line conf is ~10% of the total weight) — so it buys no safety while asserting
false certainty. Policy: **fixed moderate confidence (0.80)**, `ocr_engine =
'pdf-text'` on the page row, and provenance recorded so the UI can say where a
field came from. `LOW_CONFIDENCE_THRESHOLD = 0.5` was calibrated on tesseract
output and is not re-tuned in this batch.

### P5. Where it runs, and how "no tesseract" is proven
At import, in the existing PDF page loop (`import.ts`), beside the rasterize
call — the raster is still produced and stored (thumbnails, viewer and region
assignment all need it). If the layer passes P3, the page is written with
`ocr_status='done'`, `ocr_engine='pdf-text'`, text + words, and is **not**
enqueued for OCR. Otherwise it enqueues exactly as today. Acceptance #1 is then
a database fact, not a timing guess.

---

## Lane U — teach the path in the product  (owner: grok; see SPEC-U.md)

- **Scan dialog empty state.** Current copy blames "USB-only scanners", which is
  wrong and confusing for a Wi-Fi ScanSnap owner. Replace with an explicit
  folder route: *"Using a ScanSnap, Brother or Canon? Scan to a folder instead"*
  + a button that opens `New Receipts`. Must not imply future eSCL for ScanSnap.
- **Docs (README + docs/scanning.md).** ScanSnap Home profile, exact:
  **Type = `Mac (Scan to file)`** — *not* `Manage in ScanSnap Home`;
  Send to = `None (Scan to file)`; Save to = `<library>/New Receipts/`;
  rename-after-scan **off**; searchable PDF **optional** (opt-in checkbox).
  ScanSnap Manager equivalent for S1300i/older: Quick Menu off, Application
  `None (Scan to File)`, image saving folder = New Receipts.
- **Why Type matters (call it out, do not bury it).** With
  `Manage in ScanSnap Home`, ScanSnap tracks the file by path; KeepR moving it to
  `Old Receipts` breaks the entry ("file removed or renamed outside ScanSnap Home
  software") and it is **not** re-created. Scan-to-file is a clean handoff.
- Note the watcher's stability gate (3 stable observations, ~8s) and advise
  against pointing New Receipts at a cloud-synced folder.

---

## Ownership and waves

| Wave | Lane | Owns (write) | Reads |
|---|---|---|---|
| 1 | **P** | `src/ocr/pdfText.ts` (new), `src/ocr/__tests__/pdfText*.test.ts`, fixtures | `import.ts`, `receipt.ts`, `geometry.ts` |
| 1 | **U** | `src/ui/scan/**`, `README.md`, `docs/scanning.md` | — |
| 2 | orchestrator | `src/ingest/import.ts` wiring, integration tests | both |

P and U run concurrently — disjoint files. **Two writers never touch
`import.ts`**; the wiring is wave 2, mine.

## Acceptance
1. Searchable PDF imports with fields extracted and `page.ocr_engine='pdf-text'`,
   and that page never enters the OCR queue (job unit count proves it).
2. Image-only PDF still OCRs exactly as before — no regression.
3. Whitespace-only text layer falls back to OCR rather than producing an empty item.
4. **Geometry golden:** word boxes land on the glyphs in stored-master pixels,
   verified against the rasterized page, including a `/Rotate 90` fixture.
5. **Adversarial:** a layer with correct words but degenerate positions is
   REJECTED (falls back to OCR), not accepted.
6. **Char-stream:** a glyph-granularity layer still yields `TOTAL 125.01` as one
   money token after the adapter.
7. Multi-page searchable PDF → one item, N pages, correct order.
8. Scan dialog offers the folder route; the button opens New Receipts.
9. Existing 357 tests green; tsc clean.

**Fixtures:** cupsfilter alone is not representative (the audit flagged
calibration on it as a HIGH process risk). Need at least: a real
ABBYY/ScanSnap-style sandwich PDF, an image-only PDF, a glyph-granularity PDF,
and a deliberately misaligned one.
