/**
 * Lane T — Thumbnail panel public surface.
 * Pure presentation over props. Orchestrator mounts when view === 'thumbnail'.
 */
export { ThumbPanel } from './ThumbPanel.tsx'
export type { ThumbPanelProps } from './ThumbPanel.tsx'

export {
  columnCount,
  colWidthFor,
  rowHeightFor,
  cardHeightFor,
  thumbHeightFor,
  layoutMetrics,
  overscanRows,
  thumbWindow,
  itemRangeForRows,
  MIN_CARD,
  GAP,
  CAPTION_H,
  THUMB_ASPECT,
  MAX_MOUNTED_CARDS,
} from './thumbLayout.ts'
export type { LayoutMetrics, ThumbWindow, ThumbWindowInput } from './thumbLayout.ts'

export { navigate2d, idAtIndex, indexOfId } from './nav2d.ts'
export type { Nav2dAction } from './nav2d.ts'

export { placeholderLabel, needsPlaceholder } from './placeholder.ts'
export { flagKind } from './flagKind.ts'
export type { FlagKind, FlagInfo } from './flagKind.ts'
