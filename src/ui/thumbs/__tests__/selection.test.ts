/**
 * Range selection over visual (thumbnail) order — reuses grid selection helpers.
 * Run: node --experimental-strip-types --test src/ui/thumbs/__tests__/selection.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyClick,
  selectRange,
  toggleSelection,
} from '../../grid/selection.ts'

/** Visual order of cards (row-major), same as ThumbPanel's orderedIds. */
const visualIds = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]

describe('range selection over visual order', () => {
  it('shift-click selects inclusive visual range (matches grid applyClick)', () => {
    // Anchor at index 1 (20), shift-click index 6 (70) → 20..70
    const r = applyClick(visualIds, new Set([20]), 6, {
      shift: true,
      meta: false,
      anchorIndex: 1,
    })
    assert.deepEqual(
      [...r.selected].sort((a, b) => a - b),
      [20, 30, 40, 50, 60, 70],
    )
    assert.equal(r.anchorIndex, 1)
  })

  it('selectRange is inclusive on the ordered id list', () => {
    const s = selectRange(visualIds, 0, 3)
    assert.deepEqual([...s].sort((a, b) => a - b), [10, 20, 30, 40])
  })

  it('plain click replaces selection with single id', () => {
    const r = applyClick(visualIds, new Set([10, 20, 30]), 4, {
      shift: false,
      meta: false,
      anchorIndex: 0,
    })
    assert.deepEqual([...r.selected], [50])
    assert.equal(r.anchorIndex, 4)
  })

  it('meta/ctrl click toggles without clearing others', () => {
    const r = applyClick(visualIds, new Set([10, 30]), 2, {
      shift: false,
      meta: true,
      anchorIndex: 0,
    })
    // index 2 is 30 — already selected → remove
    assert.deepEqual([...r.selected].sort((a, b) => a - b), [10])
  })

  it('toggleSelection flips a single id (Space semantics)', () => {
    let s = new Set([10])
    s = toggleSelection(s, 20)
    assert.ok(s.has(10) && s.has(20))
    s = toggleSelection(s, 10)
    assert.ok(!s.has(10) && s.has(20))
  })

  it('reverse shift range still selects visual span', () => {
    const r = applyClick(visualIds, new Set(), 1, {
      shift: true,
      meta: false,
      anchorIndex: 5,
    })
    assert.deepEqual(
      [...r.selected].sort((a, b) => a - b),
      [20, 30, 40, 50, 60],
    )
  })
})
