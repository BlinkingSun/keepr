import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeVendorName, vendorMatchKey } from '../normalize.ts'

describe('normalizeVendorName', () => {
  const same = (a: string, b: string) =>
    assert.equal(normalizeVendorName(a), normalizeVendorName(b), `${a!} should match ${b!}`)
  const differ = (a: string, b: string) =>
    assert.notEqual(normalizeVendorName(a), normalizeVendorName(b), `${a!} should NOT match ${b!}`)

  it('collapses case and trailing punctuation', () => {
    same('Home Depot', 'HOME DEPOT')
    same('Home Depot', 'Home Depot.')
  })

  // The regression that started this: an end-to-end import created a duplicate
  // vendor because the store number survived normalization, so the seeded
  // vendor's default category never applied.
  it('strips a bare store number (the reported bug)', () => {
    same('HOME DEPOT #4821', 'Home Depot')
    assert.equal(normalizeVendorName('HOME DEPOT #4821'), 'home depot')
  })

  it('strips explicit outlet markers', () => {
    same('Target Store #1234', 'Target')
    same('Costco Wholesale #487', 'Costco Wholesale')
    same('Shell STR 9931', 'Shell')
    same('Kroger LOC# 55', 'Kroger')
  })

  it('strips a trailing 3+ digit store number', () => {
    same('ACE HARDWARE 3842', 'Ace Hardware')
    same('Chevron 10422', 'Chevron')
  })

  it('normalizes hyphens and spacing to the same words', () => {
    same('Wal-Mart', 'Wal Mart')
    assert.equal(normalizeVendorName('Wal-Mart'), 'wal mart')
  })

  it('ignores legal suffixes', () => {
    same('Grainger Inc', 'Grainger')
    same('Fastenal Company', 'Fastenal')
    same('Acme Ltd.', 'Acme')
  })

  // Over-stripping is the real risk. Numbers carry meaning in plenty of names.
  it('does NOT strip a leading number', () => {
    assert.equal(normalizeVendorName('7-Eleven'), '7 eleven')
    assert.equal(normalizeVendorName('99 Ranch Market'), '99 ranch market')
  })

  it('does NOT reduce an all-numeric name to nothing', () => {
    assert.equal(normalizeVendorName('76'), '76')
    assert.notEqual(normalizeVendorName('76'), '')
  })

  it('keeps a short trailing number that is part of the brand', () => {
    // Two digits is below the store-number threshold, so this survives.
    assert.equal(normalizeVendorName('Chevron 76'), 'chevron 76')
  })

  it('keeps genuinely different merchants apart', () => {
    differ('Home Depot', 'Office Depot')
    differ('Shell', 'Shell Oil Refining')
    differ('Ace Hardware', 'Ace Cafe')
  })

  it('survives OCR noise without collapsing to empty', () => {
    assert.ok(normalizeVendorName('  HOME   DEPOT  ***  ').length > 0)
    assert.equal(normalizeVendorName('  HOME   DEPOT  ***  '), 'home depot')
  })
})

describe('vendorMatchKey', () => {
  it('collapses spacing so WAL MART reaches Walmart', () => {
    assert.equal(vendorMatchKey('WAL MART'), vendorMatchKey('Walmart'))
    assert.equal(vendorMatchKey('Wal-Mart #1234'), vendorMatchKey('Walmart'))
  })

  it('still separates different merchants', () => {
    assert.notEqual(vendorMatchKey('Home Depot'), vendorMatchKey('Office Depot'))
  })
})
