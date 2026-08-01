/**
 * Row flag severity — mirrors GridPanel's private RowFlag semantics exactly.
 * Pure so thumbnail badges stay in lockstep with the grid without importing
 * the panel component.
 */

import type { GridRow } from '../../shared/ipc.ts'

export type FlagKind = 'danger' | 'warn' | 'pending'

export interface FlagInfo {
  kind: FlagKind
  mark: '!' | '?' | '…'
  title: string
}

/**
 * Severity order (same as grid):
 *   1. needsManualEntry → danger "!"
 *   2. missing or low-confidence fields → warn "?"
 *   3. ocrStatus pending → pending "…"
 *   4. else null (clean row — no badge)
 */
export function flagKind(
  row: Pick<
    GridRow,
    | 'needsManualEntry'
    | 'ocrStatus'
    | 'ocrConfidence'
    | 'missingFields'
    | 'lowConfidenceFields'
  >,
): FlagInfo | null {
  if (row.needsManualEntry) {
    const why =
      row.ocrStatus === 'failed'
        ? 'OCR failed on this image — enter the details manually'
        : row.ocrConfidence != null && row.ocrConfidence < 0.3
          ? `Text was unreadable (${Math.round(row.ocrConfidence * 100)}% confidence) — enter the details manually`
          : 'This receipt has an image but no amount was found — enter it manually'
    return { kind: 'danger', mark: '!', title: why }
  }

  if (row.missingFields.length > 0 || row.lowConfidenceFields.length > 0) {
    const parts: string[] = []
    if (row.missingFields.length) parts.push(`missing: ${row.missingFields.join(', ')}`)
    if (row.lowConfidenceFields.length) {
      parts.push(`low confidence: ${row.lowConfidenceFields.join(', ')}`)
    }
    return { kind: 'warn', mark: '?', title: parts.join(' · ') }
  }

  if (row.ocrStatus === 'pending') {
    return {
      kind: 'pending',
      mark: '…',
      title: 'OCR still running',
    }
  }

  return null
}
