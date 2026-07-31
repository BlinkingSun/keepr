/**
 * Page index clamping and rotation cycling — pure helpers for the toolbar
 * and keyboard navigation.
 */

import type { Rotation } from '../../shared/types.ts'

/**
 * Clamp a page index to [0, pageCount - 1]. Does not wrap — first/last stay put.
 * Empty list → 0.
 */
export function clampPageIndex(index: number, pageCount: number): number {
  if (pageCount <= 0) return 0
  if (!Number.isFinite(index)) return 0
  if (index < 0) return 0
  if (index >= pageCount) return pageCount - 1
  return Math.trunc(index)
}

const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270]

/**
 * Add delta (typically ±90) to the current metadata rotation, wrapping in
 * {0, 90, 180, 270}. 270 + 90 → 0; 0 − 90 → 270.
 */
export function cycleRotation(current: Rotation, delta: number): Rotation {
  const step = Math.round(delta / 90)
  const idx = ROTATIONS.indexOf(current)
  const base = idx >= 0 ? idx : 0
  // Positive modulo so negatives wrap correctly.
  const next = ((base + step) % 4 + 4) % 4
  return ROTATIONS[next] ?? 0
}
