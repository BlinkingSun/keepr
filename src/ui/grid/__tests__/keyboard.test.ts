/**
 * Keyboard navigation reducer: Enter down, Tab right, clamp at edges.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { navigateFocus, nextUnreviewedIndex } from '../keyboard.ts'

describe('navigateFocus', () => {
  const ctx = { rowCount: 5, colCount: 4, pageSize: 2 }

  it('Enter moves down and clamps at bottom (no wrap)', () => {
    let p = { row: 0, col: 1 }
    p = navigateFocus(p, 'Enter', ctx)
    assert.deepEqual(p, { row: 1, col: 1 })
    p = navigateFocus({ row: 4, col: 1 }, 'Enter', ctx)
    assert.deepEqual(p, { row: 4, col: 1 }) // clamped, not wrap to 0
  })

  it('Tab moves right and clamps at right edge (no wrap)', () => {
    let p = { row: 2, col: 0 }
    p = navigateFocus(p, 'Tab', ctx)
    assert.deepEqual(p, { row: 2, col: 1 })
    p = navigateFocus({ row: 2, col: 3 }, 'Tab', ctx)
    assert.deepEqual(p, { row: 2, col: 3 }) // clamped, not wrap
  })

  it('ShiftTab moves left and clamps at left edge', () => {
    assert.deepEqual(
      navigateFocus({ row: 1, col: 0 }, 'ShiftTab', ctx),
      { row: 1, col: 0 },
    )
    assert.deepEqual(
      navigateFocus({ row: 1, col: 2 }, 'ShiftTab', ctx),
      { row: 1, col: 1 },
    )
  })

  it('arrows clamp at all four edges', () => {
    assert.deepEqual(navigateFocus({ row: 0, col: 0 }, 'ArrowUp', ctx), { row: 0, col: 0 })
    assert.deepEqual(navigateFocus({ row: 0, col: 0 }, 'ArrowLeft', ctx), { row: 0, col: 0 })
    assert.deepEqual(navigateFocus({ row: 4, col: 3 }, 'ArrowDown', ctx), { row: 4, col: 3 })
    assert.deepEqual(navigateFocus({ row: 4, col: 3 }, 'ArrowRight', ctx), { row: 4, col: 3 })
  })

  it('Home / End jump columns', () => {
    assert.deepEqual(navigateFocus({ row: 2, col: 2 }, 'Home', ctx), { row: 2, col: 0 })
    assert.deepEqual(navigateFocus({ row: 2, col: 0 }, 'End', ctx), { row: 2, col: 3 })
  })

  it('PageUp / PageDown jump by pageSize and clamp', () => {
    assert.deepEqual(navigateFocus({ row: 3, col: 1 }, 'PageUp', ctx), { row: 1, col: 1 })
    assert.deepEqual(navigateFocus({ row: 0, col: 1 }, 'PageUp', ctx), { row: 0, col: 1 })
    assert.deepEqual(navigateFocus({ row: 3, col: 1 }, 'PageDown', ctx), { row: 4, col: 1 })
  })

  it('empty grid stays at 0,0', () => {
    assert.deepEqual(
      navigateFocus({ row: 5, col: 5 }, 'ArrowDown', { rowCount: 0, colCount: 0 }),
      { row: 0, col: 0 },
    )
  })
})

describe('nextUnreviewedIndex', () => {
  it('finds the next unreviewed after fromRow', () => {
    // indices: 0 reviewed, 1 unreviewed, 2 reviewed, 3 unreviewed
    const flags = [true, false, true, false]
    assert.equal(nextUnreviewedIndex(flags, 0), 1)
    assert.equal(nextUnreviewedIndex(flags, 1), 3)
    assert.equal(nextUnreviewedIndex(flags, 3), 1) // wraps
  })

  it('returns null when all reviewed', () => {
    assert.equal(nextUnreviewedIndex([true, true], 0), null)
  })
})
