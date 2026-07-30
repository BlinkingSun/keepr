/**
 * OOM guard: scheduler is created exactly once across 20 concurrent ocrPage calls.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  TesseractOcrProvider,
  getSchedulerCreateCount,
  resetSchedulerCreateCount,
  type SchedulerLike,
  type WorkerLike,
  type TesseractModuleLike,
} from '../tesseract.ts'

function mockTess(): TesseractModuleLike {
  let workers = 0
  return {
    createScheduler(): SchedulerLike {
      const queue: Array<() => void> = []
      const ws: WorkerLike[] = []
      return {
        addWorker(w) {
          ws.push(w)
          return `w-${ws.length}`
        },
        async addJob(_action, _image) {
          // Simulate a tiny bit of async work
          await new Promise((r) => setTimeout(r, 5))
          return {
            data: {
              text: 'TOTAL 1.00',
              confidence: 90,
              words: [
                {
                  text: 'TOTAL',
                  confidence: 90,
                  bbox: { x0: 0, y0: 0, x1: 40, y1: 12 },
                },
                {
                  text: '1.00',
                  confidence: 88,
                  bbox: { x0: 50, y0: 0, x1: 90, y1: 12 },
                },
              ],
            },
          }
        },
        async terminate() {
          ws.length = 0
          queue.length = 0
        },
        getQueueLen: () => queue.length,
        getNumWorkers: () => ws.length,
      }
    },
    async createWorker() {
      workers++
      return {
        id: `worker-${workers}`,
        async terminate() {},
      }
    },
  }
}

describe('scheduler singleton (OOM guard)', () => {
  let provider: TesseractOcrProvider

  before(() => {
    resetSchedulerCreateCount()
    provider = new TesseractOcrProvider({
      workerCount: 2,
      skipImagePool: true,
      tesseractModule: mockTess(),
      paths: {
        workerPath: '/fake/worker.js',
        corePath: '/fake/core',
        langPath: '/fake/lang',
        tessdataDir: '/fake/lang',
      },
    })
  })

  after(async () => {
    await provider.dispose()
  })

  it('creates scheduler exactly once across 20 concurrent ocrPage calls', async () => {
    resetSchedulerCreateCount()
    // Force re-init tracking: new provider after reset
    await provider.dispose()
    provider = new TesseractOcrProvider({
      workerCount: 2,
      skipImagePool: true,
      tesseractModule: mockTess(),
      paths: {
        workerPath: '/fake/worker.js',
        corePath: '/fake/core',
        langPath: '/fake/lang',
        tessdataDir: '/fake/lang',
      },
    })
    resetSchedulerCreateCount()

    const jobs = Array.from({ length: 20 }, (_, i) =>
      provider.ocrPage({
        kind: 'file',
        absPath: `/tmp/receipt-${i}.png`,
        generation: 1,
      }),
    )
    const results = await Promise.all(jobs)
    assert.equal(results.length, 20)
    for (const r of results) {
      assert.equal(r.engine, 'tesseract')
      assert.ok(r.words.length >= 1)
    }
    assert.equal(
      getSchedulerCreateCount(),
      1,
      `expected exactly 1 scheduler create, got ${getSchedulerCreateCount()}`,
    )
  })
})
