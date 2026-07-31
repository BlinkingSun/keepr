/**
 * Keyboard navigation reducer for the grid focus cell.
 * Enter moves down; Tab moves right; both clamp at edges (no wrap).
 */

export interface FocusPos {
  row: number
  col: number
}

export type NavAction =
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Home'
  | 'End'
  | 'PageUp'
  | 'PageDown'
  | 'Enter'
  | 'Tab'
  | 'ShiftTab'
  | 'Escape'

export interface NavContext {
  rowCount: number
  colCount: number
  /** Rows to jump on PageUp/PageDown. Default 10. */
  pageSize?: number
}

function clamp(n: number, lo: number, hi: number): number {
  if (hi < lo) return lo
  return Math.max(lo, Math.min(hi, n))
}

/**
 * Reduce focus position for a keyboard action.
 * Empty grid (rowCount/colCount 0) stays at {0,0} clamped.
 * Enter = down one row (clamp). Tab = right one col (clamp). No wrapping.
 */
export function navigateFocus(
  pos: FocusPos,
  action: NavAction,
  ctx: NavContext,
): FocusPos {
  const { rowCount, colCount, pageSize = 10 } = ctx
  if (rowCount <= 0 || colCount <= 0) {
    return { row: 0, col: 0 }
  }

  const maxRow = rowCount - 1
  const maxCol = colCount - 1
  let { row, col } = pos
  row = clamp(row, 0, maxRow)
  col = clamp(col, 0, maxCol)

  switch (action) {
    case 'ArrowUp':
      return { row: clamp(row - 1, 0, maxRow), col }
    case 'ArrowDown':
    case 'Enter':
      return { row: clamp(row + 1, 0, maxRow), col }
    case 'ArrowLeft':
    case 'ShiftTab':
      return { row, col: clamp(col - 1, 0, maxCol) }
    case 'ArrowRight':
    case 'Tab':
      return { row, col: clamp(col + 1, 0, maxCol) }
    case 'Home':
      return { row, col: 0 }
    case 'End':
      return { row, col: maxCol }
    case 'PageUp':
      return { row: clamp(row - pageSize, 0, maxRow), col }
    case 'PageDown':
      return { row: clamp(row + pageSize, 0, maxRow), col }
    case 'Escape':
      return { row, col }
    default:
      return { row, col }
  }
}

/**
 * Find the next unreviewed row index after `fromRow` (exclusive).
 * Wraps to the start of the list. Returns null if none.
 */
export function nextUnreviewedIndex(
  reviewedFlags: readonly boolean[],
  fromRow: number,
): number | null {
  const n = reviewedFlags.length
  if (n === 0) return null
  for (let step = 1; step <= n; step++) {
    const i = (fromRow + step) % n
    if (reviewedFlags[i] === false) return i
  }
  return null
}
