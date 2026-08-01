/**
 * Scan orchestration: pages → temp files → importPagesAsItem → Old/New Receipts.
 *
 * CRITICAL staging order (audit):
 *   1. Write pages to <library>/.scan-tmp/<jobId>/ (tmpDir)
 *   2. Ingest as ONE multi-page item via importPagesAsItem
 *   3. Move into Old Receipts ONLY after the item commits
 *   Crash before commit leaves temp (cleaned on startup), never a file in Old
 *   without an item. Ingest failure → pages moved to New Receipts (visible as
 *   unprocessed).
 *
 * Device-phase progress goes ONLY on scan:* events (jobId from orchestration).
 * The job row's detail is {source:'scan', deviceId, pages} so the UI can demux.
 */
import { mkdir, rename, writeFile, copyFile, unlink, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import type { ScanDevice, ScanErrorCode, ScanOptions } from '../shared/types.ts'
import { fetchCapabilities } from './capabilities.ts'
import { createScanJob, type CreateJobOpts } from './job.ts'
import {
  formatScanBaseName,
  ScanError,
  type Clock,
} from './types.ts'

export interface ScanToFilesIo {
  /** Final directory for page files within the staging area (usually tmpDir). */
  tmpDir: string
  /** Optional alias kept for call-site clarity; pages always land in tmpDir. */
  destDir?: string
  baseName?: string
  onPage?: (n: number, absPath: string) => void | Promise<void>
  now?: Clock
  /** Job options forwarded to createScanJob. */
  jobOpts?: CreateJobOpts
}

/**
 * Run a scan and write JPEG pages into tmpDir with atomic temp→rename.
 * Returns absolute paths in page order. No DB access.
 */
export async function scanToFiles(
  device: ScanDevice,
  options: ScanOptions,
  io: ScanToFilesIo,
): Promise<string[]> {
  if (device.secure) {
    throw new ScanError(
      'tls-unsupported',
      'TLS (eSCL over HTTPS / _uscans._tcp) scanners are listed but not yet scannable in this version.',
    )
  }

  // Capabilities check (format refusal, auth, etc.) before creating a job.
  await fetchCapabilities(device, { signal: io.jobOpts?.signal })

  const dir = io.tmpDir
  await mkdir(dir, { recursive: true })
  const base = io.baseName ?? formatScanBaseName((io.now ?? (() => new Date()))())
  const paths: string[] = []

  const handle = await createScanJob(device, options, io.jobOpts)
  try {
    await handle.run(async (n, bytes) => {
      const finalName = `${base} p${n}.jpg`
      const finalPath = path.join(dir, finalName)
      const partialPath = finalPath + '.partial'
      await writeFile(partialPath, bytes)
      await rename(partialPath, finalPath)
      paths.push(finalPath)
      if (io.onPage) await io.onPage(n, finalPath)
    })
  } catch (err) {
    // Clean partials left behind on failure/cancel.
    await cleanupPartials(dir)
    if (!handle.canceled) {
      try {
        await handle.cancel()
      } catch {
        /* ignore */
      }
    }
    throw err
  }

  return paths
}

/** Ingest stub signature matching IPC 'ingest:importPagesAsItem'. */
export type ImportPagesAsItem = (args: {
  paths: string[]
  targetFolderId?: number
  toInbox?: boolean
}) => Promise<{ itemId: number; pageCount: number; jobId: string }>

export type ScanEventEmitter = (
  channel: 'scan:progress' | 'scan:done' | 'scan:error',
  payload: unknown,
) => void

export interface ScanAndIngestDeps {
  importPagesAsItem: ImportPagesAsItem
  /** Device-phase progress ONLY on scan:* — never job:progress for this phase. */
  emit?: ScanEventEmitter
  now?: Clock
  /** Injectable move (default: rename, EXDEV → copy+unlink). */
  moveFile?: (from: string, toDir: string) => Promise<string>
  jobOpts?: CreateJobOpts
}

export interface ScanAndIngestIo {
  /** Library job id — used on every scan:* event for UI demux. */
  jobId: string
  /** Staging: <library>/.scan-tmp/<jobId>/ */
  tmpDir: string
  oldReceiptsDir: string
  newReceiptsDir: string
  baseName?: string
  onPage?: (n: number, absPath: string) => void | Promise<void>
}

export interface ScanAndIngestResult {
  itemId: number
  pages: number
  files: string[]
  /** Job detail shape for the library job row (UI demux by detail.source). */
  jobDetail: { source: 'scan'; deviceId: string; pages: number }
}

/**
 * Full scan → ingest → archive choreography.
 * Progress: scan:progress {jobId, page, state} only.
 * Success: files in Old Receipts + scan:done.
 * Ingest failure: files moved to New Receipts + scan:error; throws.
 */
export async function scanAndIngest(
  deps: ScanAndIngestDeps,
  device: ScanDevice,
  options: ScanOptions,
  io: ScanAndIngestIo,
): Promise<ScanAndIngestResult> {
  const emit = deps.emit ?? (() => {})
  const moveFile = deps.moveFile ?? moveIntoDir
  const jobDetailBase = { source: 'scan' as const, deviceId: device.id }

  let pagePaths: string[] = []

  try {
    pagePaths = await scanToFiles(device, options, {
      tmpDir: io.tmpDir,
      baseName: io.baseName,
      now: deps.now,
      jobOpts: deps.jobOpts,
      onPage: async (n, absPath) => {
        emit('scan:progress', { jobId: io.jobId, page: n, state: 'scanning' })
        emit('scan:progress', { jobId: io.jobId, page: n, state: 'done' })
        if (io.onPage) await io.onPage(n, absPath)
      },
    })

    if (pagePaths.length === 0) {
      // Platen with nothing? Treat as protocol — device returned no pages.
      throw new ScanError('protocol', 'Scan completed with zero pages')
    }

    let ingestResult: { itemId: number; pageCount: number; jobId: string }
    try {
      ingestResult = await deps.importPagesAsItem({
        paths: pagePaths,
        toInbox: true,
      })
    } catch (err) {
      // Ingest failure → move pages to New Receipts so they stay visible.
      const moved: string[] = []
      await mkdir(io.newReceiptsDir, { recursive: true })
      for (const p of pagePaths) {
        try {
          moved.push(await moveFile(p, io.newReceiptsDir))
        } catch {
          /* best effort */
        }
      }
      const message =
        err instanceof Error ? err.message : `Ingest failed: ${String(err)}`
      emit('scan:error', {
        jobId: io.jobId,
        code: 'protocol' satisfies ScanErrorCode,
        message: `Scan saved to New Receipts (ingest failed): ${message}`,
      })
      throw new ScanError(
        'protocol',
        `Ingest failed; pages moved to New Receipts: ${message}`,
      )
    }

    // Commit succeeded → move into Old Receipts.
    await mkdir(io.oldReceiptsDir, { recursive: true })
    const finalFiles: string[] = []
    for (const p of pagePaths) {
      finalFiles.push(await moveFile(p, io.oldReceiptsDir))
    }

    // Clean empty tmp dir.
    try {
      await rm(io.tmpDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }

    emit('scan:done', {
      jobId: io.jobId,
      itemIds: [ingestResult.itemId],
      pages: finalFiles.length,
      files: finalFiles,
    })

    return {
      itemId: ingestResult.itemId,
      pages: finalFiles.length,
      files: finalFiles,
      jobDetail: { ...jobDetailBase, pages: finalFiles.length },
    }
  } catch (err) {
    const code: ScanErrorCode =
      err instanceof ScanError ? err.code : 'protocol'
    const message = err instanceof Error ? err.message : String(err)
    // Avoid double-emitting if ingest path already emitted.
    if (!(err instanceof ScanError && message.includes('Ingest failed'))) {
      emit('scan:error', { jobId: io.jobId, code, message })
    }
    throw err instanceof ScanError
      ? err
      : new ScanError('protocol', message)
  }
}

/** Build the job detail object orchestrators should store on the job row. */
export function scanJobDetail(
  deviceId: string,
  pages: number,
): { source: 'scan'; deviceId: string; pages: number } {
  return { source: 'scan', deviceId, pages }
}

async function moveIntoDir(from: string, toDir: string): Promise<string> {
  await mkdir(toDir, { recursive: true })
  const base = path.basename(from)
  let dest = path.join(toDir, base)
  dest = await uniquePath(dest)
  try {
    await rename(from, dest)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code === 'EXDEV') {
      await copyFile(from, dest)
      await unlink(from)
    } else {
      throw err
    }
  }
  return dest
}

async function uniquePath(dest: string): Promise<string> {
  const { access } = await import('node:fs/promises')
  try {
    await access(dest)
  } catch {
    return dest
  }
  const ext = path.extname(dest)
  const stem = dest.slice(0, dest.length - ext.length)
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${stem} (${i})${ext}`
    try {
      await access(candidate)
    } catch {
      return candidate
    }
  }
  return `${stem} (${Date.now()})${ext}`
}

async function cleanupPartials(dir: string): Promise<void> {
  try {
    const names = await readdir(dir)
    await Promise.all(
      names
        .filter((n) => n.endsWith('.partial'))
        .map((n) => unlink(path.join(dir, n)).catch(() => {})),
    )
  } catch {
    /* ignore */
  }
}
