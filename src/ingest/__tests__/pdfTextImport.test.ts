/**
 * Wave 2 — the text-layer path wired into import.
 *
 * The unit tests prove pdfText reads a layer correctly; these prove the import
 * pipeline actually USES it, which is a different claim. The regression that
 * motivated the second test is instructive: a fully text-layer PDF queues zero
 * OCR work, and field extraction used to hang off the OCR job completing — so
 * the item imported with a perfect text layer and every field blank.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createContext } from '../../main/context.ts'
import { importFiles } from '../index.ts'
import { createImagePool } from '../../workers/imagePool.ts'
import type { OcrProvider } from '../../shared/types.ts'
import { sandwichPdf, misalignedPdf } from '../../ocr/__tests__/fixtures/pdfFixtures.ts'

/** Records whether OCR was asked to do anything at all. */
function countingOcr(): OcrProvider & { calls: number } {
  const p = {
    id: 'counting',
    calls: 0,
    async ocrPage(input: { generation: number }) {
      p.calls += 1
      return { text: 'OCR RAN', words: [], confidence: 0.4, engine: 'counting', generation: input.generation, msElapsed: 1 }
    },
    async dispose() {},
  }
  return p as OcrProvider & { calls: number }
}

async function libraryWith(name: string, bytes: Buffer) {
  const root = mkdtempSync(path.join(tmpdir(), 'keepr-pdftext-import-'))
  const ctx = createContext({ libraryRoot: path.join(root, 'lib') })
  const ocr = countingOcr()
  const deps = {
    repos: ctx.repos, fileStore: ctx.fileStore, jobs: ctx.jobs,
    ocr, imagePool: createImagePool(), awaitOcr: true,
  }
  const file = path.join(root, name)
  writeFileSync(file, bytes)
  await importFiles(deps as never, { paths: [file], toInbox: true, awaitOcr: true })
  return { ctx, ocr }
}

test('a searchable PDF imports from its text layer without running OCR', async () => {
  const { ctx, ocr } = await libraryWith('searchable.pdf', await sandwichPdf())
  try {
    const page = ctx.db
      .prepare(`SELECT ocr_engine, ocr_status FROM page ORDER BY id DESC LIMIT 1`)
      .get() as { ocr_engine: string; ocr_status: string }
    assert.equal(page.ocr_engine, 'pdf-text')
    assert.equal(page.ocr_status, 'done')
    assert.equal(ocr.calls, 0, 'tesseract must not be invoked for a usable text layer')
  } finally {
    ctx.close()
  }
})

test('fields still extract when no OCR job runs', async () => {
  const { ctx } = await libraryWith('searchable2.pdf', await sandwichPdf())
  try {
    const row = ctx.repos.items.list({ smartFilter: 'all' }).rows[0]
    assert.ok(row)
    assert.equal(row.vendorName, 'Home Depot')
    assert.equal(row.totalMinor, 12501)
    assert.equal(row.txnDate, '2026-07-12')
  } finally {
    ctx.close()
  }
})

test('a misaligned layer is refused and the page falls back to OCR', async () => {
  const { ctx, ocr } = await libraryWith('misaligned.pdf', misalignedPdf())
  try {
    const page = ctx.db
      .prepare(`SELECT ocr_engine FROM page ORDER BY id DESC LIMIT 1`)
      .get() as { ocr_engine: string }
    assert.equal(page.ocr_engine, 'counting', 'must not accept a degenerate layer')
    assert.equal(ocr.calls, 1, 'OCR should have been asked to do the work instead')
  } finally {
    ctx.close()
  }
})
