/**
 * Lane P — PDF text layer. The tests that matter here are the adversarial ones:
 * anyone can make a tidy PDF pass, and the plan audit's finding was that the
 * dangerous layer is the one that LOOKS fine (right words, wrong places).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  extractPdfPageText,
  inspectPdfPageText,
  isLayerUsable,
  normalizePdfText,
  PDF_TEXT_CONFIDENCE,
} from '../pdfText.ts'
import { masterBBoxToPdfText } from '../../export/geometry.ts'
import {
  sandwichPdf,
  imageOnlyPdf,
  glyphStreamPdf,
  misalignedPdf,
  rotated90Pdf,
  plainTextPdf,
  whitespaceOnlyPdf,
  shortReceiptPdf,
} from './fixtures/pdfFixtures.ts'

const DPI = 200
const dir = mkdtempSync(path.join(tmpdir(), 'keepr-pdftext-'))

async function fixture(name: string, bytes: Buffer | Promise<Buffer>): Promise<string> {
  const p = path.join(dir, name)
  writeFileSync(p, await bytes)
  return p
}

test('a searchable PDF (invisible text over a raster) yields usable words', async () => {
  const p = await fixture('sandwich.pdf', sandwichPdf())
  const r = await extractPdfPageText(p, 0, { dpi: DPI })
  assert.ok(r, 'sandwich layer must be accepted')
  assert.equal(r.engine, 'pdf-text')
  assert.equal(r.confidence, PDF_TEXT_CONFIDENCE)
  assert.match(r.text, /HOME DEPOT/)
  assert.match(r.text, /TOTAL 125\.01/)
})

test('an image-only PDF returns null so the caller OCRs it', async () => {
  const p = await fixture('imageonly.pdf', imageOnlyPdf())
  assert.equal(await extractPdfPageText(p, 0, { dpi: DPI }), null)
})

test('a whitespace-only text layer returns null', async () => {
  const p = await fixture('whitespace.pdf', whitespaceOnlyPdf())
  assert.equal(await extractPdfPageText(p, 0, { dpi: DPI }), null)
})

test('state (d): correct words at degenerate positions is REJECTED end to end', async () => {
  // The whole point of the module boundary: a misaligned layer must never
  // escape it. Search would work; click-to-assign would silently lie.
  const p = await fixture('misaligned.pdf', misalignedPdf())
  assert.equal(await extractPdfPageText(p, 0, { dpi: DPI }), null)
  const { reason } = await inspectPdfPageText(p, 0, { dpi: DPI })
  assert.match(reason, /degenerate/i)
})

test('glyph-granularity layers still produce whole money and label tokens', async () => {
  // pdfjs hands this back as "HOM" + "E DEPOT #4821" with synthetic spaces
  // inside numbers ("07/ 12/ 2026"). A 1:1 item->word mapping would give
  // "T O T A L" and defeat the receipt parser's \btotal\b and money regexes.
  const p = await fixture('glyphstream.pdf', glyphStreamPdf())
  const r = await extractPdfPageText(p, 0, { dpi: DPI })
  assert.ok(r, 'glyph-stream layer should still be usable')
  const words = r.words.map((w) => w.text)
  assert.ok(words.includes('TOTAL'), `expected a whole TOTAL token, got ${JSON.stringify(words.slice(0, 12))}`)
  assert.ok(words.includes('125.01'), `expected a whole money token, got ${JSON.stringify(words.slice(0, 12))}`)
  assert.ok(words.includes('HOME'), 'split runs must be reassembled')
})

test('word boxes sit inside the raster and on the right rows', async () => {
  const p = await fixture('plain.pdf', plainTextPdf())
  const r = await extractPdfPageText(p, 0, { dpi: DPI })
  assert.ok(r)
  const widthPx = Math.ceil(612 * (DPI / 72))
  const heightPx = Math.ceil(792 * (DPI / 72))
  for (const w of r.words) {
    assert.ok(w.bbox.x >= 0 && w.bbox.y >= 0, `box off the top/left: ${JSON.stringify(w.bbox)}`)
    assert.ok(w.bbox.x + w.bbox.w <= widthPx + 1, `box past the right edge: ${JSON.stringify(w.bbox)}`)
    assert.ok(w.bbox.y + w.bbox.h <= heightPx + 1, `box past the bottom: ${JSON.stringify(w.bbox)}`)
  }
  // The vendor line's BASELINE is 80pt from the top => ~222px at 200dpi. The box
  // top sits an ascender above that, which is the point of using the quad
  // corners rather than the raw baseline origin.
  const home = r.words.find((w) => w.text === 'HOME')
  assert.ok(home, 'vendor word present')
  const baselinePx = (80 * DPI) / 72
  assert.ok(
    Math.abs(home.bbox.y + home.bbox.h - baselinePx) < 8,
    `vendor baseline should land at ~${baselinePx}px, box was y=${home.bbox.y} h=${home.bbox.h}`,
  )
  assert.ok(home.bbox.y < baselinePx, 'ink box must rise above the baseline')
  // ...and TOTAL is well below it, i.e. y grows downward like the raster.
  const total = r.words.find((w) => w.text === 'TOTAL')
  assert.ok(total && total.bbox.y > home.bbox.y, 'y must increase downward, as in image space')
})

test('geometry round-trips through the export inverse within a pixel', async () => {
  const p = await fixture('plain2.pdf', plainTextPdf())
  const r = await extractPdfPageText(p, 0, { dpi: DPI })
  assert.ok(r)
  const widthPx = Math.ceil(612 * (DPI / 72))
  const heightPx = Math.ceil(792 * (DPI / 72))
  const w = r.words[0]
  assert.ok(w)
  // master -> PDF points -> back. masterBBoxToPdfText is the dual of what this
  // module does; if the two disagree, one of them has the flip wrong.
  const placed = masterBBoxToPdfText(w.bbox, widthPx, heightPx, 0, 72 / DPI)
  const pt = 72 / DPI
  assert.ok(Math.abs(placed.x - w.bbox.x * pt) < 1, `x round-trip: ${placed.x} vs ${w.bbox.x * pt}`)
  // y is the PDF baseline, measured from the bottom: the box's lower edge.
  const expectedBaseline = (heightPx - (w.bbox.y + w.bbox.h)) * pt
  assert.ok(
    Math.abs(placed.y - expectedBaseline) < 1,
    `y flip round-trip: ${placed.y} vs ${expectedBaseline}`,
  )
  assert.ok(placed.size > 0, 'font size derived')
})

test('a /Rotate 90 page maps into the rotated raster, not the unrotated page', async () => {
  const p = await fixture('rot90.pdf', rotated90Pdf())
  const r = await extractPdfPageText(p, 0, { dpi: DPI })
  assert.ok(r, 'rotated layer should be usable')
  // The rasterizer's viewport swaps the axes for /Rotate 90, so the master is
  // 2200x1700. Boxes computed with a hand-rolled "792 - f" would fall outside.
  const widthPx = Math.ceil(792 * (DPI / 72))
  const heightPx = Math.ceil(612 * (DPI / 72))
  for (const w of r.words) {
    assert.ok(
      w.bbox.x >= 0 && w.bbox.x + w.bbox.w <= widthPx + 1,
      `rotated box outside master width: ${JSON.stringify(w.bbox)}`,
    )
    assert.ok(
      w.bbox.y >= 0 && w.bbox.y + w.bbox.h <= heightPx + 1,
      `rotated box outside master height: ${JSON.stringify(w.bbox)}`,
    )
  }
})

test('a sparse two-line receipt on a full page is accepted, not refused', async () => {
  // Regression for the execution audit's D1: demanding 4+ text rows and 2% page
  // coverage on any tall page threw away the fast path for the most ordinary
  // scan there is — a parking stub on US Letter.
  const p = await fixture('short.pdf', shortReceiptPdf())
  const r = await extractPdfPageText(p, 0, { dpi: DPI })
  assert.ok(r, 'a short receipt layer must still be usable')
  assert.match(r.text, /PARKING METER/)
  assert.match(r.text, /TOTAL 4\.00/)
})

test('a real word space is not swallowed by the merge threshold', async () => {
  // D2: the merge gap must reassemble split glyph runs WITHOUT gluing genuine
  // words. 12pt Helvetica's space is 3.3pt while its median char is ~6pt, so a
  // char-width-only threshold merged real spaces.
  const p = await fixture('short2.pdf', shortReceiptPdf())
  const r = await extractPdfPageText(p, 0, { dpi: DPI })
  assert.ok(r)
  const words = r.words.map((w) => w.text)
  assert.ok(words.includes('TOTAL'), `TOTAL must stay its own token, got ${JSON.stringify(words)}`)
  assert.ok(words.includes('4.00'), `the amount must stay separate, got ${JSON.stringify(words)}`)
})

test('the gate rejects zero-area and junk layers', () => {
  const page = { widthPx: 1700, heightPx: 2200 }
  assert.equal(isLayerUsable([], page).usable, false)

  const zero = [{ text: 'TOTAL', bbox: { x: 10, y: 10, w: 0, h: 12 } }]
  assert.equal(isLayerUsable(zero, page).usable, false)

  // Sized to cover plenty of page, so the ALPHANUMERIC gate is what fires here
  // rather than the coverage gate — otherwise this test would pass for the
  // wrong reason.
  const junk = Array.from({ length: 40 }, (_, i) => ({
    text: '§¶‡†◊§¶‡†◊',
    bbox: { x: 100, y: 30 + i * 52, w: 1200, h: 40 },
  }))
  const v = isLayerUsable(junk, page)
  assert.equal(v.usable, false)
  assert.match(v.usable === false ? v.reason : '', /junk|alphanumeric/i)

  // Relaxing the thresholds for sparse layers must not open a hole: a handful
  // of tokens stacked on one point is still degenerate.
  const collapsed = Array.from({ length: 5 }, () => ({
    text: 'TOTAL 4.00',
    bbox: { x: 200, y: 300, w: 180, h: 30 },
  }))
  assert.equal(isLayerUsable(collapsed, page).usable, false)
})

test('normalisation strips the artefacts OCR output never has', () => {
  assert.equal(normalizePdfText('co­operate'), 'cooperate') // soft hyphen
  assert.equal(normalizePdfText('A B'), 'A B') // NBSP
  assert.equal(normalizePdfText('ﬁne'), 'fine') // ligature
  assert.equal(normalizePdfText('ＴＯＴＡＬ'), 'TOTAL') // full-width
})
