/**
 * Lane C OCR / generation / cancel tests — acceptance 6–8, 10.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { importFiles } from '../import.ts'
import { runOcrJob } from '../ocrRunner.ts'
import type { OcrPageWork } from '../types.ts'
import {
  openIngestFixture,
  SelectiveFailOcr,
  writeTestJpeg,
  type IngestFixture,
} from './harness.ts'

async function withFx(
  fn: (fx: IngestFixture) => Promise<void>,
  ocrOpts?: Parameters<typeof openIngestFixture>[0],
): Promise<void> {
  const fx = await openIngestFixture(ocrOpts)
  try {
    await fn(fx)
  } finally {
    await fx.close()
  }
}

test('6. OCR writes text and the token becomes findable in page_fts', async () => {
  await withFx(
    async (fx) => {
      const img = await writeTestJpeg(fx.fixturesDir, 'ocr.jpg')
      const result = await importFiles(fx.deps, { paths: [img] })
      assert.equal(result.itemIds.length, 1)

      const page = fx.raw
        .prepare(`SELECT id, ocr_status, ocr_text FROM page WHERE item_id = ?`)
        .get(result.itemIds[0]!) as {
        id: number
        ocr_status: string
        ocr_text: string | null
      }
      assert.equal(page.ocr_status, 'done')
      assert.ok(page.ocr_text && page.ocr_text.includes('zzocrfindme'))

      const hits = fx.raw
        .prepare(
          `SELECT COUNT(*) AS c FROM page_fts WHERE page_fts MATCH ?`,
        )
        .get('zzocrfindme') as { c: number }
      assert.equal(hits.c, 1)
    },
    { text: 'HOME DEPOT zzocrfindme TOTAL 42.00' },
  )
})

test('7. a stale-generation OCR result is discarded — row unchanged', async () => {
  await withFx(async (fx) => {
    const img = await writeTestJpeg(fx.fixturesDir, 'stale.jpg')
    // Import without awaiting OCR so we can race generation.
    fx.deps.awaitOcr = false
    const result = await importFiles(fx.deps, { paths: [img] })
    const itemId = result.itemIds[0]!
    const page = fx.raw
      .prepare(`SELECT id, ocr_generation, ocr_text, ocr_status FROM page WHERE item_id = ?`)
      .get(itemId) as {
      id: number
      ocr_generation: number
      ocr_text: string | null
      ocr_status: string
    }

    // Simulate user edit / crop: bump generation and clear OCR.
    fx.repos.pages.invalidateOcr(page.id)
    const afterInv = fx.raw
      .prepare(`SELECT ocr_generation, ocr_text, ocr_status FROM page WHERE id = ?`)
      .get(page.id) as {
      ocr_generation: number
      ocr_text: string | null
      ocr_status: string
    }
    assert.equal(afterInv.ocr_generation, page.ocr_generation + 1)
    assert.equal(afterInv.ocr_text, null)
    assert.equal(afterInv.ocr_status, 'pending')

    // Stale result at old generation must be discarded.
    const applied = fx.repos.pages.setOcrResult(page.id, {
      text: 'STALE TOKEN should never land',
      words: [],
      confidence: 0.99,
      engine: 'stale',
      generation: page.ocr_generation, // old
    })
    assert.equal(applied.applied, false)

    const row = fx.raw
      .prepare(`SELECT ocr_text, ocr_status, ocr_generation, ocr_engine FROM page WHERE id = ?`)
      .get(page.id) as {
      ocr_text: string | null
      ocr_status: string
      ocr_generation: number
      ocr_engine: string | null
    }
    assert.equal(row.ocr_text, null, 'stale text must not clobber')
    assert.equal(row.ocr_engine, null)
    assert.equal(row.ocr_generation, afterInv.ocr_generation)
    assert.notEqual(row.ocr_text, 'STALE TOKEN should never land')
  })
})

test('8. a page whose OCR fails leaves ocr_status=failed and job ends partial', async () => {
  const fx = await openIngestFixture({ text: 'ok token' })
  try {
    // Build two pages without running OCR; then OCR with a selective failure.
    const a = await writeTestJpeg(fx.fixturesDir, 'ok.jpg', { r: 1, g: 1, b: 1 })
    const b = await writeTestJpeg(fx.fixturesDir, 'bad.jpg', { r: 2, g: 2, b: 2 })
    const { readFile } = await import('node:fs/promises')

    const putA = await fx.fileStore.put(await readFile(a), 'jpg')
    const putB = await fx.fileStore.put(await readFile(b), 'jpg')
    const itemA = fx.repos.items.create({ folderId: fx.folderInbox, type: 'receipt' }).itemId
    const itemB = fx.repos.items.create({ folderId: fx.folderInbox, type: 'receipt' }).itemId
    const pageA = fx.repos.pages.add({
      itemId: itemA,
      fileRelPath: putA.rel,
      contentHash: putA.hash,
      seq: 1,
    }).pageId
    const pageB = fx.repos.pages.add({
      itemId: itemB,
      fileRelPath: putB.rel,
      contentHash: putB.hash,
      seq: 1,
    }).pageId

    const failAbs = fx.fileStore.resolve(putB.rel)
    fx.deps.ocr = new SelectiveFailOcr([failAbs], { text: 'ok token' })

    const work: OcrPageWork[] = [
      { pageId: pageA, itemId: itemA, fileRelPath: String(putA.rel), generation: 0 },
      { pageId: pageB, itemId: itemB, fileRelPath: String(putB.rel), generation: 0 },
    ]
    const job = await fx.jobs.create('ocr', work.length)
    const outcome = await runOcrJob(fx.deps, job.id, work)

    assert.equal(outcome.status, 'partial')
    assert.equal(outcome.done, 1)
    assert.equal(outcome.failed, 1)

    const stA = fx.raw.prepare(`SELECT ocr_status FROM page WHERE id = ?`).get(pageA) as {
      ocr_status: string
    }
    const stB = fx.raw.prepare(`SELECT ocr_status FROM page WHERE id = ?`).get(pageB) as {
      ocr_status: string
    }
    assert.equal(stA.ocr_status, 'done')
    assert.equal(stB.ocr_status, 'failed')

    const jobRow = await fx.jobs.get(job.id)
    assert.equal(jobRow?.status, 'partial')
  } finally {
    await fx.close()
  }
})

test('10. cancelling mid-import stops further pages and job ends cancelled', async () => {
  const gate = {
    release: (() => {}) as () => void,
  }
  let gatePromise = new Promise<void>((r) => {
    gate.release = r
  })
  let started = 0

  const fx = await openIngestFixture({
    delayMs: 30,
    gate: async () => {
      started++
      // First page proceeds; later pages wait on the gate so cancel can win.
      if (started === 1) return
      await gatePromise
    },
  })

  try {
    const paths: string[] = []
    for (let i = 0; i < 4; i++) {
      paths.push(
        await writeTestJpeg(fx.fixturesDir, `c${i}.jpg`, {
          r: i * 20,
          g: 10,
          b: 10,
        }),
      )
    }

    fx.deps.awaitOcr = false
    fx.deps.ocrConcurrency = 1 // serial so cancel clearly stops "further" pages

    const result = await importFiles(fx.deps, { paths })
    assert.equal(result.itemIds.length, 4)

    // Let OCR begin, then cancel.
    await new Promise((r) => setTimeout(r, 50))
    await fx.jobs.cancel(result.jobId)

    // Release any waiters so the runner can observe cancel and finish.
    gate.release()
    gatePromise = Promise.resolve()

    // Wait for background OCR to settle.
    const { waitForImportOcr } = await import('../import.ts')
    await waitForImportOcr(result.jobId)

    const job = await fx.jobs.get(result.jobId)
    assert.equal(job?.status, 'cancelled')

    const statuses = fx.raw
      .prepare(`SELECT ocr_status FROM page`)
      .all() as Array<{ ocr_status: string }>
    const doneCount = statuses.filter((s) => s.ocr_status === 'done').length
    // At least one page should not have completed as done because we cancelled.
    assert.ok(
      doneCount < 4,
      `expected not all pages done after cancel; statuses=${statuses.map((s) => s.ocr_status).join(',')}`,
    )
  } finally {
    gate.release()
    await fx.close()
  }
})
