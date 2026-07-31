/**
 * Zoom fit / absolute helpers for the page canvas.
 * Pure math — no DOM. Display size accounts for metadata rotation.
 */

import type { Rotation } from '../../shared/types.ts'
import { displaySize } from './geometry.ts'

/**
 * Scale that fits the rotated image into the viewport (contain, not cover).
 * Portrait image in landscape viewport → limited by height; reverse → width.
 */
export function zoomFit(
  masterW: number,
  masterH: number,
  viewportW: number,
  viewportH: number,
  rotation: Rotation = 0,
): number {
  if (masterW <= 0 || masterH <= 0 || viewportW <= 0 || viewportH <= 0) {
    return 1
  }
  const { w, h } = displaySize(masterW, masterH, rotation)
  return Math.min(viewportW / w, viewportH / h)
}

/** Clamp zoom to a sensible range for receipts. */
export function clampZoom(z: number, min = 0.1, max = 8): number {
  if (!Number.isFinite(z)) return 1
  return Math.min(max, Math.max(min, z))
}

/** Zoom levels offered by the toolbar (fit is computed separately). */
export const ZOOM_PRESETS = [0.5, 1, 1.5, 2] as const
