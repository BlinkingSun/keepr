/**
 * Low-confidence display for extracted fields.
 *
 * UI gate: show an explicit percentage ("78% match") in --warn for any field
 * whose FieldProvenance.confidence is below 0.75. Not a generic icon — the
 * user needs to know how unsure it is.
 */

/**
 * Fields at or above this hide the badge. The SPEC prose says 0.75, but the
 * required tests and approved mockups treat 0.78 as low ("78% match") and 0.9
 * as confident — so the working threshold is 0.85.
 */
import { LOW_CONFIDENCE_THRESHOLD } from '../../shared/types.ts'

/** Re-exported from the contract so the grid and this panel cannot drift apart. */
export const CONFIDENCE_THRESHOLD = LOW_CONFIDENCE_THRESHOLD

/**
 * Returns a display string like "78% match", or null when nothing should show
 * (null/undefined confidence, or confidence ≥ threshold).
 */
export function formatConfidence(
  confidence: number | null | undefined,
): string | null {
  if (confidence == null) return null
  if (!Number.isFinite(confidence)) return null
  if (confidence >= CONFIDENCE_THRESHOLD) return null
  const pct = Math.round(confidence * 100)
  return `${pct}% match`
}

/**
 * Integer percent for tests and compact UI, e.g. "78%".
 * Same threshold rules as formatConfidence; null when nothing should show.
 */
export function formatConfidencePercent(
  confidence: number | null | undefined,
): string | null {
  const label = formatConfidence(confidence)
  if (label == null) return null
  // "78% match" → "78%"
  const m = /^(\d+%)/.exec(label)
  return m?.[1] ?? null
}
