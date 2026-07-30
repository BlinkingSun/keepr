/**
 * Job queue — Lane 0, owned by the orchestrator.
 *
 * Persisted rather than in-memory so import and OCR progress survives a restart,
 * and so the headless test API has real state to poll instead of a promise nobody
 * else can see.
 *
 * `partial` is a first-class outcome, not a rounding of the truth: a ten-page PDF
 * where page seven fails OCR is neither a success nor a failure, and collapsing
 * it to either one throws away the only information the user needs.
 */
import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { Job, JobKind, JobProgressEvent, JobQueue, JobStatus } from '../shared/types.ts'

type ProgressFn = (e: JobProgressEvent) => void

interface JobRow {
  id: string
  kind: JobKind
  status: JobStatus
  total_units: number
  done_units: number
  failed_units: number
  detail_json: string | null
  error: string | null
  created_at: number
  updated_at: number
}

const toJob = (r: JobRow): Job => ({
  id: r.id,
  kind: r.kind,
  status: r.status,
  totalUnits: r.total_units,
  doneUnits: r.done_units,
  failedUnits: r.failed_units,
  detail: r.detail_json ? JSON.parse(r.detail_json) : null,
  error: r.error,
  createdAt: r.created_at as Job['createdAt'],
  updatedAt: r.updated_at as Job['updatedAt'],
})

export class SqliteJobQueue implements JobQueue {
  #db: Database.Database
  #listeners = new Set<ProgressFn>()
  #cancelled = new Set<string>()

  constructor(db: Database.Database) {
    this.#db = db
  }

  async create(kind: JobKind, totalUnits: number, detail?: unknown): Promise<Job> {
    const id = randomUUID()
    const now = Date.now()
    this.#db
      .prepare(
        `INSERT INTO job(id, kind, status, total_units, done_units, failed_units, detail_json, created_at, updated_at)
         VALUES (?,?,'queued',?,0,0,?,?,?)`,
      )
      .run(id, kind, totalUnits, detail === undefined ? null : JSON.stringify(detail), now, now)
    const job = await this.get(id)
    this.#emit(job!)
    return job!
  }

  async update(
    id: string,
    patch: Partial<Pick<Job, 'status' | 'doneUnits' | 'failedUnits' | 'error' | 'detail'>>,
  ): Promise<Job> {
    const sets: string[] = []
    const params: unknown[] = []
    if (patch.status !== undefined) { sets.push('status = ?'); params.push(patch.status) }
    if (patch.doneUnits !== undefined) { sets.push('done_units = ?'); params.push(patch.doneUnits) }
    if (patch.failedUnits !== undefined) { sets.push('failed_units = ?'); params.push(patch.failedUnits) }
    if (patch.error !== undefined) { sets.push('error = ?'); params.push(patch.error) }
    if (patch.detail !== undefined) { sets.push('detail_json = ?'); params.push(JSON.stringify(patch.detail)) }
    sets.push('updated_at = ?')
    params.push(Date.now(), id)

    this.#db.prepare(`UPDATE job SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    const job = await this.get(id)
    if (!job) throw new Error(`job ${id} disappeared`)
    this.#emit(job)
    return job
  }

  /**
   * Close a job out by counting what actually happened, so callers cannot
   * accidentally report a clean success over the top of failed units.
   */
  async finish(id: string): Promise<Job> {
    const job = await this.get(id)
    if (!job) throw new Error(`job ${id} not found`)
    if (this.#cancelled.has(id)) return this.update(id, { status: 'cancelled' })
    const status: JobStatus =
      job.failedUnits === 0 ? 'done' : job.doneUnits === 0 ? 'failed' : 'partial'
    return this.update(id, { status })
  }

  async bump(id: string, kind: 'done' | 'failed', by = 1): Promise<Job> {
    const col = kind === 'done' ? 'done_units' : 'failed_units'
    this.#db.prepare(`UPDATE job SET ${col} = ${col} + ?, updated_at = ? WHERE id = ?`).run(by, Date.now(), id)
    const job = await this.get(id)
    this.#emit(job!)
    return job!
  }

  async get(id: string): Promise<Job | null> {
    const row = this.#db.prepare(`SELECT * FROM job WHERE id = ?`).get(id) as JobRow | undefined
    return row ? toJob(row) : null
  }

  async cancel(id: string): Promise<void> {
    this.#cancelled.add(id)
    const row = this.#db.prepare(`SELECT status FROM job WHERE id = ?`).get(id) as { status: JobStatus } | undefined
    // Terminal jobs are left alone: cancelling something already finished would
    // rewrite history rather than stop work.
    if (row && (row.status === 'queued' || row.status === 'running')) {
      await this.update(id, { status: 'cancelled' })
    }
  }

  isCancelled(id: string): boolean {
    return this.#cancelled.has(id)
  }

  onProgress(fn: ProgressFn): () => void {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  /**
   * Marks jobs left mid-flight by a crash or a forced quit. Called at startup:
   * a job stuck at 'running' forever would make the UI claim work is in progress
   * that nothing is actually doing.
   */
  reapOrphans(): number {
    const res = this.#db
      .prepare(
        `UPDATE job SET status = CASE WHEN done_units > 0 THEN 'partial' ELSE 'failed' END,
                        error = COALESCE(error, 'interrupted by shutdown'),
                        updated_at = ?
          WHERE status IN ('queued','running')`,
      )
      .run(Date.now())
    return res.changes
  }

  #emit(job: Job): void {
    const e: JobProgressEvent = {
      jobId: job.id,
      status: job.status,
      totalUnits: job.totalUnits,
      doneUnits: job.doneUnits,
      failedUnits: job.failedUnits,
    }
    for (const fn of this.#listeners) {
      // One bad listener must not take down the queue.
      try { fn(e) } catch { /* ignore */ }
    }
  }
}
