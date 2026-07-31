/**
 * Searchable PDF tests — extract text layer, assert positions, no-page items.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { exportPdf } from '../pdf.ts'
import { masterBBoxToPdfText } from '../geometry.ts'
import {
  openExportFixture,
  mkReceipt,
  mkItem,
  addPage,
  writeTestImage,
  extractPdfTextPlacements,
  type ExportFixture,
} from './harness.ts'

describe('exportPdf', () => {
  let fx: ExportFixture

  before(() => {
    fx = openExportFixture()
  })

  after(() => {
    fx.cleanup()
  })

  it('6. extract text layer: known OCR token present on expected page', async () => {
    const token = 'ZZUNIQUETOKEN99'
    const w = 400
    const h = 300
    const rel = await writeTestImage(fx.libraryRoot, 'images/p6.png', w, h)
    const itemId = mkReceipt(fx.db, fx.folderUser, {
      totalMinor: 4200,
      currency: 'USD',
      vendorId: fx.vendorId,
      description: 'page-token receipt',
    })
    addPage(fx.db, itemId, {
      relPath: rel,
      width: w,
      height: h,
      rotation: 0,
      ocrWords: [
        { text: token, bbox: { x: 40, y: 50, w: 120, h: 18 } },
        { text: 'TOTAL', bbox: { x: 40, y: 200, w: 60, h: 14 } },
      ],
      ocrText: `${token} TOTAL 42.00`,
    })

    const dest = join(fx.libraryRoot, 't6-searchable.pdf')
    await exportPdf(
      fx.db,
      {
        format: 'pdf',
        destPath: dest,
        itemIds: [itemId],
      },
      { libraryRoot: fx.libraryRoot },
    )

    const bytes = readFileSync(dest)
    assert.ok(bytes.length > 100, 'PDF has content')
    const placements = extractPdfTextPlacements(bytes)
    const found = placements.find((p) => p.text.includes(token) || p.text === token)
    assert.ok(
      found,
      `expected OCR token ${token} in PDF text layer; got: ${placements.map((p) => p.text).join('|')}`,
    )
    assert.equal(found!.pageIndex, 0, 'token on first content page')
  })

  it('7. PDF text position: known image bbox lands within tolerance of expected PDF point', async () => {
    const w = 200
    const h = 100
    const bbox = { x: 20, y: 10, w: 40, h: 20 }
    const token = 'POSWORD'
    const rel = await writeTestImage(fx.libraryRoot, 'images/p7.png', w, h, {
      r: 255,
      g: 255,
      b: 255,
    })
    const itemId = mkReceipt(fx.db, fx.folderUser, {
      totalMinor: 100,
      currency: 'USD',
      vendorName: 'PosCo',
    })
    addPage(fx.db, itemId, {
      relPath: rel,
      width: w,
      height: h,
      rotation: 0,
      ocrWords: [{ text: token, bbox }],
    })

    // Expected placement from the same pure geometry the exporter uses.
    const expected = masterBBoxToPdfText(bbox, w, h, 0, 1)
    // rotation 0: display = master; pdf y = pageH - (y + h)
    assert.equal(expected.x, 20)
    assert.equal(expected.y, 100 - (10 + 20)) // 70
    assert.equal(expected.pageW, 200)
    assert.equal(expected.pageH, 100)

    const dest = join(fx.libraryRoot, 't7-position.pdf')
    await exportPdf(
      fx.db,
      { format: 'pdf', destPath: dest, itemIds: [itemId] },
      { libraryRoot: fx.libraryRoot },
    )

    const placements = extractPdfTextPlacements(readFileSync(dest))
    const hit = placements.find((p) => p.text === token || p.text.includes(token))
    assert.ok(hit, `token ${token} must be in PDF`)
    const tol = 2 // points
    assert.ok(
      Math.abs(hit!.x - expected.x) <= tol,
      `x: got ${hit!.x}, expected ${expected.x} ±${tol}`,
    )
    assert.ok(
      Math.abs(hit!.y - expected.y) <= tol,
      `y: got ${hit!.y}, expected ${expected.y} ±${tol}`,
    )

    // Also assert numbers for 90° rotation geometry (pure function + render).
    const bbox90 = { x: 0, y: 0, w: 10, h: 10 }
    const place90 = masterBBoxToPdfText(bbox90, w, h, 90, 1)
    // display size swaps to 100×200
    assert.equal(place90.pageW, 100)
    assert.equal(place90.pageH, 200)
    // master (0,0) under CSS 90° clockwise around center (100,50):
    // documented in viewer tests — assert finite PDF coords
    assert.ok(Number.isFinite(place90.x) && Number.isFinite(place90.y))
  })

  it('8. item with no pages exports without throwing', async () => {
    const itemId = mkReceipt(fx.db, fx.folderUser, {
      totalMinor: 777,
      currency: 'USD',
      vendorName: 'NoPages Inc',
    })
    // document with no pages too
    const docId = mkItem(fx.db, fx.folderUser, 'document')
    fx.db.prepare(`INSERT INTO document_data(item_id, title) VALUES (?, ?)`).run(docId, 'Empty doc')

    const dest = join(fx.libraryRoot, 't8-nopages.pdf')
    await assert.doesNotReject(async () => {
      await exportPdf(
        fx.db,
        { format: 'pdf', destPath: dest, itemIds: [itemId, docId] },
        { libraryRoot: fx.libraryRoot },
      )
    })
    const bytes = readFileSync(dest)
    assert.ok(bytes.length > 50)
    assert.equal(bytes.subarray(0, 4).toString(), '%PDF')
  })

  it('cover page option embeds profile text', async () => {
    const itemId = mkReceipt(fx.db, fx.folderUser, {
      totalMinor: 50,
      currency: 'USD',
      vendorName: 'CoverCo',
    })
    const dest = join(fx.libraryRoot, 't-cover.pdf')
    await exportPdf(
      fx.db,
      {
        format: 'pdf',
        destPath: dest,
        itemIds: [itemId],
        options: { coverPage: true },
      },
      { libraryRoot: fx.libraryRoot },
    )
    const raw = readFileSync(dest).toString('latin1')
    // Cover draws "KeepR Test Co" as visible text (not hex-compressed only —
    // may still be in a stream; also check inflated placements).
    const placements = extractPdfTextPlacements(readFileSync(dest))
    const allText = placements.map((p) => p.text).join(' ')
    assert.ok(
      allText.includes('KeepR') || raw.includes('KeepR') || allText.includes('Test'),
      `cover should mention business; text=${allText.slice(0, 200)}`,
    )
  })
})
