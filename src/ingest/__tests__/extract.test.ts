/**
 * Lane C extraction tests — acceptance 9.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractItem } from '../extract.ts'
import { ocrFromText } from '../../ocr/parse/receipt.ts'
import { openIngestFixture } from './harness.ts'

test('9. extraction fills an empty vendor but does not overwrite a pinned one', async () => {
  const fx = await openIngestFixture()
  try {
    const { itemId } = fx.repos.items.create({
      folderId: fx.folderInbox,
      type: 'receipt',
    })

    // --- empty vendor: should fill ---
    const ocr = ocrFromText(
      [
        'HOME DEPOT',
        '123 Main St',
        'Date: 07/12/2026',
        'Hammer    10.00',
        'TOTAL     10.00',
      ].join('\n'),
    )
    ocr.generation = 0

    const filled = extractItem(fx.deps, itemId, ocr, {
      vendors: ['Home Depot', 'Ace Hardware'],
    })
    assert.ok(filled.filled.includes('vendor'), `expected vendor filled, got ${JSON.stringify(filled)}`)

    const afterFill = fx.raw
      .prepare(
        `SELECT v.name AS vendor, r.extraction_json
           FROM receipt_data r
           LEFT JOIN vendor v ON v.id = r.vendor_id
          WHERE r.item_id = ?`,
      )
      .get(itemId) as { vendor: string | null; extraction_json: string | null }

    assert.ok(afterFill.vendor, 'vendor should be set')
    assert.match(afterFill.vendor!, /Home Depot|HOME DEPOT/i)

    // Pin the vendor as if the user corrected it.
    const pin = fx.repos.items.patch(itemId, { vendorName: 'User Pinned Co' })
    assert.equal(pin.ok, true)

    const pinnedRow = fx.raw
      .prepare(`SELECT extraction_json FROM receipt_data WHERE item_id = ?`)
      .get(itemId) as { extraction_json: string }
    const extraction = JSON.parse(pinnedRow.extraction_json) as {
      vendor?: { pinned?: boolean; value?: unknown }
    }
    assert.equal(extraction.vendor?.pinned, true)

    // Re-extract with a different vendor signal — must not overwrite.
    const ocr2 = ocrFromText(
      ['ACE HARDWARE', 'Date: 07/13/2026', 'TOTAL 5.00'].join('\n'),
    )
    ocr2.generation = 1
    const again = extractItem(fx.deps, itemId, ocr2, {
      vendors: ['Ace Hardware', 'Home Depot'],
    })
    assert.ok(
      again.skipped.some((s) => s.field === 'vendor' && s.reason === 'pinned'),
      `expected vendor skipped as pinned, got ${JSON.stringify(again)}`,
    )

    const final = fx.raw
      .prepare(
        `SELECT v.name AS vendor FROM receipt_data r
           JOIN vendor v ON v.id = r.vendor_id WHERE r.item_id = ?`,
      )
      .get(itemId) as { vendor: string }
    assert.equal(final.vendor, 'User Pinned Co')
  } finally {
    await fx.close()
  }
})
