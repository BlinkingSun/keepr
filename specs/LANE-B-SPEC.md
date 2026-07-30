# Lane B — OCR pipeline + receipt field extraction

**Executor:** grok (parser and pool design reviewed by the auditor) · **Wave:** 2
(parallel with Lane A) · **Depends on:** Lane 0

## You own exactly these paths

```
src/ocr/**
src/workers/**
resources/tessdata/**      (you may add eng.traineddata here)
```

**You may READ** `src/shared/types.ts`, `PLAN.md`, `scripts/abi-check.mjs`.

**You may NOT touch** `src/shared/**`, `src/db/**`, `src/main/**`, `src/api/**`,
`src/ui/**`, `package.json`, `tsconfig.json`. Lane A is editing `src/db/**` at the
same time as you. If you need a dependency added to `package.json`, report it as a
BLOCKER — do not edit the file.

## Goal

Turn a page image into `OcrResult` (text + word boxes + confidence), and turn that
into proposed receipt fields with per-field confidence and provenance.

## The threading contract — read this twice

`tesseract.js` **already runs its own worker threads.** Wrapping it in your own
`cores-1` pool multiplies WASM heaps and exhausts memory on a large import. This
is the single most likely way to get this lane rejected.

Required shape:

- **One** `Tesseract.Scheduler`, created once, with a small fixed worker count
  (default `Math.min(4, max(1, cores-1))`, configurable). Never one scheduler per
  job, never a scheduler inside another pool.
- A **separate** pool for sharp/pdf work (decode, thumbnail, rotate, rasterize) at
  `cores-1`. These two are sized independently and are never nested.
- Workers **return data only**. They never touch SQLite. Main writes results.
- Every job is cancellable via `AbortSignal`, and cancellation actually stops
  queued work rather than only ignoring the result.

## Offline is mandatory

The app must OCR with the network unplugged. No CDN fetch at runtime, ever.

- Resolve `workerPath`, `corePath` (wasm) and `langPath` from local files.
- Bundle `eng.traineddata` under `resources/tessdata/`.
- `scripts/abi-check.mjs` already asserts these exist — read it to match the paths
  it expects rather than inventing new ones.
- Add a test that fails if any code path would fetch over the network.

## Geometry invariant

Word bounding boxes are in **stored-master pixel space**: the pixels of the file
as it sits on disk, before display rotation is applied.

- `page.rotation` is metadata only. Never also bake rotation into the file. Doing
  both silently misaligns the searchable-PDF text layer and region-to-field
  mapping while everything still looks plausible.
- A **crop rewrites the master**, so it must bump `ocr_generation`, invalidate
  `ocr_*`, and re-queue OCR.
- Lane J places PDF text using these boxes and Lane G draws selection regions with
  them. If your space is wrong, both break in ways that look almost right.

## Deliverables

### `src/ocr/provider.ts`
Implements `OcrProvider` from `src/shared/types.ts`. Nothing outside `src/ocr` may
know Tesseract exists — Phase 4 swaps in a vision model behind this interface.

### `src/ocr/tesseract.ts`
The scheduler-backed provider. Returns real word boxes and confidences, not just
text. Handles a page that OCRs to nothing without throwing.

### `src/workers/imagePool.ts`
The sharp/pdf worker pool: decode, thumbnail (max edge 320px), rotate, and
rasterize a PDF page at a configurable DPI (default 300).

### `src/ocr/parse/receipt.ts`
```ts
parseReceipt(ocr: OcrResult, hints: ParseHints): ExtractionRecord
```
Extracts, each with confidence and the `bbox` it came from:

| Field | Notes |
|---|---|
| `total` | **Hardest and most important.** Prefer a labelled total near the bottom. Beware SUBTOTAL, TAX, CASH, CHANGE, TIP, and BALANCE DUE. When several candidates tie, prefer the largest labelled TOTAL that is not preceded by SUB. |
| `txnDate` | Many formats. Ambiguous `03/04/2026` resolves by locale hint, and confidence must drop when ambiguous rather than silently guessing. |
| `vendor` | Usually the top few lines. Match against the known-vendor list first (`hints.vendors`), fall back to the largest/topmost text block. |
| `taxTotal` | Labelled GST/HST/PST/VAT/Sales Tax. Emit one entry per distinct tax label so Lane A can write `receipt_tax_line` rows. |
| `paymentType` | VISA/MC/AMEX/DEBIT/CASH/CHECK, and a masked card tail if present. |
| `externalRef` | Invoice/receipt/order number. |
| `description` | Concatenated line-item text, trimmed. |

Rules:
- **Money parses to integer minor units.** Handle `1,234.56`, `1.234,56`,
  `$84.37`, `84.37-`, and OCR noise like `84,37` / `8437` / `S4.37`.
- **Never emit a value you did not find.** Omit the field. A wrong date with high
  confidence is far worse than an absent one, because the user will not check it.
- Confidence is honest: reflect both OCR word confidence and how sure the
  *pattern* match is. Prefer under-confidence.
- Pure and deterministic — same input, same output. No clock, no randomness, no IO.

### `src/ocr/parse/money.ts`, `date.ts`
Small pure helpers, separately tested. These are where the real bugs live.

## Tests — `src/ocr/__tests__/`

`node --experimental-strip-types` with `node:test`.

1. **Fixture corpus:** at least 12 synthetic receipt texts covering a thermal
   grocery receipt, a fuel receipt, a hardware store with multiple tax lines, a
   restaurant with a tip, a receipt with SUBTOTAL immediately above TOTAL, a
   European-format receipt, a refund with a negative total, a receipt with no
   discernible total, and a rotated/low-quality one. Assert expected extracted
   values field by field.
2. `SUBTOTAL 75.22 / TAX 6.21 / TOTAL 81.43` extracts **8143**, not 7522.
3. A receipt where TOTAL appears twice returns one value with the reasoning
   documented in a comment.
4. Money parsing table test across all the formats listed above.
5. Ambiguous date returns lower confidence than an unambiguous one — assert the
   inequality.
6. A receipt with no total omits `total` entirely rather than guessing 0.
7. Negative/refund total parses to a negative `MinorUnits`.
8. Scheduler is created **once** across 20 concurrent `ocrPage` calls — assert the
   instantiation count, this is the OOM guard.
9. Cancellation via `AbortSignal` leaves no running work.
10. No network: assert that constructing and running the provider performs no
    outbound request (stub/spy `fetch` and `http`).

## Report format

```
DONE | OPEN | BLOCKED
FILES: <paths>
TESTS: <command> -> <pass/fail counts>
EXTRACTION ACCURACY: <how many of your 12 fixtures extract total+date+vendor correctly>
DECISIONS: <judgement calls, especially in total selection>
BLOCKERS: <anything you needed but could not touch>
```

Report the real accuracy number even if it is poor. A truthful 8/12 is useful; a
claimed 12/12 that is actually 8 wastes the audit cycle that follows.
