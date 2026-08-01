/**
 * Shared dependency bundle for Lane C ingest.
 * Workers/providers return data; only ingest modules write to SQLite.
 */

import type { ImagePool } from '../workers/imagePool.ts'
import type {
  FileStore,
  Job,
  JobKind,
  JobProgressEvent,
  JobQueue,
  OcrProvider,
} from '../shared/types.ts'
import type { Repositories } from '../db/repo/index.ts'

/** JobQueue plus the cancellation / finish helpers SqliteJobQueue exposes. */
export interface IngestJobQueue extends JobQueue {
  isCancelled(id: string): boolean
  finish(id: string): Promise<Job>
  bump(id: string, kind: 'done' | 'failed', by?: number): Promise<Job>
}

/**
 * One page queued for OCR after import. Absolute path is resolved at OCR time
 * via FileStore — we keep the relative path so a library move cannot break work.
 */
export interface OcrPageWork {
  pageId: number
  itemId: number
  fileRelPath: string
  /** Captured at queue time; re-read before apply for generation check. */
  generation: number
}

export interface IngestDeps {
  repos: Repositories
  fileStore: FileStore
  jobs: IngestJobQueue
  ocr: OcrProvider
  imagePool: ImagePool
  /** Max concurrent OCR pages. Default 2. Does NOT spawn a second worker pool. */
  ocrConcurrency?: number
  /**
   * When true, importFiles awaits OCR completion (useful for tests).
   * Production leaves this false so the job id returns immediately.
   */
  awaitOcr?: boolean
  /** Optional hook after each successful OCR apply (e.g. to run extraction). */
  onPageOcrDone?: (info: { pageId: number; itemId: number; applied: boolean }) => void | Promise<void>
}

/** ImportRequest fields the IPC contract lacks but the SPEC requires. */
export type IngestImportOptions = {
  /** When true, each PDF page becomes its own item. Default false. */
  splitPages?: boolean
  /**
   * Wait for OCR before returning, overriding deps.awaitOcr for this call.
   *
   * This was previously readable only from IngestDeps while every caller — the
   * HTTP /import route included — passed it on the request. Object spread bypasses
   * TypeScript's excess-property check, so it compiled, silently did nothing, and
   * an import of 12 files reported every page as still 'pending'. A flag that is
   * accepted and ignored is worse than one that does not exist.
   */
  awaitOcr?: boolean
}

export type { Job, JobKind, JobProgressEvent, OcrProvider, FileStore, Repositories }
