/**
 * OCR provider seam. Nothing outside src/ocr may know Tesseract exists —
 * Phase 4 swaps in a vision-model provider behind OcrProvider.
 */

import type { OcrProvider } from '../shared/types.ts'
import {
  createTesseractProvider,
  type TesseractProviderOptions,
} from './tesseract.ts'

export type { TesseractProviderOptions }

export interface CreateOcrProviderOptions extends TesseractProviderOptions {
  /** Provider id. Only 'tesseract' is implemented in Phase 1. */
  engine?: 'tesseract'
}

/**
 * Construct the process-local OCR provider. Callers should reuse the instance;
 * the underlying Tesseract scheduler is created once per instance.
 */
export function createOcrProvider(options: CreateOcrProviderOptions = {}): OcrProvider {
  const engine = options.engine ?? 'tesseract'
  if (engine !== 'tesseract') {
    throw new Error(`Unknown OCR engine: ${engine}`)
  }
  return createTesseractProvider(options)
}

export { createTesseractProvider, TesseractOcrProvider } from './tesseract.ts'
export { resolveTesseractPaths } from './paths.ts'
export { parseReceipt, ocrFromText, type ParseHints } from './parse/receipt.ts'
export { parseMoney, findMoneyInText } from './parse/money.ts'
export { parseDate, findDateInText, resolveDateOrder } from './parse/date.ts'
