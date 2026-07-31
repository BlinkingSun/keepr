/**
 * Multi-column sort: stable comparator with nulls-last in both directions.
 */

import type { GridRow } from '../../shared/ipc.ts'
import type { SortSpec } from './types.ts'

/** Extract a comparable value from a GridRow for a sort column key. */
export function sortValue(row: GridRow, column: string): string | number | boolean | null {
  switch (column) {
    case 'txnDate':
      return row.txnDate
    case 'vendorName':
      return row.vendorName
    case 'categoryName':
      return row.categoryName
    case 'paymentTypeName':
      return row.paymentTypeName
    case 'taxTotalMinor':
      return row.taxTotalMinor
    case 'totalMinor':
      return row.totalMinor
    case 'reviewed':
      return row.reviewed
    case 'type':
      return row.type
    case 'itemId':
      return row.itemId
    case 'currency':
      return row.currency
    default:
      return null
  }
}

/**
 * Compare two values with nulls always last, regardless of direction.
 * Returns -1 / 0 / 1 for asc; caller flips for desc (except nulls stay last).
 */
export function compareValues(
  a: string | number | boolean | null | undefined,
  b: string | number | boolean | null | undefined,
  dir: 'asc' | 'desc',
): number {
  const aNull = a == null || a === ''
  const bNull = b == null || b === ''

  // Nulls last in BOTH directions.
  if (aNull && bNull) return 0
  if (aNull) return 1
  if (bNull) return -1

  let cmp = 0
  if (typeof a === 'number' && typeof b === 'number') {
    cmp = a < b ? -1 : a > b ? 1 : 0
  } else if (typeof a === 'boolean' && typeof b === 'boolean') {
    cmp = a === b ? 0 : a ? 1 : -1
  } else {
    const as = String(a).toLowerCase()
    const bs = String(b).toLowerCase()
    cmp = as < bs ? -1 : as > bs ? 1 : 0
  }

  return dir === 'desc' ? -cmp : cmp
}

/**
 * Build a stable multi-column comparator.
 * When all sort keys tie, preserve original index order (stable).
 */
export function makeComparator(
  sort: SortSpec[],
): (a: GridRow, b: GridRow, ai: number, bi: number) => number {
  return (a, b, ai, bi) => {
    for (const s of sort) {
      const cmp = compareValues(sortValue(a, s.column), sortValue(b, s.column), s.dir)
      if (cmp !== 0) return cmp
    }
    return ai - bi
  }
}

/** Sort a row array stably by the given multi-column sort. Returns a new array. */
export function sortRows(rows: GridRow[], sort: SortSpec[]): GridRow[] {
  if (sort.length === 0) return rows.slice()
  const indexed = rows.map((row, i) => ({ row, i }))
  const cmp = makeComparator(sort)
  indexed.sort((x, y) => cmp(x.row, y.row, x.i, y.i))
  return indexed.map((x) => x.row)
}

/**
 * Cycle sort on a column click.
 * Plain click: asc → desc → off (remove). Only that column remains if not shift.
 * Shift-click: add/cycle as secondary without clearing others.
 */
export function cycleSort(
  current: SortSpec[],
  column: string,
  shiftKey: boolean,
): SortSpec[] {
  const idx = current.findIndex((s) => s.column === column)

  if (!shiftKey) {
    // Replace multi-sort with a single column cycle.
    if (idx === -1) return [{ column, dir: 'asc' }]
    const existing = current[idx]
    if (!existing) return [{ column, dir: 'asc' }]
    if (existing.dir === 'asc') return [{ column, dir: 'desc' }]
    return [] // off
  }

  // Shift: multi-sort
  if (idx === -1) {
    return [...current, { column, dir: 'asc' }]
  }
  const existing = current[idx]
  if (!existing) return [...current, { column, dir: 'asc' }]
  if (existing.dir === 'asc') {
    return current.map((s, i) => (i === idx ? { column, dir: 'desc' as const } : s))
  }
  // remove this column from multi-sort
  return current.filter((_, i) => i !== idx)
}
