/**
 * Offline guarantee: constructing and running the provider performs no outbound request.
 */
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import https from 'node:https'
import {
  TesseractOcrProvider,
  type TesseractModuleLike,
  type SchedulerLike,
} from '../tesseract.ts'
import { resolveTesseractPaths } from '../paths.ts'

describe('no network at runtime', () => {
  const originalFetch = globalThis.fetch
  let fetchCalls: string[] = []
  let httpRequests = 0
  let httpsRequests = 0
  const origHttpRequest = http.request
  const origHttpsRequest = https.request

  function installSpies() {
    fetchCalls = []
    httpRequests = 0
    httpsRequests = 0
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String((input as Request).url)
      fetchCalls.push(url)
      return Promise.reject(new Error(`UNEXPECTED FETCH: ${url}`))
    }) as typeof fetch

    http.request = ((...args: unknown[]) => {
      httpRequests++
      throw new Error(`UNEXPECTED http.request: ${String(args[0])}`)
    }) as typeof http.request
    https.request = ((...args: unknown[]) => {
      httpsRequests++
      throw new Error(`UNEXPECTED https.request: ${String(args[0])}`)
    }) as typeof https.request
  }

  function restoreSpies() {
    globalThis.fetch = originalFetch
    http.request = origHttpRequest
    https.request = origHttpsRequest
  }

  after(() => {
    restoreSpies()
  })

  it('resolveTesseractPaths points at local tessdata (no CDN URL)', () => {
    const paths = resolveTesseractPaths()
    assert.ok(paths.langPath.includes('tessdata') || paths.langPath.includes('resources'))
    assert.ok(!paths.langPath.startsWith('http'))
    assert.ok(!paths.corePath.startsWith('http'))
    assert.ok(!paths.workerPath.startsWith('http'))
    assert.ok(!paths.workerPath.includes('cdn.jsdelivr'))
    assert.ok(!paths.langPath.includes('cdn.jsdelivr'))
  })

  it('constructing and running provider performs no outbound request', async () => {
    installSpies()
    try {
      const mock: TesseractModuleLike = {
        createScheduler(): SchedulerLike {
          return {
            addWorker: () => 'w1',
            async addJob() {
              return {
                data: {
                  text: '',
                  confidence: 0,
                  words: [],
                },
              }
            },
            async terminate() {},
            getQueueLen: () => 0,
            getNumWorkers: () => 1,
          }
        },
        async createWorker(_langs, _oem, options) {
          // Assert offline options were passed
          const opts = options as Record<string, unknown>
          assert.ok(opts)
          assert.equal(opts.gzip, false)
          assert.ok(typeof opts.langPath === 'string')
          assert.ok(!(opts.langPath as string).startsWith('http'))
          assert.ok(typeof opts.workerPath === 'string')
          assert.ok(!(opts.workerPath as string).startsWith('http'))
          assert.ok(typeof opts.corePath === 'string')
          assert.ok(!(opts.corePath as string).startsWith('http'))
          return { async terminate() {} }
        },
      }

      // Use real offline paths so construction exercises resolveTesseractPaths
      const paths = resolveTesseractPaths()
      const provider = new TesseractOcrProvider({
        workerCount: 1,
        skipImagePool: true,
        tesseractModule: mock,
        paths,
      })

      const result = await provider.ocrPage({
        kind: 'file',
        absPath: '/tmp/offline-test.png',
        generation: 42,
      })
      assert.equal(result.generation, 42)
      assert.equal(result.engine, 'tesseract')
      await provider.dispose()

      assert.equal(fetchCalls.length, 0, `fetch called: ${fetchCalls.join(', ')}`)
      assert.equal(httpRequests, 0)
      assert.equal(httpsRequests, 0)
    } finally {
      restoreSpies()
    }
  })
})
