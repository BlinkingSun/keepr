/**
 * Money parsing table test — formats from LANE-B-SPEC.
 * Run: node --experimental-strip-types --test src/ocr/__tests__/money.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseMoney, findMoneyInText } from '../parse/money.ts'

describe('parseMoney', () => {
  const cases: Array<{ in: string; minor: number; note?: string }> = [
    { in: '1,234.56', minor: 123456, note: 'US thousands + decimal' },
    { in: '1.234,56', minor: 123456, note: 'EU thousands + decimal' },
    { in: '$84.37', minor: 8437 },
    { in: '84.37-', minor: -8437, note: 'trailing minus' },
    { in: '84,37', minor: 8437, note: 'EU decimal comma only' },
    { in: '8437', minor: 8437, note: 'OCR dropped decimal → cents' },
    { in: 'S4.37', minor: 437, note: 'OCR $ → S' },
    { in: '($12.50)', minor: -1250, note: 'accounting parens' },
    { in: '-9.99', minor: -999 },
    { in: '€10,50', minor: 1050 },
    { in: 'USD 20.00', minor: 2000 },
    { in: '0.01', minor: 1 },
    { in: '100', minor: 100, note: '3-digit bare integer: last 2 as cents → $1.00' },
  ]

  for (const c of cases) {
    it(`${c.in} → ${c.minor}${c.note ? ' (' + c.note + ')' : ''}`, () => {
      const r = parseMoney(c.in)
      assert.ok(r, `expected parse for ${c.in}`)
      assert.equal(r!.minor, c.minor)
    })
  }

  it('returns null for empty / non-money', () => {
    assert.equal(parseMoney(''), null)
    assert.equal(parseMoney('TOTAL'), null)
    assert.equal(parseMoney('abc'), null)
  })

  it('findMoneyInText picks a decimal amount from a line', () => {
    const r = findMoneyInText('TOTAL  $81.43  USD')
    assert.ok(r)
    assert.equal(r!.minor, 8143)
  })
})

// Added after the wave-2 execution audit. A bare integer on a labelled line is
// read literally: "TOTAL 100" is one hundred dollars. Previously it parsed as
// $1.00 by assuming OCR had dropped a decimal — a 100x error on the single most
// important field, and a plausible-looking one, which is the worst combination.
it('labelled bare integers are read as major units, not cents', () => {
  assert.equal(findMoneyInText('TOTAL 100', { labelled: true })?.minor, 10000)
  assert.equal(findMoneyInText('TOTAL 1000', { labelled: true })?.minor, 100000)
  assert.equal(findMoneyInText('AMOUNT DUE 25', { labelled: true })?.minor, 2500)
  // Decimal amounts are unaffected and keep their high confidence.
  assert.equal(findMoneyInText('TOTAL 84.37', { labelled: true })?.minor, 8437)
  assert.equal(findMoneyInText('TOTAL 84.37', { labelled: true })?.confidence, 0.95)
})

it('unlabelled bare integers still assume a dropped decimal', () => {
  // Free-floating OCR noise is likelier to be a lost decimal point than a
  // round total, so this reading is retained — at low confidence.
  assert.equal(parseMoney('8437')?.minor, 8437)
  assert.ok((parseMoney('8437')?.confidence ?? 1) < 0.75, 'must sit below the amber threshold')
})

it('ambiguous money never reaches the high-confidence band', () => {
  // Both readings of a bare integer are guesses. Neither may present itself as
  // trustworthy, because the Inbox lets the user bulk-accept.
  for (const s of ['100', '8437', '25', '1234']) {
    const r = parseMoney(s)
    assert.ok(r, `${s} should parse`)
    assert.ok(r!.confidence < 0.75, `${s} confidence ${r!.confidence} must stay under 0.75`)
  }
  const labelled = findMoneyInText('TOTAL 100', { labelled: true })
  assert.ok(labelled!.confidence < 0.75, 'labelled bare integer is still a guess')
})
