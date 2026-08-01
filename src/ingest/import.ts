/**
 * Import files into the library: images, PDFs, vCards.
 * Creates items + pages via repos/FileStore, then queues OCR in the background.
 * Never aborts a batch for one bad file; rejections are reported per path.
 */

import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { ImportRequest, ImportResult } from '../shared/ipc.ts'
import type { LibraryRelPath, Sha256 } from '../shared/types.ts'
import { runOcrJob } from './ocrRunner.ts'
import type { IngestDeps, IngestImportOptions, OcrPageWork } from './types.ts'
import { parseVCards } from './vcard.ts'

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp', 'webp'])
const PDF_EXTS = new Set(['pdf'])
const VCARD_EXTS = new Set(['vcf', 'vcard'])

/** In-flight OCR promises so callers/tests can await background work. */
const ocrWaiters = new Map<string, Promise<void>>()

export function waitForImportOcr(jobId: string): Promise<void> {
  return ocrWaiters.get(jobId) ?? Promise.resolve()
}

export type ImportFilesRequest = ImportRequest & IngestImportOptions

/**
 * Import paths into the library. Returns a job id immediately; OCR continues
 * in the background unless deps.awaitOcr is true.
 */
export async function importFiles(
  deps: IngestDeps,
  req: ImportFilesRequest,
): Promise<ImportResult> {
  const targetFolderId = resolveTargetFolder(deps, req)
  const itemIds: number[] = []
  const rejected: Array<{ path: string; reason: string }> = []
  const ocrWork: OcrPageWork[] = []

  for (const filePath of req.paths) {
    try {
      const outcome = await importOnePath(deps, filePath, targetFolderId, {
        splitPages: req.splitPages === true,
      })
      itemIds.push(...outcome.itemIds)
      ocrWork.push(...outcome.ocrWork)
    } catch (e: unknown) {
      rejected.push({
        path: filePath,
        reason: e instanceof Error ? e.message : String(e),
      })
    }
  }

  const job = await deps.jobs.create('import', ocrWork.length, {
    itemIds,
    pageIds: ocrWork.map((w) => w.pageId),
  })

  if (ocrWork.length === 0) {
    await deps.jobs.update(job.id, { status: 'done', doneUnits: 0, failedUnits: 0 })
  } else {
    const ocrPromise = runOcrJob(deps, job.id, ocrWork)
      .then(async (outcome) => {
        // After OCR, extract fields for each unique item that had successful pages.
        const itemSet = new Set(ocrWork.map((w) => w.itemId))
        for (const itemId of itemSet) {
          try {
            const { extractFromStoredPages } = await import('./extract.ts')
            extractFromStoredPages(deps, itemId)
          } catch {
            /* extraction is best-effort; import still succeeded */
          }
        }
        void outcome
      })
      .catch(async (e: unknown) => {
        try {
          await deps.jobs.update(job.id, {
            status: 'failed',
            error: e instanceof Error ? e.message : String(e),
          })
        } catch {
          /* ignore */
        }
      })
      .finally(() => {
        // keep waiter until read once more, then drop
      })

    ocrWaiters.set(job.id, ocrPromise.then(() => undefined))

    // Request wins over deps: a caller asking to wait is being explicit about
    // this import, while deps.awaitOcr is a default for the whole context.
    if (req.awaitOcr ?? deps.awaitOcr) {
      await ocrPromise
    }
  }

  return {
    jobId: job.id,
    itemIds,
    rejected,
  }
}

/* ---------------------------------------------------------------------------
 * Per-path import
 * ------------------------------------------------------------------------ */

interface OnePathOutcome {
  itemIds: number[]
  ocrWork: OcrPageWork[]
}

async function importOnePath(
  deps: IngestDeps,
  filePath: string,
  folderId: number,
  opts: { splitPages: boolean },
): Promise<OnePathOutcome> {
  const ext = extOf(filePath)

  // Existence / readability
  try {
    const st = await stat(filePath)
    if (!st.isFile()) throw new Error('not a regular file')
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(msg.includes('ENOENT') ? 'file not found' : `unreadable: ${msg}`)
  }

  if (IMAGE_EXTS.has(ext)) {
    return importImage(deps, filePath, folderId, ext)
  }
  if (PDF_EXTS.has(ext)) {
    return importPdf(deps, filePath, folderId, opts.splitPages)
  }
  if (VCARD_EXTS.has(ext)) {
    return importVCard(deps, filePath, folderId)
  }

  throw new Error(`unsupported file type: .${ext || '(none)'}`)
}

