/**
 * Thumbnail grid layout math — pure, no DOM.
 *
 * Column count accounts for gap explicitly (CSS gap is between tracks, not
 * after the last). Card height is fluid: the 4:5 thumb box scales with the
 * computed column width; caption is a fixed block below.
 */

import { computeWindow, type WindowRange } from '../grid/windowing.ts'

/** Minimum card track width (matches CSS minmax(184px, 1fr)). */
export const MIN_CARD = 184
/** Grid gap in both axes (matches mockup / CSS). */
export const GAP = 12
/** Fixed caption block height under the 4:5 thumb (padding + vendor + date). */
export const CAPTION_H = 44
/** Height / width for a 4:5 aspect-ratio box. */
export const THUMB_ASPECT = 5 / 4
/**
 * Hard ceiling for mounted cards at any width (incl. 3840 ultrawide × 10k).
 * Overscan is derived so row window × cols stays strictly below this.
 */
export const MAX_MOUNTED_CARDS = 100

export interface LayoutMetrics {
  cols: number
  colWidth: number
  /** Thumb box height (4:5 of colWidth). */
  thumbHeight: number
  /** Full card height: thumb + caption. */
  cardHeight: number
  /**
   * Virtualization stride: cardHeight + gap.
   * Each logical row occupies this many pixels of scroll height.
   */
  rowHeight: number
  rowCount: number
  totalHeight: number
}

/**
 * How many columns fit in `width` given min card size and gap.
 * cols = max(1, floor((width + gap) / (minCard + gap)))
 */
export function columnCount(
  width: number,
  minCard: number = MIN_CARD,
  gap: number = GAP,
): number {
  if (width <= 0 || minCard <= 0) return 1
  return Math.max(1, Math.floor((width + gap) / (minCard + gap)))
}

/**
 * Fluid track width for `cols` columns in a container of `width`.
 * Horizontal gaps consume (cols - 1) * gap; remainder is split evenly.
 */
export function colWidthFor(
  width: number,
  cols: number,
  gap: number = GAP,
): number {
  if (cols <= 0) return MIN_CARD
  if (width <= 0) return MIN_CARD
  return Math.max(0, (width - gap * (cols - 1)) / cols)
}

/**
 * Virtualization row height for a given column width.
 * Thumb keeps 4:5 as the column flexes; caption is fixed; gap is the stride
 * remainder so window math stays on integer row slots.
 */
export function rowHeightFor(
  colWidth: number,
  gap: number = GAP,
  captionH: number = CAPTION_H,
): number {
  const cardH = cardHeightFor(colWidth, captionH)
  return cardH + gap
}

/** Card content height only (no inter-row gap). */
export function cardHeightFor(
  colWidth: number,
  captionH: number = CAPTION_H,
): number {
  const thumbH = colWidth * THUMB_ASPECT
  return thumbH + captionH
}

export function thumbHeightFor(colWidth: number): number {
  return colWidth * THUMB_ASPECT
}

/**
 * Full layout for a container width and item count.
 * Does not include scroll/window — use {@link thumbWindow} for that.
 */
export function layoutMetrics(
  width: number,
  itemCount: number,
  opts?: { minCard?: number; gap?: number; captionH?: number },
): LayoutMetrics {
  const minCard = opts?.minCard ?? MIN_CARD
  const gap = opts?.gap ?? GAP
  const captionH = opts?.captionH ?? CAPTION_H

  const cols = columnCount(width, minCard, gap)
  const colWidth = colWidthFor(width, cols, gap)
  const thumbHeight = thumbHeightFor(colWidth)
  const cardHeight = cardHeightFor(colWidth, captionH)
  const rowHeight = cardHeight + gap
  const rowCount = itemCount <= 0 ? 0 : Math.ceil(itemCount / cols)
  const totalHeight = rowCount * rowHeight

  return {
    cols,
    colWidth,
    thumbHeight,
    cardHeight,
    rowHeight,
    rowCount,
    totalHeight,
  }
}

/**
 * Overscan in *rows* such that mounted cards stay well under MAX_MOUNTED_CARDS.
 * Prefer up to 5 rows of overscan when the column count allows it.
 */
export function overscanRows(
  cols: number,
  viewportHeight: number,
  rowHeight: number,
  maxCards: number = MAX_MOUNTED_CARDS,
): number {
  if (cols <= 0 || rowHeight <= 0) return 0
  const visibleRows = Math.max(1, Math.ceil(viewportHeight / rowHeight))
  // Leave headroom: target maxCards - cols (at least one partial-row slack).
  const maxRows = Math.max(1, Math.floor((maxCards - 1) / cols))
  const spare = maxRows - visibleRows
  if (spare <= 0) return 0
  // Split spare above/below; cap preferred overscan at 5.
  return Math.min(5, Math.floor(spare / 2))
}

export interface ThumbWindowInput {
  width: number
  viewportHeight: number
  scrollTop: number
  itemCount: number
  minCard?: number
  gap?: number
  captionH?: number
  maxCards?: number
}

export interface ThumbWindow extends LayoutMetrics {
  window: WindowRange
  /** Upper bound on mounted card nodes (window rows × cols). */
  mountedCardBudget: number
  overscan: number
}

/**
 * Layout + virtualized row window for the thumbnail grid.
 * Reuses grid `computeWindow` over logical rows (not individual cards).
 */
export function thumbWindow(input: ThumbWindowInput): ThumbWindow {
  const layout = layoutMetrics(input.width, input.itemCount, {
    minCard: input.minCard,
    gap: input.gap,
    captionH: input.captionH,
  })
  const overscan = overscanRows(
    layout.cols,
    input.viewportHeight,
    layout.rowHeight,
    input.maxCards ?? MAX_MOUNTED_CARDS,
  )
  const window = computeWindow({
    scrollTop: input.scrollTop,
    viewportHeight: input.viewportHeight,
    rowHeight: layout.rowHeight,
    rowCount: layout.rowCount,
    overscan,
  })
  return {
    ...layout,
    window,
    overscan,
    mountedCardBudget: window.visibleCount * layout.cols,
  }
}

/** Inclusive item index range covered by a row window [rowStart, rowEnd). */
export function itemRangeForRows(
  rowStart: number,
  rowEnd: number,
  cols: number,
  itemCount: number,
): { start: number; end: number } {
  if (itemCount <= 0 || cols <= 0 || rowEnd <= rowStart) {
    return { start: 0, end: 0 }
  }
  const start = Math.max(0, rowStart * cols)
  const end = Math.min(itemCount, rowEnd * cols)
  return { start, end }
}
