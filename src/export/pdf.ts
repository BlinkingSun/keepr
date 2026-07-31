/**
 * Searchable PDF export via pdf-lib.
 * Page image + invisible text layer from ocr_words_json (stored-master bboxes).
 */
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { ExportRequest } from '../shared/ipc.ts'
import type { LibraryRelPath, Rotation, Word } from '../shared/types.ts'
import { asRelPath } from '../shared/types.ts'
import { displaySize, masterBBoxToPdfText } from './geometry.ts'
import { beginExportProgress } from './progress.ts'
import {
  loadCabinet,
  queryExportReceipts,
  queryItemPages,
  resolveExportItemIds,
  type ItemPageRow,
} from './query.ts'
import type { CabinetProfile, ExportContext, KeeprDatabase } from './types.ts'

const require = createRequire(import.meta.url)
const {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
} = require('pdf-lib') as typeof import('pdf-lib')

const sharp = require('sharp') as typeof import('sharp')

function parseWords(json: string | null): Word[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (w): w is Word =>
        !!w &&
        typeof w === 'object' &&
        typeof (w as Word).text === 'string' &&
        !!(w as Word).bbox &&
        typeof (w as Word).bbox.x === 'number',
    )
  } catch {
    return []
  }
}

function asRotation(n: number): Rotation {
  if (n === 90 || n === 180 || n === 270 || n === 0) return n
  return 0
}

async function loadImageBytes(
  ctx: ExportContext | undefined,
  rel: string,
): Promise<Buffer | null> {
  try {
    if (ctx?.fileStore) {
      return await ctx.fileStore.read(asRelPath(rel) as LibraryRelPath)
    }
    if (ctx?.libraryRoot) {
      return await readFile(path.resolve(ctx.libraryRoot, rel))
    }
    return null
  } catch {
    return null
  }
}

/**
 * Rotate image pixels to match page.rotation so the embedded image matches
 * the display orientation used for text placement. Master file stays unrotated.
 */
async function imageForDisplay(
  bytes: Buffer,
  rotation: Rotation,
): Promise<{ bytes: Buffer; width: number; height: number; format: 'png' | 'jpg' }> {
  let pipeline = sharp(bytes)
  if (rotation !== 0) {
    // sharp.rotate is clockwise for positive angles — matches CSS / masterPointToDisplay.
    pipeline = pipeline.rotate(rotation)
  }
  const { data, info } = await pipeline.png().toBuffer({ resolveWithObject: true })
  return {
    bytes: data,
    width: info.width,
    height: info.height,
    format: 'png',
  }
}

async function embedImage(
  doc: import('pdf-lib').PDFDocument,
  bytes: Buffer,
  format: 'png' | 'jpg',
): Promise<import('pdf-lib').PDFImage> {
  if (format === 'png') return doc.embedPng(bytes)
  return doc.embedJpg(bytes)
}

function parseProfile(json: string | null): CabinetProfile | null {
  if (!json) return null
  try {
    return JSON.parse(json) as CabinetProfile
  } catch {
    return null
  }
}

async function addCoverPage(
  doc: import('pdf-lib').PDFDocument,
  db: KeeprDatabase,
  font: import('pdf-lib').PDFFont,
): Promise<void> {
  const cabinet = loadCabinet(db)
  const profile = parseProfile(cabinet?.profileJson ?? null)
  const page = doc.addPage([612, 792]) // US Letter
  const title = profile?.business ?? profile?.name ?? cabinet?.displayName ?? 'KeepR Export'
  let y = 720
  page.drawText(String(title).slice(0, 80), {
    x: 72,
    y,
    size: 18,
    font,
    color: rgb(0.1, 0.1, 0.1),
  })
  y -= 28
  if (profile?.name && profile.name !== title) {
    page.drawText(String(profile.name).slice(0, 80), { x: 72, y, size: 12, font })
    y -= 18
  }
  if (profile?.address) {
    for (const line of String(profile.address).split(/\r?\n/)) {
      page.drawText(line.slice(0, 90), { x: 72, y, size: 11, font })
      y -= 16
    }
  }
  const taxBits = profile?.taxIds ?? (profile?.taxId ? [profile.taxId] : [])
  for (const t of taxBits) {
    page.drawText(`Tax ID: ${String(t)}`.slice(0, 90), { x: 72, y, size: 11, font })
    y -= 16
  }
  page.drawText(`Exported ${new Date().toISOString().slice(0, 10)}`, {
    x: 72,
    y: 72,
    size: 10,
    font,
    color: rgb(0.4, 0.4, 0.4),
  })
  void degrees
}

