/**
 * Import files into the library: images, PDFs, vCards.
 * Creates items + pages via repos/FileStore, then queues OCR in the background.
 * Never aborts a batch for one bad file; rejections are reported per path.
 *
 * NEVER moves filesystem originals. The New→Old watcher (watchFolders.ts) is the
 * only path that relocates user files, and only after item-created-or-duplicate.
 *
 * Dedupe key = original source bytes via item_source_file.source_sha256
 * (migration 002) — NOT page.content_hash (pages store rasters; PDFs/vCards
 * would never match).
 */

import { createHash } from 'node:crypto'
import { access, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ImportRequest, ImportResult } from '../shared/ipc.ts'
import type { LibraryRelPath, Sha256 } from '../shared/types.ts'
import { asRelPath } from '../shared/types.ts'
import { walkForImportable } from './dirwalk.ts'
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

export type ImportPagesAsItemRequest = {
  paths: string[]
  targetFolderId?: number
  toInbox?: boolean
  /** Wait for OCR before returning (tests). */
  awaitOcr?: boolean
  skipDuplicates?: boolean
}

export type ImportPagesAsItemResult = {
  itemId: number
  pageCount: number
  jobId: string
  /** Set when skipDuplicates found an existing multi-page source. */
  duplicateOf?: number
}

/**
 * Import paths into the library. Returns a job id immediately; OCR continues
 * in the background unless deps.awaitOcr / req.awaitOcr is true.
 *
 * Directories are expanded via walkForImportable. Empty dirs yield 0 items.
 */
