/**
 * Pure virtualization math — no DOM.
 * Given scroll offset, row height, viewport height and overscan, compute the
 * inclusive start / exclusive end indices of rows that should be mounted.
 */

export interface WindowInput {
  scrollTop: number
  viewportHeight: number
  rowHeight: number
  rowCount: number
  /** Extra rows above and below the visible band. Default 5. */
  overscan?: number
}

export interface WindowRange {
  /** Inclusive start index into the row list. */
  start: number
  /** Exclusive end index. */
  end: number
  /** Pixel height of the spacer above the mounted window. */
  offsetY: number
  /** Total scrollable height for all rows. */
  totalHeight: number
  /** Number of rows in the mounted window (end - start). */
  visibleCount: number
}

/**
 * Compute the virtualized window.
 * Empty list → start=0, end=0. Clamps at top and bottom.
 */
export function computeWindow(input: WindowInput): WindowRange {
  const {
    scrollTop,
    viewportHeight,
    rowHeight,
    rowCount,
    overscan = 5,
  } = input

  if (rowCount <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0, offsetY: 0, totalHeight: 0, visibleCount: 0 }
  }

  const totalHeight = rowCount * rowHeight
  const safeScroll = Math.max(0, Math.min(scrollTop, Math.max(0, totalHeight - viewportHeight)))
  const firstVisible = Math.floor(safeScroll / rowHeight)
  const visibleCount = Math.max(1, Math.ceil(viewportHeight / rowHeight))

  let start = Math.max(0, firstVisible - overscan)
  let end = Math.min(rowCount, firstVisible + visibleCount + overscan)

  // Guard: never produce an inverted range.
  if (start > end) start = end

  return {
    start,
    end,
    offsetY: start * rowHeight,
    totalHeight,
    visibleCount: end - start,
  }
}
