/**
 * Filmstrip page reorder — pure array move used by drag-and-drop and tests.
 */

/**
 * Move the element at `fromIndex` to `toIndex` (indices into the current
 * order). Returns a new array of page ids suitable for onReorderPages.
 *
 * Example: ids [10,20,30,40,50,60], fromIndex 4 → toIndex 1
 *   → [10, 50, 20, 30, 40, 60]
 */
export function reorderPageIds(
  pageIds: readonly number[],
  fromIndex: number,
  toIndex: number,
): number[] {
  const n = pageIds.length
  if (n === 0) return []
  if (
    fromIndex < 0 ||
    fromIndex >= n ||
    toIndex < 0 ||
    toIndex >= n ||
    fromIndex === toIndex
  ) {
    return [...pageIds]
  }
  const next = [...pageIds]
  const [moved] = next.splice(fromIndex, 1)
  if (moved === undefined) return [...pageIds]
  next.splice(toIndex, 0, moved)
  return next
}
