/**
 * Page navigation clamp + rotation cycling.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { clampPageIndex, cycleRotation } from '../navigation.ts'

describe('clampPageIndex', () => {
  it('clamps at first and last rather than wrapping', () => {
    assert.equal(clampPageIndex(-1, 5), 0)
    assert.equal(clampPageIndex(0, 5), 0)
    assert.equal(clampPageIndex(4, 5), 4)
    assert.equal(clampPageIndex(5, 5), 4)
    assert.equal(clampPageIndex(99, 5), 4)
  })

  it('empty list stays at 0', () => {
    assert.equal(clampPageIndex(3, 0), 0)
  })

  it('does not wrap from last to first', () => {
    // Wrapping would yield 0; clamp must yield last index.
    assert.notEqual(clampPageIndex(5, 5), 0)
    assert.equal(clampPageIndex(5, 5), 4)
  })
})

describe('cycleRotation', () => {
  it('270 + 90 wraps to 0', () => {
    assert.equal(cycleRotation(270, 90), 0)
  })

  it('0 - 90 wraps to 270', () => {
    assert.equal(cycleRotation(0, -90), 270)
  })

  it('steps through the full cycle', () => {
    assert.equal(cycleRotation(0, 90), 90)
    assert.equal(cycleRotation(90, 90), 180)
    assert.equal(cycleRotation(180, 90), 270)
    assert.equal(cycleRotation(270, 90), 0)
    assert.equal(cycleRotation(90, -90), 0)
    assert.equal(cycleRotation(180, -90), 90)
  })
})
