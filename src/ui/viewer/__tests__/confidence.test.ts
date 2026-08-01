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
  // These originally asserted 0.78 was flagged, from a mockup that happened to
  // show 78%. Measuring a real corpus showed correct extractions run 0.55-0.96 —
  // vendor sits at 0.79 when it is RIGHT — so flagging 0.78 marked 11 of 12
  // correct receipts as uncertain. The threshold is now 0.5, derived from that
  // data, and these tests follow the calibration rather than the picture.
  it('a genuinely poor read renders its percentage', () => {
    const s = formatConfidence(0.42)
    assert.ok(s != null)
    assert.ok(s!.includes('42%'), `expected "42%" in ${s}`)
    assert.equal(s, '42% match')
    assert.equal(formatConfidencePercent(0.42), '42%')
  })

  it('0.78 renders NOTHING — that is what a correct vendor read scores', () => {
    assert.equal(formatConfidence(0.78), null)
    assert.ok(0.78 >= CONFIDENCE_THRESHOLD)
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
    // Expressed relative to the constant so a future recalibration does not
    // silently invalidate the test.
    const justBelow = CONFIDENCE_THRESHOLD - 0.01
    assert.equal(formatConfidence(justBelow), `${Math.round(justBelow * 100)}% match`)
  })
})
