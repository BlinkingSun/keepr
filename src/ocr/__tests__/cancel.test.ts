/**
 * Cancellation via AbortSignal stops queued work.
 */
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  TesseractOcrProvider,
  type TesseractModuleLike,
  type SchedulerLike,
  type WorkerLike,
} from '../tesseract.ts'

function slowMockTess(delayMs: number): TesseractModuleLike {
  return {
    createScheduler(): SchedulerLike {
      const ws: WorkerLike[] = []
      return {
        addWorker(w) {
          ws.push(w)
          return `w-${ws.length}`
        },
        async addJob() {
          await new Promise((r) => setTimeout(r, delayMs))
          return {
            data: { text: 'ok', confidence: 80, words: [] },
          }
        },
        async terminate() {},
        getQueueLen: () => 0,
        getNumWorkers: () => ws.length,
      }
    },
    async createWorker() {
      return { async terminate() {} }
    },
  }
}

describe('AbortSignal cancellation', () => {
  let provider: TesseractOcrProvider

  after(async () => {
    if (provider) await provider.dispose()
  })

  it('pre-aborted signal rejects without leaving pending work', async () => {
    provider = new TesseractOcrProvider({
      workerCount: 1,
      skipImagePool: true,
      tesseractModule: slowMockTess(50),
      paths: {
        workerPath: '/fake/worker.js',
        corePath: '/fake/core',
        langPath: '/fake/lang',
        tessdataDir: '/fake/lang',
      },
    })

    const ac = new AbortController()
    ac.abort()
    await assert.rejects(
      () =>
        provider.ocrPage(
          { kind: 'file', absPath: '/tmp/x.png', generation: 1 },
          { signal: ac.signal },
        ),
      (e: Error) => e.name === 'AbortError',
    )
    assert.equal(provider.hasPendingWork(), false)
  })

  it('abort during flight clears pending tracking', async () => {
    provider = new TesseractOcrProvider({
      workerCount: 1,
      skipImagePool: true,
      tesseractModule: slowMockTess(200),
      paths: {
        workerPath: '/fake/worker.js',
        corePath: '/fake/core',
        langPath: '/fake/lang',
        tessdataDir: '/fake/lang',
      },
    })

    const ac = new AbortController()
    const p = provider.ocrPage(
      { kind: 'file', absPath: '/tmp/y.png', generation: 1 },
      { signal: ac.signal },
    )
    // Let it start
    await new Promise((r) => setTimeout(r, 20))
    ac.abort()
    await assert.rejects(() => p, (e: Error) => e.name === 'AbortError')
    // Allow finally blocks to run
    await new Promise((r) => setTimeout(r, 30))
    assert.equal(provider.hasPendingWork(), false)
  })
})
