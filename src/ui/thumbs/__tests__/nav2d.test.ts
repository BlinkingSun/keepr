/**
 * 2D keyboard navigation over a card grid.
 * Run: node --experimental-strip-types --test src/ui/thumbs/__tests__/nav2d.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { idAtIndex, navigate2d } from '../nav2d.ts'

describe('navigate2d', () => {
  // 10 items, 4 cols:
  //  0  1  2  3
  //  4  5  6  7
  //  8  9
  const N = 10
  const COLS = 4

  it('right at row end clamps (no wrap past last item)', () => {
    // end of first full row
    assert.equal(navigate2d(3, 'ArrowRight', N, COLS), 4) // next item is fine
    // last item
    assert.equal(navigate2d(9, 'ArrowRight', N, COLS), 9)
  })

  it('left at start clamps', () => {
    assert.equal(navigate2d(0, 'ArrowLeft', N, COLS), 0)
  })

  it('up from first row stays on same index', () => {
    assert.equal(navigate2d(0, 'ArrowUp', N, COLS), 0)
    assert.equal(navigate2d(2, 'ArrowUp', N, COLS), 2)
    assert.equal(navigate2d(3, 'ArrowUp', N, COLS), 3)
  })

  it('up from second row moves by −cols', () => {
    assert.equal(navigate2d(5, 'ArrowUp', N, COLS), 1)
    assert.equal(navigate2d(7, 'ArrowUp', N, COLS), 3)
  })

  it('down from full row into partial last row clamps to LAST ITEM', () => {
    // Row 1 is full [4,5,6,7]; next row is partial [8,9].
    // Down from 6 would land at empty slot 10 → clamp to last item 9.
    assert.equal(navigate2d(6, 'ArrowDown', N, COLS), 9)
    assert.equal(navigate2d(7, 'ArrowDown', N, COLS), 9)
    // Down from 5 lands on existing 9.
    assert.equal(navigate2d(5, 'ArrowDown', N, COLS), 9)
    // Down from 4 lands on existing 8.
    assert.equal(navigate2d(4, 'ArrowDown', N, COLS), 8)
  })

  it('down from last partial row stays / clamps to last item', () => {
    assert.equal(navigate2d(8, 'ArrowDown', N, COLS), 8)
    assert.equal(navigate2d(9, 'ArrowDown', N, COLS), 9)
  })

  it('down within full rows advances by +cols', () => {
    assert.equal(navigate2d(1, 'ArrowDown', N, COLS), 5)
    assert.equal(navigate2d(0, 'ArrowDown', N, COLS), 4)
  })

  it('Home / End map to first / last item', () => {
    assert.equal(navigate2d(5, 'Home', N, COLS), 0)
    assert.equal(navigate2d(5, 'End', N, COLS), 9)
    assert.equal(navigate2d(0, 'End', N, COLS), 9)
  })

  it('empty list returns 0', () => {
    assert.equal(navigate2d(3, 'ArrowDown', 0, COLS), 0)
  })

  it('clamps a stale focus index before acting', () => {
    assert.equal(navigate2d(99, 'ArrowLeft', N, COLS), 8) // 9 then left → 8
  })
})

describe('idAtIndex (Enter mapping)', () => {
  const ids = [100, 200, 300, 400, 500]

  it('maps visual index → id', () => {
    assert.equal(idAtIndex(ids, 0), 100)
    assert.equal(idAtIndex(ids, 2), 300)
    assert.equal(idAtIndex(ids, 4), 500)
  })

  it('returns null out of range', () => {
    assert.equal(idAtIndex(ids, -1), null)
    assert.equal(idAtIndex(ids, 5), null)
  })
})
