/**
 * Money formatting: integer minor units only, currency per row.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatMoney } from '../money.ts'

describe('formatMoney', () => {
  it('8437 → "$84.37"', () => {
    assert.equal(formatMoney(8437, 'USD'), '$84.37')
  })

  it('-8437 → "-$84.37"', () => {
    assert.equal(formatMoney(-8437, 'USD'), '-$84.37')
  })

  it('null → "—"', () => {
    assert.equal(formatMoney(null), '—')
    assert.equal(formatMoney(undefined), '—')
  })

  it('123456789 → "$1,234,567.89"', () => {
    assert.equal(formatMoney(123456789, 'USD'), '$1,234,567.89')
  })

  it('EUR renders with its own symbol', () => {
    assert.equal(formatMoney(8437, 'EUR'), '€84.37')
    assert.equal(formatMoney(1050, 'EUR'), '€10.50')
  })

  it('zero and small amounts', () => {
    assert.equal(formatMoney(0, 'USD'), '$0.00')
    assert.equal(formatMoney(1, 'USD'), '$0.01')
    assert.equal(formatMoney(100, 'USD'), '$1.00')
  })

  it('does not assume USD when currency is GBP', () => {
    assert.equal(formatMoney(999, 'GBP'), '£9.99')
  })
})
