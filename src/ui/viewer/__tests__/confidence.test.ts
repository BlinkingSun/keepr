/**
 * Confidence display formatting.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatConfidence,
  formatConfidencePercent,
  CONFIDENCE_THRESHOLD,
} from '../confidence.ts'

describe('formatConfidence', () => {
  it('0.78 renders "78%" (as "78% match")', () => {
    const s = formatConfidence(0.78)
    assert.ok(s != null)
    assert.ok(s!.includes('78%'), `expected "78%" in ${s}`)
    assert.equal(s, '78% match')
    assert.equal(formatConfidencePercent(0.78), '78%')
  })

  it('0.9 renders nothing (above threshold)', () => {
    assert.equal(formatConfidence(0.9), null)
    assert.equal(formatConfidencePercent(0.9), null)
    assert.ok(0.9 >= CONFIDENCE_THRESHOLD)
  })

  it('null renders nothing', () => {
    assert.equal(formatConfidence(null), null)
    assert.equal(formatConfidence(undefined), null)
    assert.equal(formatConfidencePercent(null), null)
  })

  it('exactly at threshold — no badge', () => {
    assert.equal(formatConfidence(CONFIDENCE_THRESHOLD), null)
  })

  it('just below threshold shows percent', () => {
    assert.equal(formatConfidence(0.849), '85% match')
  })
})
