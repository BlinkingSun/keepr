/**
 * scanToFiles + scanAndIngest orchestration tests (stub ingest).
 */
import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, access, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ScanDevice, ScanOptions } from '../../shared/types.ts'
import { scanToFiles, scanAndIngest } from '../scanner.ts'
import { ScanError } from '../types.ts'
import { TINY_JPEG } from './fixtures.ts'
import { startMockEscl, type MockEsclServer } from './mockServer.ts'

const OPTIONS: ScanOptions = {
  source: 'Platen',
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

describe('scanToFiles', () => {
  let server: MockEsclServer
  let root: string

  before(async () => {
    server = await startMockEscl({ pageCount: 2 })
  })
  after(async () => {
    await server.close()
    if (root) await rm(root, { recursive: true, force: true })
  })
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'keepr-scan-'))
  })

  it('10. names, temp→rename atomicity (no .partial left), onPage order', async () => {
    const tmpDir = path.join(root, '.scan-tmp', 'job-1')
    const clock = () => new Date(Date.UTC(2026, 7, 1, 14, 32, 7)) // Aug is month 7
    // Use local-time constructor matching formatScanBaseName (local getters).
    const localClock = () => new Date(2026, 7, 1, 14, 32, 7)

    const order: number[] = []
    const paths = await scanToFiles(deviceFor(server), OPTIONS, {
      tmpDir,
      now: localClock,
      jobOpts: { skipStatusCheck: true },
      onPage: (n) => {
        order.push(n)
      },
    })

    assert.equal(paths.length, 2)
    assert.deepEqual(order, [1, 2])

    const base = 'Scan 2026-08-01 14.32.07'
    assert.ok(paths[0]!.endsWith(`${base} p1.jpg`))
    assert.ok(paths[1]!.endsWith(`${base} p2.jpg`))

    for (const p of paths) {
      const bytes = await readFile(p)
      assert.ok(bytes.equals(TINY_JPEG))
    }

    const names = await readdir(tmpDir)
    assert.ok(!names.some((n) => n.endsWith('.partial')), `partials left: ${names}`)
    assert.equal(names.filter((n) => n.endsWith('.jpg')).length, 2)

    // silence unused
    void clock
  })
})

describe('scanAndIngest', () => {
  let server: MockEsclServer
  let root: string

  before(async () => {
    server = await startMockEscl({ pageCount: 2 })
  })
  after(async () => {
    await server.close()
  })
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'keepr-scan-ing-'))
  })
  after(async () => {
    /* per-test cleanup in each test */
  })

  it('success: importPagesAsItem then move to Old Receipts; scan:done emitted', async () => {
    const tmpDir = path.join(root, '.scan-tmp', 'job-abc')
    const oldDir = path.join(root, 'Old Receipts')
    const newDir = path.join(root, 'New Receipts')
    await mkdir(oldDir, { recursive: true })
    await mkdir(newDir, { recursive: true })

    const events: Array<{ ch: string; payload: unknown }> = []
    let ingestedPaths: string[] = []

    const result = await scanAndIngest(
      {
        importPagesAsItem: async ({ paths }) => {
          ingestedPaths = paths
          // Paths must still be in tmp at ingest time (not yet in Old).
          for (const p of paths) {
            assert.ok(p.includes('.scan-tmp'), `ingest path not in tmp: ${p}`)
            await access(p)
          }
          // Old should not yet contain the scan pages.
          const oldNames = await readdir(oldDir).catch(() => [] as string[])
          assert.equal(oldNames.length, 0)
          return { itemId: 42, pageCount: paths.length, jobId: 'import-1' }
        },
        emit: (ch, payload) => events.push({ ch, payload }),
        now: () => new Date(2026, 7, 1, 14, 32, 7),
        jobOpts: { skipStatusCheck: true },
      },
      deviceFor(server),
      OPTIONS,
      {
        jobId: 'job-abc',
        tmpDir,
        oldReceiptsDir: oldDir,
        newReceiptsDir: newDir,
      },
    )

    assert.equal(result.itemId, 42)
    assert.equal(result.pages, 2)
    assert.equal(result.files.length, 2)
    assert.deepEqual(result.jobDetail, {
      source: 'scan',
      deviceId: deviceFor(server).id,
      pages: 2,
    })

    // After success: Old has files, tmp cleaned, New empty.
    const oldNames = await readdir(oldDir)
    assert.equal(oldNames.length, 2)
    const newNames = await readdir(newDir)
    assert.equal(newNames.length, 0)

    // Progress only on scan:* channels
    const channels = new Set(events.map((e) => e.ch))
    assert.ok(channels.has('scan:progress'))
    assert.ok(channels.has('scan:done'))
    assert.ok(!channels.has('job:progress' as 'scan:progress'))

    const done = events.find((e) => e.ch === 'scan:done')
    assert.ok(done)
    const donePayload = done.payload as { jobId: string; itemIds: number[]; pages: number }
    assert.equal(donePayload.jobId, 'job-abc')
    assert.deepEqual(donePayload.itemIds, [42])
    assert.equal(donePayload.pages, 2)

    // Progress events carry jobId
    for (const e of events.filter((x) => x.ch === 'scan:progress')) {
      assert.equal((e.payload as { jobId: string }).jobId, 'job-abc')
    }

    assert.equal(ingestedPaths.length, 2)

    await rm(root, { recursive: true, force: true })
  })

  it('ingest failure → pages moved to New Receipts; scan:error', async () => {
    const tmpDir = path.join(root, '.scan-tmp', 'job-fail')
    const oldDir = path.join(root, 'Old Receipts')
    const newDir = path.join(root, 'New Receipts')
    await mkdir(oldDir, { recursive: true })
    await mkdir(newDir, { recursive: true })

    const events: Array<{ ch: string; payload: unknown }> = []

    await assert.rejects(
      () =>
        scanAndIngest(
          {
            importPagesAsItem: async () => {
              throw new Error('disk full')
            },
            emit: (ch, payload) => events.push({ ch, payload }),
            now: () => new Date(2026, 7, 1, 10, 0, 0),
            jobOpts: { skipStatusCheck: true },
          },
          deviceFor(server),
          OPTIONS,
          {
            jobId: 'job-fail',
            tmpDir,
            oldReceiptsDir: oldDir,
            newReceiptsDir: newDir,
          },
        ),
      (err: unknown) => {
        assert.ok(err instanceof ScanError)
        assert.equal(err.code, 'protocol')
        assert.match(err.message, /New Receipts|ingest/i)
        return true
      },
    )

    const newNames = await readdir(newDir)
    assert.equal(newNames.length, 2, `expected pages in New, got ${newNames}`)
    const oldNames = await readdir(oldDir)
    assert.equal(oldNames.length, 0)

    const errEv = events.find((e) => e.ch === 'scan:error')
    assert.ok(errEv)
    assert.equal((errEv.payload as { jobId: string }).jobId, 'job-fail')

    await rm(root, { recursive: true, force: true })
  })
})
