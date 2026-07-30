/**
 * Spec edge cases: SUBTOTAL trap, double TOTAL, no total, negative total.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseReceipt, ocrFromText } from '../parse/receipt.ts'

describe('receipt edge cases', () => {
  it('SUBTOTAL 75.22 / TAX 6.21 / TOTAL 81.43 extracts 8143 not 7522', () => {
    const text = `
STORE
SUBTOTAL 75.22
TAX 6.21
TOTAL 81.43
`.trim()
    const ext = parseReceipt(ocrFromText(text), {})
    assert.ok(ext.total)
    assert.equal(ext.total!.value, 8143)
    assert.notEqual(ext.total!.value, 7522)
  })

  it('TOTAL appearing twice returns one value (bottom/larger labelled TOTAL)', () => {
    // Reasoning documented: when TOTAL appears twice (dept + grand), prefer
    // the highest-scoring labelled TOTAL near the bottom; on label-score ties
    // prefer the larger amount among non-SUBTOTAL TOTAL lines.
    const text = `
SHOP
Item A 10.00
TOTAL 10.00
Item B 5.00
SUBTOTAL 15.00
TAX 1.20
TOTAL 16.20
`.trim()
    const ext = parseReceipt(ocrFromText(text), {})
    assert.ok(ext.total)
    assert.equal(ext.total!.value, 1620)
  })

  it('receipt with no total omits total entirely (not 0)', () => {
    const text = `
SHOP
2026-01-01
Hello world
No amounts here
`.trim()
    const ext = parseReceipt(ocrFromText(text), {})
    assert.equal(ext.total, undefined)
    assert.ok(!('total' in ext) || ext.total === undefined)
  })

  it('negative/refund total parses to negative MinorUnits', () => {
    const text = `
SHOP
RETURN
TOTAL -12.50
`.trim()
    const ext = parseReceipt(ocrFromText(text), {})
    assert.ok(ext.total)
    assert.equal(ext.total!.value, -1250)
    assert.ok(ext.total!.value < 0)
  })

  it('TIP is not selected as total when TOTAL is present', () => {
    const text = `
REST
SUBTOTAL 40.00
TAX 3.20
TIP 8.00
TOTAL 51.20
`.trim()
    const ext = parseReceipt(ocrFromText(text), {})
    assert.ok(ext.total)
    assert.equal(ext.total!.value, 5120)
  })
})
