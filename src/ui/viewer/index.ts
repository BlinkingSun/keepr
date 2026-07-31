/**
 * Lane G — Viewer panel public surface.
 */
export { ViewerPanel } from './ViewerPanel.tsx'
export type { ViewerPanelProps } from './ViewerPanel.tsx'

export {
  masterBoxToScreen,
  screenBoxToMaster,
  masterPointToScreen,
  screenPointToMaster,
  displaySize,
} from './geometry.ts'
export type { ViewportTransform } from './geometry.ts'

export { zoomFit, clampZoom } from './zoom.ts'
export { reorderPageIds } from './reorder.ts'
export {
  formatConfidence,
  formatConfidencePercent,
  CONFIDENCE_THRESHOLD,
} from './confidence.ts'
export { clampPageIndex, cycleRotation } from './navigation.ts'
