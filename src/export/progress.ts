/**
 * Job-queue progress for long-running exports.
 * No-ops cleanly when no queue is wired (unit tests).
 */
import type { Job, JobQueue } from '../shared/types.ts'
import type { ExportContext } from './types.ts'

export interface ProgressHandle {
  jobId: string | null
  setTotal(n: number): Promise<void>
  bump(done?: number): Promise<void>
  done(detail?: unknown): Promise<void>
  fail(error: string): Promise<void>
}

export async function beginExportProgress(
  ctx: ExportContext | undefined,
  format: string,
  destPath: string,
  totalUnits: number,
): Promise<ProgressHandle> {
  const q = ctx?.jobQueue
  if (!q) {
    return {
      jobId: null,
      async setTotal() {},
      async bump() {},
      async done() {},
      async fail() {},
    }
  }

  let job: Job = await q.create('export', totalUnits, { format, destPath })
  await q.update(job.id, { status: 'running' })

  let doneUnits = 0
  return {
    jobId: job.id,
    async setTotal(n: number) {
      job = await q.update(job.id, { detail: { format, destPath, totalUnits: n } })
      // total_units is set at create; re-create detail only. Bump tracking uses doneUnits.
      void job
    },
    async bump(by = 1) {
      doneUnits += by
      await q.update(job.id, { doneUnits, status: 'running' })
    },
    async done(detail?: unknown) {
      await q.update(job.id, {
        status: 'done',
        doneUnits: Math.max(doneUnits, totalUnits),
        detail: detail ?? { format, destPath },
      })
    },
    async fail(error: string) {
      await q.update(job.id, { status: 'failed', error })
    },
  }
}
