/**
 * Lane C — Ingest: import, Inbox queue, OCR orchestration, extraction.
 */

export { importFiles, waitForImportOcr, type ImportFilesRequest } from './import.ts'
export { runOcrJob, type OcrJobOutcome } from './ocrRunner.ts'
export {
  extractItem,
  extractFromStoredPages,
  type ExtractOptions,
  type ExtractOutcome,
} from './extract.ts'
export {
  listInbox,
  markReviewed,
  fileInto,
  nextUnreviewed,
  inboxCount,
} from './inbox.ts'
export { parseVCards, type ParsedVCard } from './vcard.ts'
export type {
  IngestDeps,
  IngestJobQueue,
  IngestImportOptions,
  OcrPageWork,
} from './types.ts'