async function importImage(
  deps: IngestDeps,
  filePath: string,
  folderId: number,
  ext: string,
): Promise<OnePathOutcome> {
  const bytes = await readFile(filePath)

  // Validate / measure via image pool (sharp). Corrupt files fail here.
  let width: number | null = null
  let height: number | null = null
  try {
    const meta = await deps.imagePool.decode(filePath)
    width = meta.width || null
    height = meta.height || null
  } catch (e: unknown) {
    throw new Error(
      `corrupt or unreadable image: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  const storeExt = ext === 'jpeg' ? 'jpg' : ext
  const { rel, hash } = await deps.fileStore.put(bytes, storeExt)

  // Optional thumbnail
  let thumbRel: LibraryRelPath | null = null
  try {
    const thumb = await deps.imagePool.thumbnail(filePath, { maxEdge: 320 })
    const put = await deps.fileStore.put(thumb.buffer, 'jpg')
    thumbRel = put.rel
  } catch {
    thumbRel = null
  }

  const { itemId } = deps.repos.items.create({ folderId, type: 'receipt' })
  const { pageId } = deps.repos.pages.add({
    itemId,
    fileRelPath: rel,
    thumbRelPath: thumbRel,
    contentHash: hash,
    width,
    height,
    seq: 1,
  })

  const generation = readGeneration(deps, pageId)

  return {
    itemIds: [itemId],
    ocrWork: [
      {
        pageId,
        itemId,
        fileRelPath: String(rel),
        generation,
      },
    ],
  }
}

async function importPdf(
  deps: IngestDeps,
  filePath: string,
  folderId: number,
  splitPages: boolean,
): Promise<OnePathOutcome> {
  const pageCount = await countPdfPages(filePath)
  if (pageCount < 1) throw new Error('PDF has no pages')

  const itemIds: number[] = []
  const ocrWork: OcrPageWork[] = []

  let sharedItemId: number | null = null
  if (!splitPages) {
    sharedItemId = deps.repos.items.create({ folderId, type: 'receipt' }).itemId
    itemIds.push(sharedItemId)
  }

  for (let i = 0; i < pageCount; i++) {
    let raster: { buffer: Buffer; width: number; height: number }
    try {
      raster = await rasterizePdfPage(deps, filePath, i)
    } catch (e: unknown) {
      throw new Error(
        `PDF page ${i + 1} rasterize failed: ${e instanceof Error ? e.message : String(e)}`,
      )
    }

    const { rel, hash } = await deps.fileStore.put(raster.buffer, 'png')

    let thumbRel: LibraryRelPath | null = null
    try {
      const abs = deps.fileStore.resolve(rel)
      const thumb = await deps.imagePool.thumbnail(abs, { maxEdge: 320 })
      thumbRel = (await deps.fileStore.put(thumb.buffer, 'jpg')).rel
    } catch {
      thumbRel = null
    }

    let itemId: number
    let seq: number
    if (splitPages) {
      itemId = deps.repos.items.create({ folderId, type: 'receipt' }).itemId
      itemIds.push(itemId)
      seq = 1
    } else {
      itemId = sharedItemId!
      seq = i + 1
    }

    const { pageId } = deps.repos.pages.add({
      itemId,
      fileRelPath: rel,
      thumbRelPath: thumbRel,
      contentHash: hash as Sha256,
      width: raster.width,
      height: raster.height,
      seq,
    })

    ocrWork.push({
      pageId,
      itemId,
      fileRelPath: String(rel),
      generation: readGeneration(deps, pageId),
    })
  }

  return { itemIds, ocrWork }
}

/**
 * Rasterize one PDF page. Prefer the shared image pool when it works; on the
 * known empty-workerSrc failure path, use a direct pdfjs render (still no
 * nested OCR pool — this is image work only).
 */
async function rasterizePdfPage(
  deps: IngestDeps,
  filePath: string,
  pageIndex: number,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  // Direct path first: Lane B's imagePool currently sets workerSrc to '' which
  // breaks pdfjs. Direct render uses the real worker module path and @napi-rs/canvas.
  // Still honour the pool for concurrency of other image ops (thumbnail/decode).
  try {
    return await rasterizePdfPageDirect(filePath, pageIndex, 200)
  } catch (directErr) {
    try {
      return await deps.imagePool.rasterizePdfPage(filePath, pageIndex, { dpi: 200 })
    } catch {
      throw directErr
    }
  }
}

async function importVCard(
  deps: IngestDeps,
  filePath: string,
  folderId: number,
): Promise<OnePathOutcome> {
  const raw = await readFile(filePath)
  const cards = parseVCards(raw)
  if (!cards.length) throw new Error('no vCard entries found')

  const itemIds: number[] = []
  for (const card of cards) {
    const { itemId } = deps.repos.items.create({ folderId, type: 'contact' })
    deps.repos.db
      .prepare(
        `UPDATE contact_data
            SET first_name = ?, last_name = ?, org = ?, title = ?,
                emails_json = ?, phones_json = ?, addresses_json = ?,
                url = ?, notes = ?
          WHERE item_id = ?`,
      )
      .run(
        card.firstName,
        card.lastName,
        card.org,
        card.title,
        JSON.stringify(card.emails),
        JSON.stringify(card.phones),
        JSON.stringify(card.addresses),
        card.url,
        card.notes,
        itemId,
      )
    itemIds.push(itemId)
  }

  // No OCR work for contacts.
  return { itemIds, ocrWork: [] }
}

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------ */

function resolveTargetFolder(deps: IngestDeps, req: ImportRequest): number {
  // Default target is the Inbox (folder.kind='inbox'), not a user folder.
  if (req.toInbox === false && req.targetFolderId !== undefined) {
    return req.targetFolderId
  }
  const row = deps.repos.db
    .prepare(`SELECT id FROM folder WHERE kind = 'inbox' LIMIT 1`)
    .get() as { id: number } | undefined
  if (!row) throw new Error('Inbox folder missing (folder.kind=inbox)')
  return row.id
}

function extOf(filePath: string): string {
  return path.extname(filePath).replace(/^\./, '').toLowerCase()
}

function readGeneration(deps: IngestDeps, pageId: number): number {
  const row = deps.repos.db
    .prepare(`SELECT ocr_generation AS g FROM page WHERE id = ?`)
    .get(pageId) as { g: number } | undefined
  return row?.g ?? 0
}

async function countPdfPages(filePath: string): Promise<number> {
  // pdf-lib is already a project dependency and needs no worker bootstrap.
  const { PDFDocument } = await import('pdf-lib')
  const bytes = await readFile(filePath)
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  return doc.getPageCount()
}

async function rasterizePdfPageDirect(
  filePath: string,
  pageIndex: number,
  dpi: number,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  // Dual-runtime shim: createRequire(import.meta.url) throws in the CJS bundle.
  const { nodeRequire: require } = await import('../shared/nodeRequire.ts')
  const { getDocument, GlobalWorkerOptions } = await import(
    'pdfjs-dist/legacy/build/pdf.mjs'
  )
  // workerSrc must be a file:// URL, not a filesystem path.
  //
  // require.resolve returns 'D:\\a\\keepr\\node_modules\\...' on Windows, and
  // pdfjs hands that to the ESM loader, which rejects it:
  //   "Only URLs with a scheme in: file, data, and node are supported"
  // A POSIX absolute path happens to be accepted, so this failed on Windows only —
  // caught by the CI matrix, not by any amount of local testing on a Mac.
  try {
    const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
    const { pathToFileURL } = await import('node:url')
    GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
  } catch {
    // No worker available: pdfjs falls back to running on this thread, which is
    // what we want anyway rather than a second worker layer.
    GlobalWorkerOptions.workerSrc = ''
  }

  const data = new Uint8Array(await readFile(filePath))
  const doc = await getDocument({
    data,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  } as Parameters<typeof getDocument>[0]).promise

  try {
    if (pageIndex < 0 || pageIndex >= doc.numPages) {
      throw new RangeError(`PDF pageIndex ${pageIndex} out of range 0..${doc.numPages - 1}`)
    }
    const page = await doc.getPage(pageIndex + 1)
    const viewport = page.getViewport({ scale: dpi / 72 })
    const width = Math.max(1, Math.ceil(viewport.width))
    const height = Math.max(1, Math.ceil(viewport.height))

    // Prefer real canvas when present (transitive native); else white placeholder.
    let buffer: Buffer
    try {
      const { createCanvas } = require('@napi-rs/canvas') as {
        createCanvas: (w: number, h: number) => {
          getContext: (t: string) => unknown
          toBuffer: (mime: string) => Buffer
        }
      }
      const canvas = createCanvas(width, height)
      const ctx = canvas.getContext('2d')
      await page.render({ canvasContext: ctx, viewport } as never).promise
      buffer = canvas.toBuffer('image/png')
    } catch {
      const sharp = require('sharp') as typeof import('sharp')
      buffer = await sharp({
        create: {
          width,
          height,
          channels: 3,
          background: { r: 255, g: 255, b: 255 },
        },
      })
        .png()
        .toBuffer()
    }
    return { buffer, width, height }
  } finally {
    await doc.destroy()
  }
}