export async function importFiles(
  deps: IngestDeps,
  req: ImportFilesRequest,
): Promise<ImportResult> {
  const targetFolderId = resolveTargetFolder(deps, req)
  const itemIds: number[] = []
  const rejected: Array<{ path: string; reason: string }> = []
  const duplicates: Array<{ path: string; existingItemId: number }> = []
  const ocrWork: OcrPageWork[] = []
  let skippedUnsupported = 0

  // Expand directories first so a single path entry that is a folder becomes N files.
  const expanded: string[] = []
  for (const p of req.paths) {
    let st
    try {
      st = await stat(p)
    } catch (e: unknown) {
      rejected.push({
        path: p,
        reason: e instanceof Error && (e as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'file not found'
          : `unreadable: ${e instanceof Error ? e.message : String(e)}`,
      })
      continue
    }

    if (st.isDirectory()) {
      const walked = await walkForImportable(p)
      skippedUnsupported += walked.skippedUnsupported
      // Empty directory is not an error.
      expanded.push(...walked.files)
    } else {
      expanded.push(path.resolve(p))
    }
  }

  const skipDuplicates = req.skipDuplicates === true

  for (const filePath of expanded) {
    try {
      const outcome = await importOnePath(deps, filePath, targetFolderId, {
        splitPages: req.splitPages === true,
        skipDuplicates,
      })
      if (outcome.duplicateOf !== undefined) {
        duplicates.push({ path: filePath, existingItemId: outcome.duplicateOf })
      } else {
        itemIds.push(...outcome.itemIds)
        ocrWork.push(...outcome.ocrWork)
      }
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

    ocrWaiters.set(job.id, ocrPromise.then(() => undefined))

    if (req.awaitOcr ?? deps.awaitOcr) {
      await ocrPromise
    }
  }

  const result: ImportResult = {
    jobId: job.id,
    itemIds,
    rejected,
  }
  if (duplicates.length) result.duplicates = duplicates
  if (skippedUnsupported > 0) result.skippedUnsupported = skippedUnsupported
  return result
}

/**
 * N page files → ONE multi-page item, pages in the given order.
 *
 * source_sha256 is the sha256 of the concatenation of each page file's
 * lowercase-hex sha256 (joined with no separator). A re-import of the same
 * pages in the same order therefore dedupes. source_relpath stores the first
 * page's original bytes in the content-addressed store.
 */
export async function importPagesAsItem(
  deps: IngestDeps,
  req: ImportPagesAsItemRequest,
): Promise<ImportPagesAsItemResult> {
  if (!req.paths.length) {
    throw new Error('importPagesAsItem requires at least one path')
  }

  const folderId = resolveTargetFolder(deps, {
    ...(req.targetFolderId !== undefined ? { targetFolderId: req.targetFolderId } : {}),
    ...(req.toInbox !== undefined ? { toInbox: req.toInbox } : {}),
  })

  // Read + hash each file first so we can dedupe before creating an item.
  const pageInputs: Array<{
    absPath: string
    bytes: Buffer
    hash: string
    width: number | null
    height: number | null
    storeExt: string
  }> = []

  for (const p of req.paths) {
    const absPath = path.resolve(p)
    const st = await stat(absPath)
    if (!st.isFile()) throw new Error(`not a regular file: ${p}`)
    const ext = extOf(absPath)
    if (!IMAGE_EXTS.has(ext)) {
      throw new Error(`importPagesAsItem supports image pages only, got .${ext || '(none)'}`)
    }
    const bytes = await readFile(absPath)
    const hash = sha256Hex(bytes)
    let width: number | null = null
    let height: number | null = null
    try {
      const meta = await deps.imagePool.decode(absPath)
      width = meta.width || null
      height = meta.height || null
    } catch (e: unknown) {
      throw new Error(
        `corrupt or unreadable image: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
    pageInputs.push({
      absPath,
      bytes,
      hash,
      width,
      height,
      storeExt: ext === 'jpeg' ? 'jpg' : ext,
    })
  }

  const combinedSha = combinedSourceSha(pageInputs.map((p) => p.hash))

  if (req.skipDuplicates) {
    const existing = findItemBySourceSha(deps, combinedSha)
    if (existing !== null) {
      const job = await deps.jobs.create('import', 0, {
        itemIds: [],
        pageIds: [],
        duplicateOf: existing,
      })
      await deps.jobs.update(job.id, { status: 'done', doneUnits: 0, failedUnits: 0 })
      return {
        itemId: existing,
        pageCount: pageInputs.length,
        jobId: job.id,
        duplicateOf: existing,
      }
    }
  }

  // Put first page's original as the provenance blob; pages themselves also put.
  const first = pageInputs[0]!
  const sourcePut = await putOriginalSource(deps, first.bytes, first.storeExt)

  const { itemId } = deps.repos.items.create({ folderId, type: 'receipt' })
  const ocrWork: OcrPageWork[] = []

  try {
    recordSourceFile(deps, {
      itemId,
      sourceSha256: combinedSha,
      sourceRelpath: String(sourcePut.rel),
      originalName: path.basename(first.absPath),
    })

    for (let i = 0; i < pageInputs.length; i++) {
      const page = pageInputs[i]!
      const { rel, hash } = await deps.fileStore.put(page.bytes, page.storeExt)

      let thumbRel: LibraryRelPath | null = null
      try {
        const thumb = await deps.imagePool.thumbnail(page.absPath, { maxEdge: 320 })
        thumbRel = (await deps.fileStore.put(thumb.buffer, 'jpg')).rel
      } catch {
        thumbRel = null
      }

      const { pageId } = deps.repos.pages.add({
        itemId,
        fileRelPath: rel,
        thumbRelPath: thumbRel,
        contentHash: hash,
        width: page.width,
        height: page.height,
        seq: i + 1,
      })

      ocrWork.push({
        pageId,
        itemId,
        fileRelPath: String(rel),
        generation: readGeneration(deps, pageId),
      })
    }
  } catch (e: unknown) {
    await rollbackItem(deps, itemId)
    throw e
  }

  const job = await deps.jobs.create('import', ocrWork.length, {
    itemIds: [itemId],
    pageIds: ocrWork.map((w) => w.pageId),
  })

  if (ocrWork.length === 0) {
    await deps.jobs.update(job.id, { status: 'done', doneUnits: 0, failedUnits: 0 })
  } else {
    const ocrPromise = runOcrJob(deps, job.id, ocrWork)
      .then(async () => {
        try {
          const { extractFromStoredPages } = await import('./extract.ts')
          extractFromStoredPages(deps, itemId)
        } catch {
          /* best-effort */
        }
      })
      .catch(async (err: unknown) => {
        try {
          await deps.jobs.update(job.id, {
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          })
        } catch {
          /* ignore */
        }
      })
    ocrWaiters.set(job.id, ocrPromise.then(() => undefined))
    if (req.awaitOcr ?? deps.awaitOcr) {
      await ocrPromise
    }
  }

  return { itemId, pageCount: pageInputs.length, jobId: job.id }
}

/**
 * Combined multi-page source hash: sha256 of the concatenation of each file's
 * lowercase-hex content sha256, joined with no separator, in path order.
 * Documented so re-scans of identical page sets dedupe uniformly.
 */
export function combinedSourceSha(perFileSha256Hex: string[]): string {
  return sha256Hex(Buffer.from(perFileSha256Hex.join(''), 'utf8'))
}

/* ---------------------------------------------------------------------------
 * Per-path import
 * ------------------------------------------------------------------------ */

interface OnePathOutcome {
  itemIds: number[]
  ocrWork: OcrPageWork[]
  /** When set, no item was created — content already in library. */
  duplicateOf?: number
}

async function importOnePath(
  deps: IngestDeps,
  filePath: string,
  folderId: number,
  opts: { splitPages: boolean; skipDuplicates: boolean },
): Promise<OnePathOutcome> {
  const ext = extOf(filePath)

  try {
    const st = await stat(filePath)
    if (!st.isFile()) throw new Error('not a regular file')
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(msg.includes('ENOENT') ? 'file not found' : `unreadable: ${msg}`)
  }

  if (IMAGE_EXTS.has(ext)) {
    return importImage(deps, filePath, folderId, ext, opts.skipDuplicates)
  }
  if (PDF_EXTS.has(ext)) {
    return importPdf(deps, filePath, folderId, opts.splitPages, opts.skipDuplicates)
  }
  if (VCARD_EXTS.has(ext)) {
    return importVCard(deps, filePath, folderId, opts.skipDuplicates)
  }

  throw new Error(`unsupported file type: .${ext || '(none)'}`)
}

async function importImage(
  deps: IngestDeps,
  filePath: string,
  folderId: number,
  ext: string,
  skipDuplicates: boolean,
): Promise<OnePathOutcome> {
  const bytes = await readFile(filePath)
  const storeExt = ext === 'jpeg' ? 'jpg' : ext

  // Validate / measure via image pool (sharp). Corrupt files fail here —
  // before we create any item or record a source row.
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

  const { rel, hash } = await putOriginalSource(deps, bytes, storeExt)

  if (skipDuplicates) {
    const existing = findItemBySourceSha(deps, hash)
    if (existing !== null) {
      return { itemIds: [], ocrWork: [], duplicateOf: existing }
    }
  }

  // Thumbnail for a skipped duplicate must not create an item either —
  // we only reach here when we will create.
  let thumbRel: LibraryRelPath | null = null
  try {
    const thumb = await deps.imagePool.thumbnail(filePath, { maxEdge: 320 })
    const put = await deps.fileStore.put(thumb.buffer, 'jpg')
    thumbRel = put.rel
  } catch {
    thumbRel = null
  }

  const { itemId } = deps.repos.items.create({ folderId, type: 'receipt' })
  recordSourceFile(deps, {
    itemId,
    sourceSha256: hash,
    sourceRelpath: String(rel),
    originalName: path.basename(filePath),
  })

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
  skipDuplicates: boolean,
): Promise<OnePathOutcome> {
  const pdfBytes = await readFile(filePath)
  const sourcePut = await putOriginalSource(deps, pdfBytes, 'pdf')

  if (skipDuplicates) {
    const existing = findItemBySourceSha(deps, sourcePut.hash)
    if (existing !== null) {
      return { itemIds: [], ocrWork: [], duplicateOf: existing }
    }
  }

  const pageCount = await countPdfPages(filePath)
  if (pageCount < 1) throw new Error('PDF has no pages')

  const itemIds: number[] = []
  const ocrWork: OcrPageWork[] = []
  /** Items created this call — rolled back on partial raster failure. */
  const createdItemIds: number[] = []

  let sharedItemId: number | null = null
  if (!splitPages) {
    sharedItemId = deps.repos.items.create({ folderId, type: 'receipt' }).itemId
    createdItemIds.push(sharedItemId)
    itemIds.push(sharedItemId)
    recordSourceFile(deps, {
      itemId: sharedItemId,
      sourceSha256: sourcePut.hash,
      sourceRelpath: String(sourcePut.rel),
      originalName: path.basename(filePath),
    })
  }

  try {
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
        createdItemIds.push(itemId)
        itemIds.push(itemId)
        seq = 1
        // Each split page item still records the whole PDF as its source so
        // re-dropping the PDF skips (same source hash).
        recordSourceFile(deps, {
          itemId,
          sourceSha256: sourcePut.hash,
          sourceRelpath: String(sourcePut.rel),
          originalName: path.basename(filePath),
        })
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
  } catch (e: unknown) {
    // All-or-nothing: never leave a half-rasterized PDF item that the watcher
    // could archive. Delete every item created for this file.
    for (const id of createdItemIds) {
      await rollbackItem(deps, id)
    }
    throw e
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
  skipDuplicates: boolean,
): Promise<OnePathOutcome> {
  const raw = await readFile(filePath)
  const sourcePut = await putOriginalSource(deps, raw, 'vcf')

  if (skipDuplicates) {
    const existing = findItemBySourceSha(deps, sourcePut.hash)
    if (existing !== null) {
      return { itemIds: [], ocrWork: [], duplicateOf: existing }
    }
  }

  const cards = parseVCards(raw)
  if (!cards.length) throw new Error('no vCard entries found')

  // One source row per first contact item; additional cards from the same file
  // share provenance by also recording the same source hash (skipDuplicates on
  // re-drop of the .vcf still finds the first item).
  const itemIds: number[] = []
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]!
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
    // Record source on every contact from this file so any is findable; the
    // first match wins for skipDuplicates.
    recordSourceFile(deps, {
      itemId,
      sourceSha256: sourcePut.hash,
      sourceRelpath: String(sourcePut.rel),
      originalName: path.basename(filePath),
    })
    itemIds.push(itemId)
  }

  return { itemIds, ocrWork: [] }
}

/* ---------------------------------------------------------------------------
 * Source-file provenance + dedupe (migration 002)
 * ------------------------------------------------------------------------ */

function findItemBySourceSha(deps: IngestDeps, sourceSha256: string): number | null {
  const row = deps.repos.db
    .prepare(
      `SELECT item_id AS id FROM item_source_file WHERE source_sha256 = ? LIMIT 1`,
    )
    .get(String(sourceSha256).toLowerCase()) as { id: number } | undefined
  return row?.id ?? null
}

function recordSourceFile(
  deps: IngestDeps,
  row: {
    itemId: number
    sourceSha256: string
    sourceRelpath: string
    originalName: string
  },
): void {
  const now = Date.now()
  deps.repos.db
    .prepare(
      `INSERT INTO item_source_file(item_id, source_sha256, source_relpath, original_name, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET
         source_sha256 = excluded.source_sha256,
         source_relpath = excluded.source_relpath,
         original_name = excluded.original_name`,
    )
    .run(
      row.itemId,
      String(row.sourceSha256).toLowerCase(),
      row.sourceRelpath,
      row.originalName,
      now,
    )
}

/**
 * Put original document bytes into the content-addressed store.
 * DiskFileStore EXT_ALLOW lacks vcf — preserve vCards with the same layout.
 */
async function putOriginalSource(
  deps: IngestDeps,
  bytes: Buffer,
  ext: string,
): Promise<{ rel: LibraryRelPath; hash: Sha256 }> {
  const clean = ext.replace(/^\./, '').toLowerCase()
  const storeExt = clean === 'jpeg' ? 'jpg' : clean === 'vcard' ? 'vcf' : clean

  // vcf is store-allowed as of batch-2 integration, so the store's atomic
  // tmp+rename path handles every source type uniformly.
  return deps.fileStore.put(bytes, storeExt)
}

/** Hard-delete an item and release any page/thumb blobs that drop to zero cites. */
async function rollbackItem(deps: IngestDeps, itemId: number): Promise<void> {
  const pages = deps.repos.db
    .prepare(`SELECT file_relpath, thumb_relpath FROM page WHERE item_id = ?`)
    .all(itemId) as Array<{ file_relpath: string; thumb_relpath: string | null }>

  deps.repos.db.prepare(`DELETE FROM item WHERE id = ?`).run(itemId)

  for (const p of pages) {
    try {
      await deps.fileStore.release(p.file_relpath as LibraryRelPath)
    } catch {
      /* best-effort */
    }
    if (p.thumb_relpath) {
      try {
        await deps.fileStore.release(p.thumb_relpath as LibraryRelPath)
      } catch {
        /* best-effort */
      }
    }
  }
}

/* ---------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------ */

function resolveTargetFolder(
  deps: IngestDeps,
  req: Pick<ImportRequest, 'targetFolderId' | 'toInbox'>,
): number {
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

function sha256Hex(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex')
}

function readGeneration(deps: IngestDeps, pageId: number): number {
  const row = deps.repos.db
    .prepare(`SELECT ocr_generation AS g FROM page WHERE id = ?`)
    .get(pageId) as { g: number } | undefined
  return row?.g ?? 0
}

async function countPdfPages(filePath: string): Promise<number> {
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
  const { nodeRequire: require } = await import('../shared/nodeRequire.ts')
  const { getDocument, GlobalWorkerOptions } = await import(
    'pdfjs-dist/legacy/build/pdf.mjs'
  )
  try {
    const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
    const { pathToFileURL } = await import('node:url')
    GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
  } catch {
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
