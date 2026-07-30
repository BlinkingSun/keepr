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
