/**
 * Lane C / W — Ingest: import, Inbox queue, OCR orchestration, extraction,
 * directory walk, New/Old receipts watcher.
 */

export {
  importFiles,
  importPagesAsItem,
  waitForImportOcr,
  combinedSourceSha,
  type ImportFilesRequest,
  type ImportPagesAsItemRequest,
  type ImportPagesAsItemResult,
} from './import.ts'
export { walkForImportable, isPathInside, type WalkForImportableResult } from './dirwalk.ts'
export {
  createNewReceiptsWatcher,
  type TickResult,
  type WatcherActivity,
  type WatcherStatus,
  type WatchFoldersOpts,
} from './watchFolders.ts'
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
