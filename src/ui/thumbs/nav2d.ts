/**
 * 2D keyboard navigation over a flat list laid out in `cols` columns.
 * No wrapping on left/right. Down into a partial last row clamps to the last
 * item (never an empty slot). Home/End → first/last item.
 */

export type Nav2dAction =
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'Home'
  | 'End'

/**
 * Reduce focus index for a keyboard action.
 * Empty list → 0. Indices are always clamped into [0, itemCount-1].
 */
export function navigate2d(
  index: number,
  action: Nav2dAction,
  itemCount: number,
  cols: number,
): number {
  if (itemCount <= 0) return 0
  if (cols <= 0) return 0

  const max = itemCount - 1
  let i = Math.max(0, Math.min(max, index))

  switch (action) {
    case 'ArrowLeft':
      // Clamp at row start / list start — no wrap to previous row.
      return Math.max(0, i - 1)
    case 'ArrowRight':
      // Clamp at list end — no wrap to next row beyond last item.
      return Math.min(max, i + 1)
    case 'ArrowUp': {
      // Stay on first row (same index), do not jump to 0 from mid-row.
      if (i < cols) return i
      return i - cols
    }
    case 'ArrowDown': {
      const next = i + cols
      if (next <= max) return next
      // Would land past the end (partial last row or already on last row).
      // Clamp to LAST ITEM, not an empty slot past the list.
      const lastRowStart = Math.floor(max / cols) * cols
      if (i >= lastRowStart) return i
      return max
    }
    case 'Home':
      return 0
    case 'End':
      return max
    default:
      return i
  }
}

/** Map a visual index into the ordered id list. Null when out of range. */
export function idAtIndex(
  orderedIds: readonly number[],
  index: number,
): number | null {
  if (index < 0 || index >= orderedIds.length) return null
  const id = orderedIds[index]
  return id === undefined ? null : id
}

/** Find visual index of an id, or -1. */
export function indexOfId(
  orderedIds: readonly number[],
  id: number,
): number {
  return orderedIds.indexOf(id)
}
