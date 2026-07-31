/**
 * Selection helpers — pure, parent owns the Set via onSelectionChange.
 */

/**
 * Clamp a [from, to] index range into [0, length-1].
 * Returns a sorted [lo, hi] pair. Empty list → [0, -1] (no valid indices).
 */
export function clampRange(
  from: number,
  to: number,
  length: number,
): [number, number] {
  if (length <= 0) return [0, -1]
  const a = Math.max(0, Math.min(length - 1, from))
  const b = Math.max(0, Math.min(length - 1, to))
  return a <= b ? [a, b] : [b, a]
}

/** Select every id in the inclusive index range [from, to] on the ordered id list. */
export function selectRange(
  orderedIds: readonly number[],
  fromIdx: number,
  toIdx: number,
  base?: Set<number>,
): Set<number> {
  const next = base ? new Set(base) : new Set<number>()
  const [lo, hi] = clampRange(fromIdx, toIdx, orderedIds.length)
  if (hi < lo) return next
  for (let i = lo; i <= hi; i++) {
    const id = orderedIds[i]
    if (id !== undefined) next.add(id)
  }
  return next
}

/** Toggle a single id in or out of the selection. */
export function toggleSelection(selected: Set<number>, id: number): Set<number> {
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** Select all ids. */
export function selectAll(orderedIds: readonly number[]): Set<number> {
  return new Set(orderedIds)
}

/** Clear selection. */
export function clearSelection(): Set<number> {
  return new Set()
}

/**
 * Apply a click with modifiers.
 * - plain: select only this id
 * - shift: range from anchor to this index
 * - meta/ctrl: toggle this id
 */
export function applyClick(
  orderedIds: readonly number[],
  selected: Set<number>,
  clickedIndex: number,
  opts: { shift: boolean; meta: boolean; anchorIndex: number | null },
): { selected: Set<number>; anchorIndex: number } {
  const id = orderedIds[clickedIndex]
  if (id === undefined) {
    return { selected: new Set(selected), anchorIndex: opts.anchorIndex ?? 0 }
  }

  if (opts.meta) {
    return {
      selected: toggleSelection(selected, id),
      anchorIndex: clickedIndex,
    }
  }

  if (opts.shift && opts.anchorIndex != null) {
    return {
      selected: selectRange(orderedIds, opts.anchorIndex, clickedIndex),
      anchorIndex: opts.anchorIndex,
    }
  }

  return {
    selected: new Set([id]),
    anchorIndex: clickedIndex,
  }
}

/**
 * Drop any selected id that is no longer visible.
 *
 * A selection outlives the list it was made against: switching folder or filter,
 * or a background refresh after OCR or an import, can remove rows while ids stay
 * in the set. The audit found the consequences — a status bar claiming "3
 * selected" for invisible rows, and worse, a bulk operation acting on ids the
 * user cannot see and did not mean to touch.
 *
 * Returns the SAME set instance when nothing changed, so callers can use it
 * directly in a React state setter without causing a re-render loop.
 */
export function pruneToVisible(selected: ReadonlySet<number>, visibleIds: Iterable<number>): Set<number> {
  const live = visibleIds instanceof Set ? visibleIds : new Set(visibleIds)
  if (selected.size === 0) return selected as Set<number>
  const kept: number[] = []
  for (const id of selected) if (live.has(id)) kept.push(id)
  return kept.length === selected.size ? (selected as Set<number>) : new Set(kept)
}
