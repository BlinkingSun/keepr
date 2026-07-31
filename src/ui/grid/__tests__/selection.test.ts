/**
 * Selection: range, toggle, select-all, clamped ranges.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyClick,
  clampRange,
  clearSelection,
  selectAll,
  selectRange,
  toggleSelection,
} from '../selection.ts'

const ids = [10, 20, 30, 40, 50]

describe('clampRange', () => {
  it('clamps and sorts endpoints', () => {
    assert.deepEqual(clampRange(-5, 100, 5), [0, 4])
    assert.deepEqual(clampRange(4, 1, 5), [1, 4])
    assert.deepEqual(clampRange(2, 2, 5), [2, 2])
  })

  it('handles empty list', () => {
    assert.deepEqual(clampRange(0, 3, 0), [0, -1])
  })
})

describe('selectRange', () => {
  it('selects inclusive index range', () => {
    const s = selectRange(ids, 1, 3)
    assert.deepEqual([...s].sort((a, b) => a - b), [20, 30, 40])
  })

  it('clamps out-of-bounds ranges', () => {
    const s = selectRange(ids, -10, 99)
    assert.deepEqual([...s].sort((a, b) => a - b), [10, 20, 30, 40, 50])
  })

  it('handles reverse range', () => {
    const s = selectRange(ids, 3, 1)
    assert.deepEqual([...s].sort((a, b) => a - b), [20, 30, 40])
  })
})

describe('toggleSelection', () => {
  it('adds and removes', () => {
    let s = new Set<number>()
    s = toggleSelection(s, 20)
    assert.ok(s.has(20))
    s = toggleSelection(s, 20)
    assert.ok(!s.has(20))
  })
})

describe('selectAll / clear', () => {
  it('selects all ids', () => {
    const s = selectAll(ids)
    assert.equal(s.size, 5)
    for (const id of ids) assert.ok(s.has(id))
  })

  it('clears', () => {
    assert.equal(clearSelection().size, 0)
  })
})

describe('applyClick', () => {
  it('plain click selects only the clicked id', () => {
    const r = applyClick(ids, new Set([10, 20]), 2, {
      shift: false,
      meta: false,
      anchorIndex: 0,
    })
    assert.deepEqual([...r.selected], [30])
    assert.equal(r.anchorIndex, 2)
  })

  it('meta click toggles', () => {
    const r = applyClick(ids, new Set([10]), 0, {
      shift: false,
      meta: true,
      anchorIndex: 0,
    })
    assert.equal(r.selected.size, 0)
  })

  it('shift click ranges from anchor', () => {
    const r = applyClick(ids, new Set(), 3, {
      shift: true,
      meta: false,
      anchorIndex: 1,
    })
    assert.deepEqual([...r.selected].sort((a, b) => a - b), [20, 30, 40])
    assert.equal(r.anchorIndex, 1)
  })
})
