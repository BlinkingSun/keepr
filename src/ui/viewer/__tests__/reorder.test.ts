/**
 * Filmstrip reorder → pageIdsInOrder.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { reorderPageIds } from '../reorder.ts'

describe('reorderPageIds', () => {
  it('move from index 4 to index 1 produces correct pageIdsInOrder', () => {
    const ids = [10, 20, 30, 40, 50, 60]
    // index 4 is 50; insert at index 1
    const next = reorderPageIds(ids, 4, 1)
    assert.deepEqual(next, [10, 50, 20, 30, 40, 60])
  })

  it('no-op when from === to', () => {
    const ids = [1, 2, 3]
    assert.deepEqual(reorderPageIds(ids, 1, 1), [1, 2, 3])
  })

  it('move first to last', () => {
    assert.deepEqual(reorderPageIds([1, 2, 3, 4], 0, 3), [2, 3, 4, 1])
  })

  it('move last to first', () => {
    assert.deepEqual(reorderPageIds([1, 2, 3, 4], 3, 0), [4, 1, 2, 3])
  })
})
