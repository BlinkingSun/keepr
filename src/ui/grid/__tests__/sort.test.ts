/**
 * Multi-sort comparator + nulls-last.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { GridRow } from '../../../shared/ipc.ts'
import { compareValues, makeComparator, sortRows, cycleSort } from '../sort.ts'
import type { SortSpec } from '../types.ts'

function row(partial: Partial<GridRow> & { itemId: number }): GridRow {
  return {
    type: 'receipt',
    folderId: 1,
    txnDate: null,
    vendorName: null,
    categoryName: null,
    paymentTypeName: null,
    taxTotalMinor: null,
    totalMinor: null,
    currency: 'USD',
    ocrStatus: 'done',
    ocrConfidence: 0.9,
    needsManualEntry: false,
    reviewed: false,
    hasImages: false,
    isSplitChild: false,
    lowConfidenceFields: [],
    missingFields: [],
    ...partial,
  }
}

describe('compareValues / nulls last', () => {
  it('nulls sort last in ascending', () => {
    assert.equal(compareValues(null, 'a', 'asc'), 1)
    assert.equal(compareValues('a', null, 'asc'), -1)
    assert.equal(compareValues(null, null, 'asc'), 0)
  })

  it('nulls sort last in descending (not first)', () => {
    // Non-null still comes before null even when dir is desc.
    assert.equal(compareValues(null, 'a', 'desc'), 1)
    assert.equal(compareValues('a', null, 'desc'), -1)
    // Among non-nulls, desc flips order.
    assert.equal(compareValues('a', 'z', 'desc'), 1)
    assert.equal(compareValues('z', 'a', 'desc'), -1)
  })

  it('compares numbers and strings correctly', () => {
    assert.equal(compareValues(10, 20, 'asc'), -1)
    assert.equal(compareValues(20, 10, 'asc'), 1)
    assert.equal(compareValues(10, 20, 'desc'), 1)
    assert.equal(compareValues('apple', 'banana', 'asc'), -1)
    assert.equal(compareValues('Banana', 'apple', 'asc'), 1) // case-insensitive: banana > apple
  })
})

describe('multi-sort comparator', () => {
  it('is stable and correct across strings, numbers, nulls-last', () => {
    const rows: GridRow[] = [
      row({ itemId: 1, vendorName: 'Beta', totalMinor: 500 as never }),
      row({ itemId: 2, vendorName: 'Alpha', totalMinor: 100 as never }),
      row({ itemId: 3, vendorName: 'Alpha', totalMinor: 300 as never }),
      row({ itemId: 4, vendorName: null, totalMinor: 900 as never }),
      row({ itemId: 5, vendorName: 'Alpha', totalMinor: null }),
    ]

    const sort: SortSpec[] = [
      { column: 'vendorName', dir: 'asc' },
      { column: 'totalMinor', dir: 'desc' },
    ]
    const sorted = sortRows(rows, sort)
    const ids = sorted.map((r) => r.itemId)

    // Alpha first (with totals desc: 300, 100, then null last within Alpha)
    // then Beta, then null vendor last.
    assert.deepEqual(ids, [3, 2, 5, 1, 4])
  })

  it('preserves original order on full ties (stable)', () => {
    const rows: GridRow[] = [
      row({ itemId: 10, vendorName: 'Same' }),
      row({ itemId: 20, vendorName: 'Same' }),
      row({ itemId: 30, vendorName: 'Same' }),
    ]
    const sorted = sortRows(rows, [{ column: 'vendorName', dir: 'asc' }])
    assert.deepEqual(
      sorted.map((r) => r.itemId),
      [10, 20, 30],
    )
  })

  it('makeComparator returns 0 for equal keys and uses index for stability', () => {
    const a = row({ itemId: 1, vendorName: 'X' })
    const b = row({ itemId: 2, vendorName: 'X' })
    const cmp = makeComparator([{ column: 'vendorName', dir: 'asc' }])
    assert.equal(cmp(a, b, 0, 1), -1) // index 0 before 1
    assert.equal(cmp(a, b, 5, 2), 3)
  })
})

describe('cycleSort', () => {
  it('cycles asc → desc → off on plain click', () => {
    let s: SortSpec[] = []
    s = cycleSort(s, 'vendorName', false)
    assert.deepEqual(s, [{ column: 'vendorName', dir: 'asc' }])
    s = cycleSort(s, 'vendorName', false)
    assert.deepEqual(s, [{ column: 'vendorName', dir: 'desc' }])
    s = cycleSort(s, 'vendorName', false)
    assert.deepEqual(s, [])
  })

  it('shift-click adds secondary sort', () => {
    let s: SortSpec[] = [{ column: 'vendorName', dir: 'asc' }]
    s = cycleSort(s, 'totalMinor', true)
    assert.deepEqual(s, [
      { column: 'vendorName', dir: 'asc' },
      { column: 'totalMinor', dir: 'asc' },
    ])
  })
})