/**
 * Draw one page image full-bleed with an invisible OCR text layer.
 * Returns the PDF page index (0-based among all pages in the doc).
 */
export async function drawSearchablePage(
  doc: import('pdf-lib').PDFDocument,
  font: import('pdf-lib').PDFFont,
  pageRow: ItemPageRow,
  imageBytes: Buffer,
  opts?: { scale?: number; comment?: string | null },
): Promise<{ pageIndex: number; placements: Array<{ text: string; x: number; y: number; size: number }> }> {
  const rotation = asRotation(pageRow.rotation)
  const meta = await sharp(imageBytes).metadata()
  const masterW = pageRow.width ?? meta.width ?? 1
  const masterH = pageRow.height ?? meta.height ?? 1
  const scale = opts?.scale ?? 1

  const display = await imageForDisplay(imageBytes, rotation)
  const { w: dW, h: dH } = displaySize(masterW, masterH, rotation)
  // Prefer actual rotated pixel size when available (handles width/height nulls).
  const pageW = (display.width || dW) * scale
  const pageH = (display.height || dH) * scale

  const page = doc.addPage([pageW, pageH])
  const embedded = await embedImage(doc, display.bytes, display.format)
  page.drawImage(embedded, {
    x: 0,
    y: 0,
    width: pageW,
    height: pageH,
  })

  const words = parseWords(pageRow.ocrWordsJson)
  const placements: Array<{ text: string; x: number; y: number; size: number }> = []

  for (const word of words) {
    if (!word.text.trim()) continue
    // Sanitize for WinAnsi / Helvetica: drop chars outside Latin-1 printable.
    const text = word.text.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?').slice(0, 200)
    if (!text) continue
    const place = masterBBoxToPdfText(word.bbox, masterW, masterH, rotation, scale)
    // Clamp size so tiny boxes still produce selectable glyphs.
    const size = Math.min(Math.max(place.size, 4), pageH)
    try {
      page.drawText(text, {
        x: place.x,
        y: place.y,
        size,
        font,
        color: rgb(0, 0, 0),
        opacity: 0,
        maxWidth: Math.max(place.displayBox.w, size),
      })
      placements.push({ text, x: place.x, y: place.y, size })
    } catch {
      // Skip glyphs Helvetica cannot encode rather than failing the export.
    }
  }

  if (opts?.comment) {
    page.drawText(opts.comment.slice(0, 120), {
      x: 8,
      y: 8,
      size: 8,
      font,
      color: rgb(0.2, 0.2, 0.2),
      opacity: 0.5,
    })
  }

  return { pageIndex: doc.getPageCount() - 1, placements }
}

/**
 * Write a searchable PDF of the filtered items' page images.
 * Items with no pages do not throw — they simply contribute no image pages
 * (cover page still written when requested).
 */
