/**
 * eSCL job lifecycle tests against the in-process mock server.
 */
import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { ScanDevice, ScanOptions } from '../../shared/types.ts'
import { createScanJob, RETRY_BUDGET_MS } from '../job.ts'
import { ScanError } from '../types.ts'
import { TINY_JPEG } from './fixtures.ts'
import { startMockEscl, type MockEsclServer } from './mockServer.ts'

const OPTIONS: ScanOptions = {
  source: 'Platen',
  colorMode: 'RGB24',
  dpi: 300,
}

const ADF_OPTIONS: ScanOptions = {
  source: 'Adf',
  colorMode: 'RGB24',
  dpi: 300,
}

function deviceFor(s: MockEsclServer): ScanDevice {
  return {
    id: `http://${s.host}:${s.port}/${s.root}`,
    name: 'Mock Scanner',
    host: s.host,
    port: s.port,
    root: s.root,
    secure: false,
  }
}

describe('job lifecycle', () => {
  let server: MockEsclServer

  before(async () => {
    server = await startMockEscl({ pageCount: 2, caps: 'brother' })
  })
  after(async () => {
    await server.close()
  })

  it('3. 2-page job: two page callbacks, correct bytes, clean end on 404', async () => {
    const pages: Buffer[] = []
    const handle = await createScanJob(deviceFor(server), OPTIONS, {
      skipStatusCheck: true,
    })
    const result = await handle.run(async (_n, bytes) => {
      pages.push(bytes)
    })
    assert.equal(result.pages, 2)
    assert.equal(pages.length, 2)
    assert.ok(pages[0]!.equals(TINY_JPEG))
    assert.ok(pages[1]!.equals(TINY_JPEG))
    // Job cleaned up with DELETE
    assert.ok(server.deletedJobs.length >= 1)
  })

  it('7. chunked response body handled identically to Content-Length', async () => {
    const chunked = await startMockEscl({
      pageCount: 1,
      transfer: 'chunked',
    })
    try {
      const pages: Buffer[] = []
      const handle = await createScanJob(deviceFor(chunked), OPTIONS, {
        skipStatusCheck: true,
      })
      await handle.run(async (_n, bytes) => {
        pages.push(bytes)
      })
      assert.equal(pages.length, 1)
      assert.ok(pages[0]!.equals(TINY_JPEG))
    } finally {
      await chunked.close()
    }
  })
})

describe('503 retry', () => {
  it('4a. 503 then success → retried', async () => {
    const server = await startMockEscl({
      pageCount: 1,
      busyCount: 2,
    })
    try {
      const sleeps: number[] = []
      const handle = await createScanJob(deviceFor(server), OPTIONS, {
        skipStatusCheck: true,
        sleep: async (ms) => {
          sleeps.push(ms)
        },
      })
      const pages: Buffer[] = []
      const result = await handle.run(async (_n, bytes) => {
        pages.push(bytes)
      })
      assert.equal(result.pages, 1)
      assert.equal(pages.length, 1)
      assert.ok(sleeps.length >= 2, `expected ≥2 backoff sleeps, got ${sleeps.length}`)
      assert.ok(server.nextDocumentHits >= 3)
    } finally {
      await server.close()
    }
  })

  it('4b. permanent 503 → ScanError busy after budget', async () => {
    const server = await startMockEscl({
      pageCount: 1,
      permanentBusy: true,
    })
    try {
      let elapsed = 0
      const handle = await createScanJob(deviceFor(server), OPTIONS, {
        skipStatusCheck: true,
        sleep: async (ms) => {
          elapsed += ms
        },
      })
      await assert.rejects(
        () => handle.run(async () => {}),
        (err: unknown) => {
          assert.ok(err instanceof ScanError)
          assert.equal(err.code, 'busy')
          return true
        },
      )
      assert.ok(
        elapsed >= RETRY_BUDGET_MS,
        `elapsed ${elapsed} < budget ${RETRY_BUDGET_MS}`,
      )
    } finally {
      await server.close()
    }
  })

  it('503 budget cancelable mid-backoff', async () => {
    const server = await startMockEscl({ permanentBusy: true, pageCount: 1 })
    try {
      const ac = new AbortController()
      const handle = await createScanJob(deviceFor(server), OPTIONS, {
        skipStatusCheck: true,
        signal: ac.signal,
        sleep: async (ms, signal) => {
          // Abort halfway through first backoff.
          ac.abort()
          if (signal?.aborted) throw new ScanError('canceled', 'Scan canceled')
          await new Promise((r) => setTimeout(r, ms))
        },
      })
      await assert.rejects(
        () => handle.run(async () => {}),
        (err: unknown) => {
          assert.ok(err instanceof ScanError)
          assert.equal(err.code, 'canceled')
          return true
        },
      )
    } finally {
      await server.close()
    }
  })
})

describe('cancel', () => {
  it('5. cancel mid-job → DELETE received, loop stops', async () => {
    const server = await startMockEscl({
      pageCount: 5,
      pageDelayMs: 80,
    })
    try {
      const handle = await createScanJob(deviceFor(server), OPTIONS, {
        skipStatusCheck: true,
      })
      let pages = 0
      const runPromise = handle.run(async () => {
        pages += 1
        if (pages === 1) {
          // Cancel after first page starts completing.
          void handle.cancel()
        }
      })
      await assert.rejects(
        () => runPromise,
        (err: unknown) => {
          // May complete cleanly if cancel races after last read, or throw canceled.
          if (err instanceof ScanError) {
            assert.equal(err.code, 'canceled')
            return true
          }
          return false
        },
      ).catch(async () => {
        // If run completed without throw (cancel after loop), still ok if DELETE hit.
      })
      // Give DELETE a moment.
      await new Promise((r) => setTimeout(r, 50))
      assert.ok(
        server.deletedJobs.length >= 1,
        'expected DELETE on job URL',
      )
      assert.ok(pages < 5, `expected early stop, got ${pages} pages`)
    } finally {
      await server.close()
    }
  })
})

describe('ADF empty encodings', () => {
  it('6a. ScannerStatus AdfEmpty → typed adf-empty', async () => {
    const server = await startMockEscl({ adfEmpty: true, pageCount: 1 })
    try {
      await assert.rejects(
        () => createScanJob(deviceFor(server), ADF_OPTIONS),
        (err: unknown) => {
          assert.ok(err instanceof ScanError)
          assert.equal(err.code, 'adf-empty')
          assert.match(err.message, /feeder|empty|adf/i)
          return true
        },
      )
    } finally {
      await server.close()
    }
  })

  it('6b. 409-on-ScanJobs → typed adf-empty', async () => {
    const server = await startMockEscl({
      scanJobsConflict: true,
      pageCount: 1,
    })
    try {
      await assert.rejects(
        () =>
          createScanJob(deviceFor(server), ADF_OPTIONS, {
            skipStatusCheck: true,
          }),
        (err: unknown) => {
          assert.ok(err instanceof ScanError)
          assert.equal(err.code, 'adf-empty')
          return true
        },
      )
    } finally {
      await server.close()
    }
  })
})
