# SPEC-P — PDF embedded text layer

Owner: one executor. Writes ONLY `src/ocr/pdfText.ts` + its tests + fixture
generator. Does NOT touch `import.ts` (wave 2, orchestrator).

## Public contract (frozen — the orchestrator wires to exactly this)

```ts
export interface PdfTextPageResult {
  text: string
  words: Word[]              // bboxes in STORED-MASTER pixel space at `dpi`
  confidence: number         // fixed 0.80 (see PLAN-3 P4)
  engine: 'pdf-text'
  itemCount: number          // raw pdfjs items, for logging
}

/**
 * Returns null when the layer is absent or unusable — caller then OCRs as
 * normal. Never throws for a bad layer; throws only if the PDF cannot be
 * opened at all.
 */
export async function extractPdfPageText(
  absPath: string,
  pageIndex: number,        // 0-based, same convention as rasterizePdfPage
  opts?: { dpi?: number },  // default 200 — MUST match the rasterizer
): Promise<PdfTextPageResult | null>

/** One pdfjs item mapped to pixel space, BEFORE any word merging. */
export interface GeometryToken { text: string; bbox: BBox }

/**
 * Exported for tests. Takes PRE-MERGE geometry tokens in stored-master PIXEL
 * space, and page metrics in the same space. Both of those are load-bearing:
 * gap-merging can smooth degenerate positions into plausible-looking words, and
 * mixing point metrics with pixel boxes makes the coverage and Y-band
 * thresholds meaningless.
 */
export function isLayerUsable(
  tokens: GeometryToken[],
  page: { widthPx: number; heightPx: number },
): { usable: true } | { usable: false; reason: string }
```

## Pipeline (mandatory order — the (d) gate runs BEFORE the adapter)

```
getTextContent()
  -> map each non-whitespace item 1:1 to a GeometryToken (bbox via viewport)
  -> isLayerUsable(tokens, { widthPx, heightPx })   // ceil(viewport.width/height)
  -> if unusable: return null            (caller OCRs the page as normal)
  -> else adapter(tokens) -> Word[] -> PdfTextPageResult
```

`widthPx`/`heightPx` are `Math.ceil(viewport.width)` / `Math.ceil(viewport.height)`
— the raster's own dimensions, never points.

## Geometry (highest-risk part — get this exactly right)
- `viewport = page.getViewport({ scale: dpi / 72 })` — the SAME call
  `rasterizePdfPageDirect` makes, so rotation handling is identical for free.
- For each item, build the quad from `item.transform` + `width`/`height` in user
  space, map all four corners with `viewport.convertToViewportPoint`, then take
  the axis-aligned bounding box. Do NOT assume upright.
- `e,f` is baseline-left. The ink box rises above the baseline: derive top from
  the transformed corners, never by subtracting `height` in user space.
- Round to integer pixels the same way the rasterizer sizes the PNG
  (`Math.ceil` on viewport width/height) so a word box can never exceed the
  stored master by a rounding pixel.
- `src/export/geometry.ts::masterBBoxToPdfText` is the inverse; round-trip with
  `masterBBoxToPdfText(box, widthPx, heightPx, 0, 72 / dpi)` must return the
  original box within 1 px.

## Adapter (pdfjs items → Word[])
- Items are glyph runs. Re-tokenize on horizontal gap: split a run where the gap
  between consecutive glyph advances exceeds ~0.3 x median char advance for that
  run's font size. Ignore pdfjs's own synthetic spaces for splitting decisions —
  use them only as a hint.
- Normalize: NBSP -> space, strip U+00AD, expand ligatures (fi, fl, ffi, ffl),
  full-width -> ASCII, collapse runs of whitespace.
- Drop whitespace-only words (mirror `tesseract.ts::mapWords`).
- `text` is the words joined so that `buildLines()` in
  `src/ocr/parse/receipt.ts` sees tesseract-shaped input: same line grouping by
  baseline, same spacing. Verify by feeding the result through the real parser.

## Gates (return null when ANY trips) — see PLAN-3 P3 table
Report the reason string; the orchestrator logs it so a user can tell
"scanned image, OCR ran" from "text layer rejected as misaligned".

## Fixtures (generate in-repo, commit the generator not huge binaries)
1. `sandwich.pdf` — invisible text (Tr 3) over a raster image, ABBYY-style.
2. `imageonly.pdf` — raster, no text layer.
3. `glyphstream.pdf` — one show-text op per glyph (the T O T A L case).
4. `misaligned.pdf` — correct strings, all items at the same (x,y).
5. `rotated90.pdf` — `/Rotate 90` with real text.
Generate with pdf-lib if available, else hand-write minimal PDF byte templates;
`cupsfilter` output alone is NOT acceptable calibration (audit: HIGH risk).

## Tests (all must be in this lane's own test files)
- geometry golden per fixture: known word -> expected box within 2 px;
- round-trip against `masterBBoxToPdfText`;
- rotated90 boxes land on glyphs;
- glyphstream yields `TOTAL` and `125.01` as single tokens through the real
  `buildLines` + money parser;
- misaligned fixture -> **`extractPdfPageText(misaligned.pdf, 0)` returns null
  end to end** (not merely `isLayerUsable` returning false in isolation — the
  whole point is that the (d) layer never escapes the module), and the reason
  mentions degenerate/misaligned;
- imageonly -> `extractPdfPageText` returns null;
- whitespace-only layer -> null.

## Do not
- Do not change `LOW_CONFIDENCE_THRESHOLD` or any parser calibration.
- Do not touch `import.ts`, `ocrRunner.ts`, or the tesseract provider.
- Do not add a dependency; pdfjs-dist is already bundled.
