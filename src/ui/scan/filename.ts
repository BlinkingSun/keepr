/**
 * Filename preview for the scan dialog (matches scanToFiles naming).
 */
import { formatScanBaseName } from '../../scan/types.ts'

export function previewFileName(now: Date, page = 1): string {
  return `${formatScanBaseName(now)} p${page}.jpg`
}

export function previewFileNames(now: Date, pageCount: number): string[] {
  const n = Math.max(0, pageCount)
  return Array.from({ length: n }, (_, i) => previewFileName(now, i + 1))
}
