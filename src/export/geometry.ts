/**
 * Searchable-PDF geometry: Word.bbox is in STORED-MASTER pixel space.
 * Scale to PDF points and apply page.rotation at render time — never bake
 * rotation into the stored file (geometry invariant).
 *
 * PDF page origin is bottom-left; master origin is top-left.
 */
import type { BBox, Rotation } from '../shared/types.ts'

/** Axis-aligned display size after applying metadata rotation. */
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
 * Stored-master pixel → display-local (top-left of rotated AABB), matching the
 * viewer CSS rotate convention (clockwise-positive).
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

/** Stored-master bbox → axis-aligned box in display pixel space. */
export function masterBoxToDisplay(
  box: BBox,
  masterW: number,
  masterH: number,
  rotation: Rotation,
): BBox {
  return mapBoxCorners(box, (x, y) =>
    masterPointToDisplay(x, y, masterW, masterH, rotation),
  )
}

export interface PdfTextPlacement {
  /** PDF x of text origin (left of glyph), points. */
  x: number
  /** PDF y of text baseline, points (origin bottom-left). */
  y: number
  /** Font size in points, derived from bbox height. */
  size: number
  /** Page width in PDF points for this image. */
  pageW: number
  /** Page height in PDF points for this image. */
  pageH: number
  /** Display-space axis-aligned box (pixels × scale → points). */
  displayBox: BBox
}

/**
 * Place a word's bbox into PDF user space.
 *
 * @param scale  PDF points per master/display pixel. Default 1 (1px = 1pt).
 * @returns placement for pdf-lib drawText (baseline at bottom of the word box).
 */
export function masterBBoxToPdfText(
  box: BBox,
  masterW: number,
  masterH: number,
  rotation: Rotation,
  scale = 1,
): PdfTextPlacement {
  const disp = masterBoxToDisplay(box, masterW, masterH, rotation)
  const { w: dW, h: dH } = displaySize(masterW, masterH, rotation)
  const pageW = dW * scale
  const pageH = dH * scale
  const x = disp.x * scale
  // PDF y is bottom of the word box (baseline approx); flip from top-left display.
  const y = pageH - (disp.y + disp.h) * scale
  const size = Math.max(1, disp.h * scale * 0.9)
  return {
    x,
    y,
    size,
    pageW,
    pageH,
    displayBox: {
      x: disp.x * scale,
      y: disp.y * scale,
      w: disp.w * scale,
      h: disp.h * scale,
    },
  }
}
