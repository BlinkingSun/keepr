# Contributing to KeepR

Thanks for looking. This is a small project with strong opinions about a narrow
set of things and no opinions at all about most others.

## Quick start

```bash
npm ci
npm test            # 254 unit tests
npm run test:schema # adversarial schema assertions
npm start           # build and open the app
```

If you hit `NODE_MODULE_VERSION`, see the ABI note in
[DEVELOPING.md](DEVELOPING.md) — nothing is broken, you just ran a command
directly instead of through an npm script.

## The eight rules

These are not preferences. Each one exists because it was got wrong once, and each
has a test that fails if you break it again. A PR that violates one will be asked
to change, so it is worth reading first.

1. **Money is integer minor units.** `84.37` is `8437`. Never a float, never a
   formatted string, never `parseFloat`. A float total in an expense report is a
   wrong number that looks right, and the user files it.
2. **Never `SUM` from `receipt_data` or `item`.** Money comes from
   `v_summable_receipts`, tax from `v_summable_tax`, folder figures from
   `v_folder_totals`. A naive sum double-counts split receipts.
3. **Never present a superseded split origin in a view showing totals.** The grid
   does not add anything up — it displays, and the reader does the arithmetic.
4. **Totals are always per-currency.** Never blend.
5. **Word bboxes live in stored-master pixel space.** Rotation is metadata only,
   applied at render time, never also baked into the file. A crop invalidates OCR
   and bumps the generation.
6. **Do not nest worker pools.** `tesseract.js` already runs its own threads.
7. **No network at runtime.** wasm core and language data are bundled. There is a
   test that fails if a code path would fetch.
8. **A flag that fires on everything carries no signal.** If you add a warning
   state, measure how often it fires on correct data before you ship it.

## Where help is most valuable

**Extraction accuracy.** The highest-value contribution. The workflow:

```bash
npm run corpus            # generate the synthetic corpus
npm run corpus:analyze    # score extraction against known ground truth
```

Add a receipt shape to `spikes/corpus/generate.ts` that currently extracts wrong,
then fix the parser until it passes without regressing the others. Include the
before/after table from `corpus:analyze` in your PR.

**Please do not add photographs of real receipts.** They are someone's financial
records, and they cannot be redacted meaningfully — the amounts are the point. The
corpus is synthetic deliberately, and it can represent any format you can describe.

Also wanted, in rough order:

- Scanner capture: TWAIN (Windows), ImageCaptureCore (macOS), SANE (Linux)
- Reporting: expense reports with cover pages and embedded images
- A local vision-model `OcrProvider` — the interface exists for this
- Linux packaging; it should work, nobody has verified
- Accounting exports: QIF, OFX

## Pull requests

- One concern per PR. A parser fix and a UI change are two PRs.
- `npm test` and `npx tsc -p .` must both pass. CI checks both.
- New behaviour needs a test. Bug fixes need a test that fails before the fix.
- Say what you verified and how. "Ran the corpus, total accuracy 11/12 → 12/12" is
  worth more than "tested locally".
- Comments should explain *why*, not restate the code. If something looks odd and
  is deliberate, say what breaks if it changes.

## Reporting a bug

Include the platform, whether you built from source or used a release, and the
smallest reproduction you can manage. If it involves a receipt that extracts wrong,
describe the layout in words — do not attach the receipt.

Extraction bugs are most useful as a corpus case. If you can write one, that IS the
bug report.

## Architecture notes

`audit/` holds the real review transcripts from development, including the audits
that caught the money-integrity bugs. If you want to know why the schema has eight
state-transition triggers, that is the honest answer.

`PLAN.md` is the implementation plan, including what was deliberately deferred.
