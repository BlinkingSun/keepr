/**
 * 12-fixture receipt extraction corpus.
 * Asserts total / date / vendor (and key edge fields) field by field.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseReceipt, ocrFromText } from '../parse/receipt.ts'

interface Fixture {
  name: string
  text: string
  hints?: { vendors?: string[]; locale?: string }
  expect: {
    total?: number | null // null means must be omitted
    txnDate?: string
    vendor?: string
    taxLabels?: string[]
    paymentType?: string
    externalRef?: string
  }
}

const fixtures: Fixture[] = [
  {
    name: '01 thermal grocery',
    text: `
WHOLE FOODS MARKET
123 Market St
Date: 2026-03-12
BANANA ORGANIC          1.29
MILK 1GAL               4.59
BREAD SOURDOUGH         5.49
SUBTOTAL               11.37
TAX                     0.91
TOTAL                  12.28
VISA ****4242
Thank you
`.trim(),
    hints: { vendors: ['Whole Foods Market', 'Costco'] },
    expect: {
      total: 1228,
      txnDate: '2026-03-12',
      vendor: 'Whole Foods Market',
      paymentType: 'VISA',
    },
  },
  {
    name: '02 fuel receipt',
    text: `
SHELL STATION #4421
Pump 3
03/18/2026 14:22
UNL REG 12.401 GAL @ 3.499
FUEL TOTAL              43.40
TOTAL                    43.40
MASTERCARD ****1111
AUTH: 882911
`.trim(),
    hints: { vendors: ['Shell', 'Chevron'], locale: 'en-US' },
    expect: {
      total: 4340,
      txnDate: '2026-03-18',
      vendor: 'Shell',
      paymentType: 'MC',
    },
  },
  {
    name: '03 hardware multi-tax',
    text: `
HOME DEPOT
Invoice #HD-908812
Date 2026-04-01
Hammer 16oz             14.97
Screws assorted          8.44
SUBTOTAL                23.41
GST 5%                   1.17
PST 7%                   1.64
TOTAL                   26.22
DEBIT
`.trim(),
    hints: { vendors: ['Home Depot', 'Lowe\'s'] },
    expect: {
      total: 2622,
      txnDate: '2026-04-01',
      vendor: 'Home Depot',
      taxLabels: ['GST', 'PST'],
      paymentType: 'DEBIT',
      externalRef: 'HD-908812',
    },
  },
  {
    name: '04 restaurant with tip',
    text: `
OLIVE GARDEN
Guest check
Apr 20, 2026
Fettuccine Alfredo      18.99
Salad & Breadsticks      0.00
SUBTOTAL                18.99
TAX                      1.71
TIP                      4.00
TOTAL                   24.70
AMEX ****1005
`.trim(),
    hints: { vendors: ['Olive Garden'] },
    expect: {
      total: 2470,
      txnDate: '2026-04-20',
      vendor: 'Olive Garden',
      paymentType: 'AMEX',
    },
  },
  {
    name: '05 SUBTOTAL above TOTAL trap',
    text: `
ACME HARDWARE
2026-05-01
Widgets x3              60.00
Gizmos x1               15.22
SUBTOTAL                75.22
TAX                      6.21
TOTAL                   81.43
CASH
`.trim(),
    hints: { vendors: ['Acme Hardware'] },
    expect: {
      total: 8143, // NOT 7522
      txnDate: '2026-05-01',
      vendor: 'Acme Hardware',
    },
  },
  {
    name: '06 European format',
    text: `
BÄCKER SCHMIDT
Datum: 15.03.2026
Brot                     3,50
Kaffee                   2,80
ZWISCHENSUMME            6,30
MwSt 19%                 1,20
TOTAL                    7,50
EC KARTE
`.trim(),
    hints: { vendors: ['Bäcker Schmidt'], locale: 'de-DE' },
    expect: {
      total: 750,
      txnDate: '2026-03-15',
      vendor: 'Bäcker Schmidt',
    },
  },
  {
    name: '07 refund negative total',
    text: `
TARGET
Return Receipt
2026-06-10
RETURN Blender         -49.99
TAX                     -4.12
TOTAL                  -54.11
VISA ****2222
`.trim(),
    hints: { vendors: ['Target'] },
    expect: {
      total: -5411,
      txnDate: '2026-06-10',
      vendor: 'Target',
    },
  },
  {
    name: '08 no discernible total',
    text: `
SOME SHOP
2026-07-01
Item A
Item B
Item C
Have a nice day
`.trim(),
    hints: { vendors: ['Some Shop'] },
    expect: {
      total: null,
      txnDate: '2026-07-01',
      vendor: 'Some Shop',
    },
  },
  {
    name: '09 low-quality / OCR noise',
    text: `
C0STCO WHSE
Date 07/11/2026
WATER 40PK              S12.99
ORG MILK                 5.49
SUBT0TAL                18.48
TAX                      1.48
T0TAL                   19.96
`.trim(),
    hints: { vendors: ['Costco'], locale: 'en-US' },
    expect: {
      total: 1996, // T0TAL OCR noise must still win over SUBT0TAL
      txnDate: '2026-07-11',
      vendor: 'Costco',
    },
  },
  {
    name: '10 double TOTAL — prefer bottom / larger labelled',
    // Reasoning: two TOTAL lines appear (department total + grand). Prefer the
    // labelled TOTAL nearer the bottom; when label scores tie, prefer the
    // larger amount among pure TOTAL lines (not SUBTOTAL).
    text: `
BEST BUY
2026-08-02
Laptop                 899.00
TOTAL                  899.00
Protection plan         99.00
SUBTOTAL               998.00
TAX                     79.84
TOTAL                 1077.84
VISA
`.trim(),
    hints: { vendors: ['Best Buy'] },
    expect: {
      total: 107784,
      txnDate: '2026-08-02',
      vendor: 'Best Buy',
    },
  },
  {
    name: '11 balance due / amount due',
    text: `
CITY UTILITIES
Account 99102
Bill date: 2026-09-01
Electric               62.10
Water                  18.40
AMOUNT DUE             80.50
CHECK
`.trim(),
    hints: { vendors: ['City Utilities'] },
    expect: {
      total: 8050,
      txnDate: '2026-09-01',
      vendor: 'City Utilities',
      paymentType: 'CHECK',
    },
  },
  {
    name: '12 VAT restaurant Europe',
    text: `
CAFE NORD
12/03/2026
Croissant               2,40
Cafe creme              3,60
TOTAL                   6,00
TVA 10%                 0,55
CB VISA
`.trim(),
    hints: { vendors: ['Cafe Nord'], locale: 'fr-FR' },
    expect: {
      total: 600,
      txnDate: '2026-03-12', // DMY
      vendor: 'Cafe Nord',
    },
  },
]

describe('receipt fixture corpus (12)', () => {
  let correctTriple = 0

  for (const fix of fixtures) {
    it(fix.name, () => {
      const ocr = ocrFromText(fix.text)
      const ext = parseReceipt(ocr, fix.hints ?? {})

      if (fix.expect.total === null) {
        assert.equal(ext.total, undefined, 'total must be omitted')
      } else if (fix.expect.total !== undefined) {
        assert.ok(ext.total, `expected total ${fix.expect.total}`)
        assert.equal(ext.total!.value, fix.expect.total)
      }

      if (fix.expect.txnDate) {
        assert.ok(ext.txnDate, 'expected txnDate')
        assert.equal(ext.txnDate!.value, fix.expect.txnDate)
      }

      if (fix.expect.vendor) {
        assert.ok(ext.vendor, 'expected vendor')
        assert.ok(
          String(ext.vendor!.value).toLowerCase().includes(fix.expect.vendor.toLowerCase()) ||
            fix.expect.vendor.toLowerCase().includes(String(ext.vendor!.value).toLowerCase()),
          `vendor got ${ext.vendor!.value}`,
        )
      }

      if (fix.expect.taxLabels) {
        assert.ok(ext.taxTotal, 'expected taxTotal')
        const val = ext.taxTotal!.value as { lines: Array<{ label: string }> }
        const labels = val.lines.map((l) => l.label)
        for (const lab of fix.expect.taxLabels) {
          assert.ok(labels.includes(lab), `missing tax label ${lab} in ${labels.join(',')}`)
        }
      }

      if (fix.expect.paymentType) {
        assert.ok(ext.paymentType, 'expected paymentType')
        assert.ok(
          String(ext.paymentType!.value).toUpperCase().startsWith(fix.expect.paymentType),
          `payment ${ext.paymentType!.value}`,
        )
      }

      if (fix.expect.externalRef) {
        assert.ok(ext.externalRef)
        assert.equal(ext.externalRef!.value, fix.expect.externalRef)
      }

      // Accuracy: total + date + vendor all correct for this fixture.
      // Omitted total (null expect) counts as correct when field is absent.
      const totalOk =
        fix.expect.total === null
          ? ext.total === undefined
          : fix.expect.total === undefined
            ? true
            : ext.total != null && ext.total.value === fix.expect.total
      const dateOk =
        !fix.expect.txnDate ||
        (ext.txnDate != null && ext.txnDate.value === fix.expect.txnDate)
      const vendorOk =
        !fix.expect.vendor ||
        (ext.vendor != null &&
          (String(ext.vendor.value).toLowerCase().includes(fix.expect.vendor!.toLowerCase()) ||
            fix.expect.vendor!.toLowerCase().includes(String(ext.vendor.value).toLowerCase())))
      if (totalOk && dateOk && vendorOk) correctTriple++
    })
  }

  it('reports extraction accuracy for the report', () => {
    // correctTriple is accumulated above; with node:test order is sequential in this file
    console.log(`EXTRACTION_ACCURACY_TRIPLE=${correctTriple}/12`)
    assert.ok(correctTriple >= 0)
  })
})

// Fix fixture 02 hints typing — dateOrder via ParseHints
// (re-export handled by cast above)
