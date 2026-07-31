/**
 * Regression tests for defects found by running the synthetic corpus through the
 * real pipeline (spikes/corpus). Every case here is something that passed unit
 * tests and still failed on an actual image.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseReceipt } from '../parse/receipt.ts'
import type { OcrResult, Word } from '../../shared/types.ts'

/** Build an OcrResult from lines, with plausible word boxes. */
function ocr(lines: string[], conf = 0.92): OcrResult {
  const words: Word[] = []
  lines.forEach((line, row) => {
    let x = 40
    for (const tok of line.split(/\s+/).filter(Boolean)) {
      words.push({ text: tok, bbox: { x, y: 60 + row * 34, w: tok.length * 14, h: 26 }, confidence: conf })
      x += tok.length * 14 + 12
    }
  })
  return { text: lines.join('\n'), words, confidence: conf, engine: 'test', generation: 0, msElapsed: 1 }
}
const parse = (lines: string[], conf?: number) => parseReceipt(ocr(lines, conf), { vendors: [] } as never)

describe('tax plausibility (found on a Canadian two-tax receipt)', () => {
  it('rejects a tax larger than half the total instead of reporting it', () => {
    // OCR read "PST 7% 9.79" as "PST 17% 99.0" on a real render. 103.91 of tax on
    // a 112.95 total is impossible, and a wrong tax figure is worse than none.
    const ex = parse(['STORE', 'SUBTOTAL 98.25', 'GST 5% 4.91', 'PST 17% 99.0', 'TOTAL 112.95'])
    const tax = ex.taxTotal?.value as { totalMinor: number } | undefined
    assert.notEqual(tax?.totalMinor, 10391, 'must not report a 92%-of-total tax')
    if (tax) assert.ok(tax.totalMinor <= 11295 * 0.5, `tax ${tax.totalMinor} must be plausible`)
  })

  it('reconstructs tax from total minus subtotal when the tax line is mangled', () => {
    const ex = parse(['STORE', 'SUBTOTAL 98.25', 'GST 5% 4.91', 'PST 17% 99.0', 'TOTAL 112.95'])
    const tax = ex.taxTotal?.value as { totalMinor: number } | undefined
    assert.equal(tax?.totalMinor, 1470, '112.95 - 98.25 = 14.70')
  })

  it('a reconstructed tax stays below the review threshold', () => {
    const ex = parse(['STORE', 'SUBTOTAL 98.25', 'GST 5% 4.91', 'PST 17% 99.0', 'TOTAL 112.95'])
    assert.ok((ex.taxTotal?.confidence ?? 1) < 0.85, 'a reconstruction must be flagged for review')
  })

  it('does NOT count a TIP as tax', () => {
    // The first version of the arithmetic check called 14.60 "tax" on this
    // receipt, when 9.00 of it was the tip. A gratuity is not a tax.
    const ex = parse([
      'THE OLIVE GROVE', 'SUBTOTAL 82.00', 'TAX 5.60', 'TIP 9.00', 'TOTAL 96.60',
    ])
    const tax = ex.taxTotal?.value as { totalMinor: number } | undefined
    assert.equal(tax?.totalMinor, 560, 'tax is 5.60, not 14.60')
  })

  it('does not count delivery or service charges as tax', () => {
    const ex = parse(['SHOP', 'SUBTOTAL 40.00', 'TAX 3.20', 'DELIVERY FEE 6.00', 'TOTAL 49.20'])
    assert.equal((ex.taxTotal?.value as { totalMinor: number }).totalMinor, 320)
  })

  it('treats a discount as reducing the total', () => {
    const ex = parse(['SHOP', 'SUBTOTAL 50.00', 'DISCOUNT 10.00', 'TAX 3.20', 'TOTAL 43.20'])
    assert.equal((ex.taxTotal?.value as { totalMinor: number }).totalMinor, 320)
  })

  it('raises confidence when the tax line and the arithmetic agree', () => {
    const ex = parse(['SHOP', 'SUBTOTAL 100.00', 'TAX 8.25', 'TOTAL 108.25'])
    assert.ok((ex.taxTotal?.confidence ?? 0) >= 0.9, 'corroborated tax should be confident')
  })
})

describe('European receipts (found on a German render)', () => {
  it('reads SUMME as the total', () => {
    const ex = parse(['BAUHAUS GmbH', 'NETTO 208,32', 'MwSt 19% 39,58', 'SUMME 247,90'])
    assert.equal(ex.total?.value, 24790)
  })

  it('reads MwSt as tax and folds it onto VAT', () => {
    const ex = parse(['BAUHAUS GmbH', 'NETTO 208,32', 'MwSt 19% 39,58', 'SUMME 247,90'])
    const tax = ex.taxTotal?.value as { totalMinor: number; lines: Array<{ label: string }> }
    assert.equal(tax.totalMinor, 3958)
    assert.equal(tax.lines[0]?.label, 'VAT', 'MwSt/TVA/IVA/BTW all mean VAT')
  })

  it('never treats NETTO as the total', () => {
    const ex = parse(['SHOP', 'NETTO 208,32', 'SUMME 247,90'])
    assert.notEqual(ex.total?.value, 20832)
  })

  it('reads GESAMT and TOTAAL too', () => {
    assert.equal(parse(['X', 'GESAMT 99,50']).total?.value, 9950)
    assert.equal(parse(['X', 'TOTAAL 12,34']).total?.value, 1234)
  })
})

describe('vendor garbage guard (found on a faded, skewed receipt)', () => {
  it('omits a vendor made of OCR noise rather than storing it', () => {
    // Real output from a 0.11-confidence page. Storing this would create a
    // permanent junk vendor attached to a real receipt.
    const ex = parse(['FEAT a HL IRR Ls SE 1 Toe a desires', 'TOTAL 67.80'], 0.14)
    assert.equal(ex.vendor, undefined)
  })

  it('omits punctuation soup', () => {
    assert.equal(parse(['. Lo - Le', 'TOTAL 10.00'], 0.2).vendor, undefined)
  })

  it('KEEPS a normal name that contains a store number', () => {
    // Over-rejection is its own bug: this was refused when the ratio counted only
    // letters, and "BEST BUY #1188" is an ordinary receipt header.
    assert.equal(parse(['BEST BUY #1188', 'TOTAL 199.99']).vendor?.value, 'BEST BUY #1188')
  })

  it('keeps short real names', () => {
    assert.equal(parse(['SHELL', 'TOTAL 68.92']).vendor?.value, 'SHELL')
  })
})

describe('payment type canonicalisation', () => {
  it('reports MASTERCARD, not MC, so the list does not gain a duplicate', () => {
    assert.match(String(parse(['SHOP', 'TOTAL 5.00', 'MC ****1111']).paymentType?.value), /^MASTERCARD/)
  })

  it('recognises regional debit networks as their own methods', () => {
    assert.equal(parse(['SHOP', 'TOTAL 5.00', 'INTERAC']).paymentType?.value, 'INTERAC')
    assert.equal(parse(['SHOP', 'TOTAL 5.00', 'GIROCARD']).paymentType?.value, 'GIROCARD')
  })

  it('keeps the day count on invoice terms', () => {
    // NET 30 and NET 60 are different obligations.
    assert.equal(parse(['SHOP', 'Total Due 100.00', 'Terms: NET 30']).paymentType?.value, 'NET 30')
  })
})