export async function exportPdf(
  db: KeeprDatabase,
  req: ExportRequest,
  ctx?: ExportContext,
): Promise<string> {
  const destPath = path.resolve(req.destPath)
  const itemIds = resolveExportItemIds(db, {
    itemIds: req.itemIds,
    query: req.query,
  })
  const pages = queryItemPages(db, itemIds)
  const imagesPerPage = Math.max(1, req.options?.imagesPerPage ?? 1)
  const wantCover = req.options?.coverPage === true

  const progress = await beginExportProgress(
    ctx,
    'pdf',
    destPath,
    Math.max(1, pages.length + (wantCover ? 1 : 0)),
  )

  try {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)

    if (wantCover) {
      await addCoverPage(doc, db, font)
      await progress.bump(1)
    }

    // Receipt metadata for optional comments (description).
    const receiptById = new Map(
      queryExportReceipts(db, { itemIds: itemIds.length ? itemIds : undefined }).map((r) => [
        r.itemId,
        r,
      ]),
    )

    if (imagesPerPage <= 1) {
      for (const pageRow of pages) {
        const bytes = await loadImageBytes(ctx, pageRow.fileRelpath)
        if (!bytes) {
          // Missing image: still succeed for the item (no throw).
          await progress.bump(1)
          continue
        }
        const comment = receiptById.get(pageRow.itemId)?.description ?? null
        await drawSearchablePage(doc, font, pageRow, bytes, { comment })
        await progress.bump(1)
      }
    } else {
      // Tile multiple images onto a single PDF page (grid).
      for (let i = 0; i < pages.length; i += imagesPerPage) {
        const chunk = pages.slice(i, i + imagesPerPage)
        const cols = Math.ceil(Math.sqrt(imagesPerPage))
        const rows = Math.ceil(imagesPerPage / cols)
        const cellW = 300
        const cellH = 400
        const pdfPage = doc.addPage([cols * cellW, rows * cellH])

        for (let j = 0; j < chunk.length; j++) {
          const pageRow = chunk[j]!
          const bytes = await loadImageBytes(ctx, pageRow.fileRelpath)
          if (!bytes) {
            await progress.bump(1)
            continue
          }
          const rotation = asRotation(pageRow.rotation)
          const display = await imageForDisplay(bytes, rotation)
          const embedded = await embedImage(doc, display.bytes, display.format)
          const col = j % cols
          const row = Math.floor(j / cols)
          const x0 = col * cellW
          const y0 = (rows - 1 - row) * cellH
          const fit = Math.min(cellW / display.width, cellH / display.height)
          const w = display.width * fit
          const h = display.height * fit
          pdfPage.drawImage(embedded, {
            x: x0 + (cellW - w) / 2,
            y: y0 + (cellH - h) / 2,
            width: w,
            height: h,
          })

          // Text layer scaled into the cell (master → display → cell).
          const meta = await sharp(bytes).metadata()
          const masterW = pageRow.width ?? meta.width ?? 1
          const masterH = pageRow.height ?? meta.height ?? 1
          const words = parseWords(pageRow.ocrWordsJson)
          for (const word of words) {
            if (!word.text.trim()) continue
            const text = word.text.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?').slice(0, 200)
            if (!text) continue
            const place = masterBBoxToPdfText(word.bbox, masterW, masterH, rotation, fit)
            try {
              pdfPage.drawText(text, {
                x: x0 + (cellW - w) / 2 + place.x,
                y: y0 + (cellH - h) / 2 + place.y,
                size: Math.max(4, place.size),
                font,
                color: rgb(0, 0, 0),
                opacity: 0,
              })
            } catch {
              /* skip unencodable */
            }
          }
          await progress.bump(1)
        }
      }
    }

    // Items with no pages: already handled — we never threw. If the document is
    // still empty (no cover, no pages), add a blank page so the file is valid.
    if (doc.getPageCount() === 0) {
      const blank = doc.addPage([612, 792])
      blank.drawText('No pages to export', {
        x: 72,
        y: 720,
        size: 14,
        font,
        color: rgb(0.3, 0.3, 0.3),
      })
    }

    await mkdir(path.dirname(destPath), { recursive: true })
    const pdfBytes = await doc.save({ useObjectStreams: false })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(destPath, pdfBytes)
    await progress.done({ path: destPath, pageCount: doc.getPageCount() })
    return destPath
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await progress.fail(msg)
    throw e
  }
}
