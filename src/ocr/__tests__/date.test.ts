/**
 * Date parsing — ambiguous confidence must drop.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseDate, findDateInText, resolveDateOrder } from '../parse/date.ts'

describe('parseDate', () => {
  it('parses ISO civil dates with high confidence', () => {
    const r = parseDate('2026-07-30')
    assert.ok(r)
    assert.equal(r!.civil, '2026-07-30')
    assert.ok(r!.confidence >= 0.9)
    assert.equal(r!.ambiguous, false)
  })

  it('parses named months unambiguously', () => {
    const r = parseDate('30 Jul 2026')
    assert.ok(r)
    assert.equal(r!.civil, '2026-07-30')
    assert.equal(r!.ambiguous, false)
  })

  it('ambiguous 03/04/2026 is lower confidence than unambiguous 13/04/2026', () => {
    const ambiguous = parseDate('03/04/2026', { dateOrder: 'MDY' })
    const unambiguous = parseDate('13/04/2026', { dateOrder: 'MDY' })
    assert.ok(ambiguous)
    assert.ok(unambiguous)
    assert.equal(ambiguous!.civil, '2026-03-04') // MDY
    assert.equal(unambiguous!.civil, '2026-04-13') // day 13 forces DMY
    assert.ok(
      ambiguous!.confidence < unambiguous!.confidence,
      `expected ambiguous ${ambiguous!.confidence} < unambiguous ${unambiguous!.confidence}`,
    )
    assert.equal(ambiguous!.ambiguous, true)
    assert.equal(unambiguous!.ambiguous, false)
  })

  it('locale en-GB resolves 03/04/2026 as DMY', () => {
    const r = parseDate('03/04/2026', { locale: 'en-GB' })
    assert.ok(r)
    assert.equal(r!.civil, '2026-04-03')
    assert.equal(r!.ambiguous, true) // still ambiguous day/month swap
  })

  it('resolveDateOrder maps locales', () => {
    assert.equal(resolveDateOrder({ locale: 'en-US' }), 'MDY')
    assert.equal(resolveDateOrder({ locale: 'en-GB' }), 'DMY')
    assert.equal(resolveDateOrder({ locale: 'de-DE' }), 'DMY')
  })

  it('findDateInText finds a date in a line', () => {
    const r = findDateInText('Date: 2026-01-15 Store #12')
    assert.ok(r)
    assert.equal(r!.civil, '2026-01-15')
  })

  it('rejects impossible calendar dates', () => {
    assert.equal(parseDate('2026-02-31'), null)
    assert.equal(parseDate('13/13/2026'), null)
  })
})
