/**
 * OCR orchestration. Workers return data; only this module writes OCR results.
 * Does NOT create a second worker pool — tesseract.js already has its own threads.
 */

import type { OcrResult, OcrStatus } from '../shared/types.ts'
import type { IngestDeps, OcrPageWork } from './types.ts'

export interface OcrJobOutcome {
  jobId: string
  done: number
  failed: number
  cancelled: boolean
  status: 'done' | 'failed' | 'partial' | 'cancelled'
}

/**
 * Run OCR for a batch of pages under a job id, with bounded concurrency.
 * Honours ocr_generation: a result whose generation no longer matches is discarded.
 * Per-page failure does not fail the whole job (job ends `partial`).
 */
export async function runOcrJob(
  deps: IngestDeps,
  jobId: string,
  work: OcrPageWork[],
): Promise<OcrJobOutcome> {
  const concurrency = Math.max(1, deps.ocrConcurrency ?? 2)
  const pages = deps.repos.pages
  const db = deps.repos.db

  await deps.jobs.update(jobId, { status: 'running' })

  let done = 0
  let failed = 0
  let cancelled = false
  let cursor = 0

  const workers: Promise<void>[] = []

  const next = async (): Promise<void> => {
    while (true) {
      if (deps.jobs.isCancelled(jobId)) {
        cancelled = true
        return
      }
      const idx = cursor++
      if (idx >= work.length) return
      const item = work[idx]
      if (!item) return

      await processOnePage(deps, jobId, item, {
        onDone: () => {
          done++
        },
        onFailed: () => {
          failed++
        },
        onCancelled: () => {
          cancelled = true
        },
      })
    }
  }

  const n = Math.min(concurrency, Math.max(1, work.length))
  for (let i = 0; i < n; i++) {
    workers.push(next())
  }
  await Promise.all(workers)

  // Mark any remaining pages that never started as cancelled when job cancelled.
  if (cancelled) {
    for (const item of work) {
      const row = db
        .prepare(`SELECT ocr_status FROM page WHERE id = ?`)
        .get(item.pageId) as { ocr_status: string } | undefined
      if (row && (row.ocr_status === 'pending' || row.ocr_status === 'queued')) {
        pages.setOcrStatus(item.pageId, 'cancelled')
      }
    }
  }

  let status: OcrJobOutcome['status']
  if (cancelled) {
    status = 'cancelled'
    await deps.jobs.update(jobId, {
      status: 'cancelled',
      doneUnits: done,
      failedUnits: failed,
    })
  } else if (failed === 0) {
    status = 'done'
    await deps.jobs.update(jobId, {
      status: 'done',
      doneUnits: done,
      failedUnits: failed,
    })
  } else if (done === 0) {
    status = 'failed'
    await deps.jobs.update(jobId, {
      status: 'failed',
      doneUnits: done,
      failedUnits: failed,
    })
  } else {
    status = 'partial'
    await deps.jobs.update(jobId, {
      status: 'partial',
      doneUnits: done,
      failedUnits: failed,
    })
  }

  return { jobId, done, failed, cancelled, status }
}

interface PageCounters {
  onDone: () => void
  onFailed: () => void
  onCancelled: () => void
}

async function processOnePage(
  deps: IngestDeps,
  jobId: string,
  work: OcrPageWork,
  counters: PageCounters,
): Promise<void> {
  const pages = deps.repos.pages
  const db = deps.repos.db

  if (deps.jobs.isCancelled(jobId)) {
    counters.onCancelled()
    setStatusIfGeneration(db, work.pageId, work.generation, 'cancelled')
    return
  }

  // pending → queued → running, only if generation still matches.
  setStatusIfGeneration(db, work.pageId, work.generation, 'queued')
  const running = setStatusIfGeneration(db, work.pageId, work.generation, 'running')
  if (!running) {
    // Generation already advanced (e.g. crop) — skip without counting as failure.
    counters.onDone()
    await deps.jobs.bump(jobId, 'done')
    return
  }

  // Re-read generation in case it changed between queue and run.
  const row = db
    .prepare(`SELECT ocr_generation, file_relpath FROM page WHERE id = ?`)
    .get(work.pageId) as { ocr_generation: number; file_relpath: string } | undefined

  if (!row) {
    counters.onFailed()
    await deps.jobs.bump(jobId, 'failed')
    return
  }

  const generation = row.ocr_generation
  let absPath: string
  try {
    absPath = deps.fileStore.resolve(row.file_relpath as never)
  } catch (e: unknown) {
    pages.setOcrStatus(work.pageId, 'failed')
    counters.onFailed()
    await deps.jobs.bump(jobId, 'failed')
    void e
    return
  }

  if (deps.jobs.isCancelled(jobId)) {
    counters.onCancelled()
    setStatusIfGeneration(db, work.pageId, generation, 'cancelled')
    return
  }

  try {
    const result: OcrResult = await deps.ocr.ocrPage(
      { kind: 'file', absPath, generation },
      {},
    )

    // Ensure generation on result matches what we asked for (provider must echo).
    const toApply = {
      text: result.text,
      words: result.words,
      confidence: result.confidence,
      engine: result.engine,
      generation: result.generation,
    }

    const applied = pages.setOcrResult(work.pageId, toApply)
    if (applied.applied) {
      counters.onDone()
      await deps.jobs.bump(jobId, 'done')
      if (deps.onPageOcrDone) {
        await deps.onPageOcrDone({
          pageId: work.pageId,
          itemId: work.itemId,
          applied: true,
        })
      }
    } else {
      // Stale generation: discard. Do not mark failed — the page was invalidated.
      // Status should already be pending (or whatever invalidate set); leave it.
      const after = db
        .prepare(`SELECT ocr_status, ocr_generation FROM page WHERE id = ?`)
        .get(work.pageId) as { ocr_status: string; ocr_generation: number } | undefined
      if (after && after.ocr_status === 'running') {
        // We left it running but result was discarded — reset to pending.
        pages.setOcrStatus(work.pageId, 'pending')
      }
      counters.onDone()
      await deps.jobs.bump(jobId, 'done')
      if (deps.onPageOcrDone) {
        await deps.onPageOcrDone({
          pageId: work.pageId,
          itemId: work.itemId,
          applied: false,
        })
      }
    }
  } catch (e: unknown) {
    if (deps.jobs.isCancelled(jobId) || isAbortError(e)) {
      counters.onCancelled()
      setStatusIfGeneration(db, work.pageId, generation, 'cancelled')
      return
    }
    // Page failure does not fail the whole job.
    setStatusIfGeneration(db, work.pageId, generation, 'failed')
    // If generation advanced during OCR, setStatusIf may no-op; force failed only when still ours.
    const after = db
      .prepare(`SELECT ocr_status, ocr_generation FROM page WHERE id = ?`)
      .get(work.pageId) as { ocr_status: string; ocr_generation: number } | undefined
    if (after && after.ocr_generation === generation && after.ocr_status !== 'failed') {
      pages.setOcrStatus(work.pageId, 'failed')
    }
    counters.onFailed()
    await deps.jobs.bump(jobId, 'failed')
  }
}

function setStatusIfGeneration(
  db: IngestDeps['repos']['db'],
  pageId: number,
  generation: number,
  status: OcrStatus,
): boolean {
  const r = db
    .prepare(
      `UPDATE page SET ocr_status = ? WHERE id = ? AND ocr_generation = ?`,
    )
    .run(status, pageId, generation)
  return r.changes > 0
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message))
}
