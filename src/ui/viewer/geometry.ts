/**
 * Coordinate transforms between STORED-MASTER pixel space and screen space.
 *
 * Geometry invariant (PLAN.md / LANE-G-SPEC):
 *   Word boxes and regions are in stored-master pixel space — the pixels of the
 *   file on disk, BEFORE display rotation. page.rotation is metadata applied as
 *   a CSS transform for display only. Mapping screen → master must invert zoom
 *   and rotation, or the searchable PDF text layer and field assignment drift.
 */

import type { BBox, Rotation } from '../../shared/types.ts'

/** Display (axis-aligned) size of an image after CSS rotation, at zoom 1. */
export function displaySize(
  masterW: number,
  masterH: number,
  rotation: Rotation,
): { w: number; h: number } {
  if (rotation === 90 || rotation === 270) {
    return { w: masterH, h: masterW }
  }
  return { w: masterW, h: masterH }
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Map a point from stored-master pixel space to display-local coordinates
 * (top-left of the rotated image's axis-aligned bounding box, at zoom 1).
 * CSS rotate(θ) is clockwise-positive with the standard CSS matrix.
 */
export function masterPointToDisplay(
  x: number,
  y: number,
  masterW: number,
  masterH: number,
  rotation: Rotation,
): { x: number; y: number } {
  const cx = masterW / 2
  const cy = masterH / 2
  const dx = x - cx
  const dy = y - cy
  const θ = degToRad(rotation)
  const c = Math.cos(θ)
  const s = Math.sin(θ)
  // CSS matrix: x' = x cos − y sin, y' = x sin + y cos
  const rx = dx * c - dy * s
  const ry = dx * s + dy * c
  const { w: dW, h: dH } = displaySize(masterW, masterH, rotation)
  return { x: rx + dW / 2, y: ry + dH / 2 }
}

/**
 * Inverse of masterPointToDisplay: display-local (zoom 1) → stored-master.
 */
export function displayPointToMaster(
  x: number,
  y: number,
  masterW: number,
  masterH: number,
  rotation: Rotation,
): { x: number; y: number } {
  const { w: dW, h: dH } = displaySize(masterW, masterH, rotation)
  const rx = x - dW / 2
  const ry = y - dH / 2
  const θ = degToRad(rotation)
  const c = Math.cos(θ)
  const s = Math.sin(θ)
  // Inverse of CSS rotate(θ) = rotate(−θ):
  // dx = rx cos + ry sin, dy = −rx sin + ry cos
  const dx = rx * c + ry * s
  const dy = -rx * s + ry * c
  return { x: dx + masterW / 2, y: dy + masterH / 2 }
}

export interface ViewportTransform {
  /** Uniform scale applied after rotation. */
  zoom: number
  /** Pan offset in screen pixels (top-left of rotated AABB → viewport). */
  panX: number
  panY: number
}

/**
 * Stored-master → screen pixels (viewport space of the canvas).
 */
export function masterPointToScreen(
  x: number,
  y: number,
  masterW: number,
  masterH: number,
  rotation: Rotation,
  t: ViewportTransform,
): { x: number; y: number } {
  const d = masterPointToDisplay(x, y, masterW, masterH, rotation)
  return {
    x: d.x * t.zoom + t.panX,
    y: d.y * t.zoom + t.panY,
  }
}

/**
 * Screen pixels → stored-master. Use this before onAssignRegion.
 */
export function screenPointToMaster(
  x: number,
  y: number,
  masterW: number,
  masterH: number,
  rotation: Rotation,
  t: ViewportTransform,
): { x: number; y: number } {
  const dx = (x - t.panX) / t.zoom
  const dy = (y - t.panY) / t.zoom
  return displayPointToMaster(dx, dy, masterW, masterH, rotation)
}

/** Axis-aligned bbox of the four corners after a point transform. */
function mapBoxCorners(
  box: BBox,
  map: (x: number, y: number) => { x: number; y: number },
): BBox {
  const corners = [
    map(box.x, box.y),
    map(box.x + box.w, box.y),
    map(box.x, box.y + box.h),
    map(box.x + box.w, box.y + box.h),
  ]
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of corners) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** Stored-master box → screen-space axis-aligned box. */
export function masterBoxToScreen(
  box: BBox,
  masterW: number,
  masterH: number,
  rotation: Rotation,
  t: ViewportTransform,
): BBox {
  return mapBoxCorners(box, (x, y) =>
    masterPointToScreen(x, y, masterW, masterH, rotation, t),
  )
}

/**
 * Screen-space selection box → stored-master BBox for onAssignRegion.
 * Corners are mapped through inverse zoom+rotation; result is the AABB.
 */
export function screenBoxToMaster(
  box: BBox,
  masterW: number,
  masterH: number,
  rotation: Rotation,
  t: ViewportTransform,
): BBox {
  return mapBoxCorners(box, (x, y) =>
    screenPointToMaster(x, y, masterW, masterH, rotation, t),
  )
}
