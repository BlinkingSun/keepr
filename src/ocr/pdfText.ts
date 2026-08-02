/**
 * PDF embedded text layer — Lane P, batch 3.
 *
 * A searchable PDF already contains its text (ScanSnap's optional ABBYY pass,
 * or any born-digital receipt). Rasterizing that at 200 DPI and re-OCRing it
 * with tesseract is slower and usually worse. This module reads the layer when
 * it is trustworthy and returns null when it is not, so the caller can OCR as
 * normal — the layer is an optimisation, never an assumption.
 *
 * Two things here are load-bearing, both from the plan audit:
 *
 * 1. GEOMETRY. Word bboxes must land in stored-master pixel space (the `page`
 *    table's invariant), so this uses the SAME `getViewport({scale: dpi/72})`
 *    call the rasterizer makes and maps corners through it. `/Rotate` is not
 *    baked into item transforms and `e,f` is the text baseline, not the ink
 *    top-left, so a hand-rolled `y = 792 - f` is wrong on rotated pages and
 *    subtly wrong everywhere else.
 *
 * 2. THE (d) GATE. The dangerous failure is not a missing text layer — it is a
 *    layer with correct strings at wrong positions. Search looks perfect while
 *    click-to-assign and highlights silently point at the wrong pixels. So the
 *    gate runs on PRE-MERGE tokens in pixel space, before any word merging can
 *    smooth degenerate positions into plausible-looking words.
 */
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import nodePath from 'node:path'
import { pathToFileURL } from 'node:url'
import type { BBox, Word } from '../shared/types.ts'

/** Fixed confidence for embedded text. See PLAN-3 P4: deliberately moderate —
 *  we did not measure this text, and claiming 0.95 would assert a certainty we
 *  have no evidence for. */
export const PDF_TEXT_CONFIDENCE = 0.8

/** Default raster resolution; MUST match the import path's rasterize dpi. */
export const PDF_TEXT_DEFAULT_DPI = 200

export interface PdfTextPageResult {
  text: string
  /** Bboxes in stored-master pixel space at `dpi`. */
  words: Word[]
  confidence: number
  engine: 'pdf-text'
  /** Raw pdfjs item count, for logging why a page took one path or the other. */
  itemCount: number
}

/** One pdfjs item mapped to pixel space, BEFORE any word merging. */
export interface GeometryToken {
  text: string
  bbox: BBox
}

export type LayerVerdict = { usable: true } | { usable: false; reason: string }

/* ---------------------------------------------------------------------------
 * Gates
 * ------------------------------------------------------------------------ */

/**
 * Distinct bands the tokens occupy along one axis — a proxy for "rows of text".
 *
 * Both axes matter. On a `/Rotate 90` page the viewport turns text rows into
 * vertical strips, so a Y-only count sees ONE band and would reject a perfectly
 * good rotated scan; the structure is there, just along X.
 */
function countBands(tokens: GeometryToken[], axis: 'x' | 'y'): number {
  const sizes = tokens
    .map((t) => (axis === 'y' ? t.bbox.h : t.bbox.w))
    .filter((v) => v > 0)
    .sort((a, b) => a - b)
  const median = sizes[Math.floor(sizes.length / 2)] ?? 12
  const tolerance = Math.max(2, median * 0.6)
  const centers = tokens
    .map((t) => (axis === 'y' ? t.bbox.y + t.bbox.h / 2 : t.bbox.x + t.bbox.w / 2))
    .sort((a, b) => a - b)
  let bands = 0
  let last = Number.NEGATIVE_INFINITY
  for (const c of centers) {
    if (c - last > tolerance) {
      bands += 1
      last = c
    }
  }
  return bands
}

/** Area covered by the union of token boxes, approximated on a coarse grid so
 *  overlapping boxes are not double counted. */
function coverageRatio(tokens: GeometryToken[], widthPx: number, heightPx: number): number {
  const cells = 64
  const cw = widthPx / cells
  const ch = heightPx / cells
  const hit = new Set<number>()
  for (const t of tokens) {
    const x0 = Math.max(0, Math.floor(t.bbox.x / cw))
    const x1 = Math.min(cells - 1, Math.floor((t.bbox.x + t.bbox.w) / cw))
    const y0 = Math.max(0, Math.floor(t.bbox.y / ch))
    const y1 = Math.min(cells - 1, Math.floor((t.bbox.y + t.bbox.h) / ch))
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) hit.add(y * cells + x)
  }
  return hit.size / (cells * cells)
}

/**
 * Is this layer trustworthy enough to use instead of OCR?
 *
 * Takes PRE-MERGE tokens in stored-master pixel space, and page metrics in the
 * same space — both deliberate. Merging can turn degenerate positions into
 * plausible words, and comparing pixel boxes against point dimensions would
 * make the coverage and band thresholds meaningless.
 */
export function isLayerUsable(
  tokens: GeometryToken[],
  page: { widthPx: number; heightPx: number },
): LayerVerdict {
  if (tokens.length === 0) return { usable: false, reason: 'no text layer' }

  // (d) degenerate geometry — the silent one. Correct words, wrong positions.
  const positions = new Set(tokens.map((t) => `${Math.round(t.bbox.x)},${Math.round(t.bbox.y)}`))
  if (tokens.length >= 8 && positions.size <= 2) {
    return { usable: false, reason: `degenerate geometry: ${tokens.length} items share ${positions.size} position(s)` }
  }
  if (tokens.some((t) => t.bbox.w <= 0 || t.bbox.h <= 0)) {
    return { usable: false, reason: 'degenerate geometry: zero-area word boxes' }
  }
  // A letter-height page with almost no vertical structure is not a document
  // layout; 300pt at 200dpi is ~833px.
  const bands = Math.max(countBands(tokens, 'y'), countBands(tokens, 'x'))
  if (page.heightPx > (300 * PDF_TEXT_DEFAULT_DPI) / 72 && bands < 4) {
    return { usable: false, reason: 'degenerate geometry: fewer than 4 distinct text rows or columns' }
  }
  const coverage = coverageRatio(tokens, page.widthPx, page.heightPx)
  if (coverage < 0.02) {
    return { usable: false, reason: `degenerate geometry: text covers ${(coverage * 100).toFixed(1)}% of the page` }
  }

  // (c) junk — present and positioned, but not readable content.
  const all = tokens.map((t) => t.text).join('')
  const alnum = (all.match(/[\p{L}\p{N}]/gu) ?? []).length
  if (alnum / Math.max(1, all.length) < 0.45) {
    return { usable: false, reason: 'junk layer: low alphanumeric ratio' }
  }
  const unmappable = (all.match(/�/g) ?? []).length + (all.match(/\(cid:\d+\)/g) ?? []).length
  if (unmappable / Math.max(1, all.length) >= 0.15) {
    return { usable: false, reason: 'junk layer: unmappable glyphs (missing ToUnicode)' }
  }

  return { usable: true }
}

/* ---------------------------------------------------------------------------
 * Text normalisation + word re-tokenisation
 * ------------------------------------------------------------------------ */

const LIGATURES: Array<[RegExp, string]> = [
  [/ﬀ/g, 'ff'], [/ﬁ/g, 'fi'], [/ﬂ/g, 'fl'],
  [/ﬃ/g, 'ffi'], [/ﬄ/g, 'ffl'],
]

/** Normalise the oddities a PDF text layer carries that OCR output never does. */
export function normalizePdfText(s: string): string {
  let out = s.replace(/­/g, '') // soft hyphen: a line-break hint, not a character
  out = out.replace(/ /g, ' ')
  for (const [re, rep] of LIGATURES) out = out.replace(re, rep)
  // Full-width forms -> ASCII
  out = out.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
  return out
}

interface SubToken {
  text: string
  x0: number
  x1: number
  y: number
  h: number
}

/**
 * Split one item into whitespace-free pieces, estimating each piece's extent by
 * distributing the item's width across its characters.
 *
 * pdfjs items are glyph RUNS, not words: a single line can arrive as "HOM" +
 * "E DEPOT #4821", and pdfjs also inserts synthetic spaces wherever glyph
 * placement leaves a gap ("07/ 12/ 2026"). So item boundaries and the spaces
 * inside item strings are both unreliable as word boundaries — the geometry
 * decides, in `mergeIntoWords` below.
 */
function splitItem(text: string, box: BBox): SubToken[] {
  const chars = [...text]
  if (chars.length === 0) return []
  const per = box.w / chars.length
  const out: SubToken[] = []
  let i = 0
  while (i < chars.length) {
    if ((chars[i] ?? '').trim() === '') {
      i += 1
      continue
    }
    const start = i
    while (i < chars.length && (chars[i] ?? '').trim() !== '') i += 1
    out.push({
      text: chars.slice(start, i).join(''),
      x0: box.x + start * per,
      x1: box.x + i * per,
      y: box.y,
      h: box.h,
    })
  }
  return out
}

/**
 * Merge sub-tokens into words using horizontal gaps, not item boundaries.
 *
 * Within a word, consecutive glyphs sit a fraction of a character apart; a real
 * space is roughly a full character or more. Anything closer than 0.6 of the
 * page's median character width is treated as the same word, which reassembles
 * both split runs ("HOM"+"E") and pdfjs's synthetic spaces ("07/"+"12/").
 */
function mergeIntoWords(subs: SubToken[]): Word[] {
  if (subs.length === 0) return []

  const charWidths = subs
    .map((s) => (s.x1 - s.x0) / Math.max(1, [...s.text].length))
    .filter((w) => w > 0)
    .sort((a, b) => a - b)
  const medianChar = charWidths[Math.floor(charWidths.length / 2)] ?? 6
  const mergeGap = medianChar * 0.6

  const heights = subs.map((s) => s.h).filter((h) => h > 0).sort((a, b) => a - b)
  const medianH = heights[Math.floor(heights.length / 2)] ?? 12
  const lineTol = Math.max(2, medianH * 0.6)

  // Group into lines by vertical centre, then order left to right.
  const lines: SubToken[][] = []
  for (const s of [...subs].sort((a, b) => a.y - b.y || a.x0 - b.x0)) {
    const centre = s.y + s.h / 2
    const line = lines.find((l) => {
      const first = l[0]
      if (!first) return false
      return Math.abs(first.y + first.h / 2 - centre) <= lineTol
    })
    if (line) line.push(s)
    else lines.push([s])
  }

  const words: Word[] = []
  for (const line of lines) {
    line.sort((a, b) => a.x0 - b.x0)
    let cur: SubToken | undefined
    const flush = (): void => {
      const c = cur
      cur = undefined
      if (!c) return
      const text = normalizePdfText(c.text).trim()
      if (!text) return
      words.push({
        text,
        bbox: { x: c.x0, y: c.y, w: Math.max(1, c.x1 - c.x0), h: Math.max(1, c.h) },
        confidence: PDF_TEXT_CONFIDENCE,
      })
    }
    for (const s of line) {
      if (cur && s.x0 - cur.x1 <= mergeGap) {
        cur = { text: cur.text + s.text, x0: cur.x0, x1: Math.max(cur.x1, s.x1), y: Math.min(cur.y, s.y), h: Math.max(cur.h, s.h) }
      } else {
        flush()
        cur = { ...s }
      }
    }
    flush()
  }
  return words
}

/** Words -> plain text the receipt parser can line-group exactly as it does for
 *  tesseract output: one line per row, single spaces between words. */
function wordsToText(words: Word[]): string {
  if (words.length === 0) return ''
  const heights = words.map((w) => w.bbox.h).sort((a, b) => a - b)
  const medianH = heights[Math.floor(heights.length / 2)] ?? 12
  const tol = Math.max(2, medianH * 0.6)

  const lines: Word[][] = []
  for (const w of [...words].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)) {
    const centre = w.bbox.y + w.bbox.h / 2
    const line = lines.find((l) => {
      const first = l[0]
      if (!first) return false
      return Math.abs(first.bbox.y + first.bbox.h / 2 - centre) <= tol
    })
    if (line) line.push(w)
    else lines.push([w])
  }
  return lines
    .map((l) => l.sort((a, b) => a.bbox.x - b.bbox.x).map((w) => w.text).join(' '))
    .join('\n')
}

/* ---------------------------------------------------------------------------
 * Entry point
 * ------------------------------------------------------------------------ */

/** pdfjs's bundled standard-font data (Helvetica/Times/Courier). Undefined when
 *  it cannot be located — degraded metrics beat a failed import. */
function standardFontsDir(): string | undefined {
  try {
    const req = createRequire(import.meta.url)
    const pkg = req.resolve('pdfjs-dist/package.json')
    return pathToFileURL(nodePath.join(nodePath.dirname(pkg), 'standard_fonts') + nodePath.sep).href
  } catch {
    return undefined
  }
}

interface PdfTextItemLike {
  str?: string
  transform?: number[]
  width?: number
  height?: number
}

interface ViewportLike {
  width: number
  height: number
  convertToViewportPoint(x: number, y: number): number[]
}

/** Map one item's user-space quad through the viewport into a pixel-space AABB. */
function itemToBox(item: PdfTextItemLike, viewport: ViewportLike): BBox | null {
  const t = item.transform
  if (!t || t.length < 6) return null
  const [a, b, c, d, e, f] = t as [number, number, number, number, number, number]
  const w = item.width ?? 0
  // Height can be reported as 0 for some producers; fall back to the transform's
  // vertical scale, which is the font size in user space.
  const h = item.height && item.height > 0 ? item.height : Math.hypot(b, d) || 0
  if (w <= 0 || h <= 0) return null

  // Quad corners in user space. The origin (e,f) is the BASELINE-left point and
  // the ink box rises above it, so the corners are built along the text's own
  // axes and then transformed — not by subtracting h afterwards, which only
  // works upright.
  //
  // `width`/`height` are already user-space LENGTHS, while a..d carry the font
  // scale. Multiplying the two double-scales the box (a 117pt string became
  // 1408pt and left the page), so the direction vectors are normalised first.
  const along = Math.hypot(a, b) || 1
  const up = Math.hypot(c, d) || 1
  const ux = a / along
  const uy = b / along
  const vx = c / up
  const vy = d / up
  const corners: Array<[number, number]> = [
    [e, f],
    [e + ux * w, f + uy * w],
    [e + vx * h, f + vy * h],
    [e + ux * w + vx * h, f + uy * w + vy * h],
  ]
  const pts = corners.map(([x, y]) => viewport.convertToViewportPoint(x, y))
  const xs = pts.map((p) => p[0] ?? 0)
  const ys = pts.map((p) => p[1] ?? 0)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * Read a PDF page's embedded text layer.
 *
 * Returns null when the layer is absent or untrustworthy — the caller then OCRs
 * the page exactly as before. Throws only when the PDF itself cannot be opened,
 * because that is a real import error rather than a missing optimisation.
 */
export async function extractPdfPageText(
  absPath: string,
  pageIndex: number,
  opts?: { dpi?: number },
): Promise<PdfTextPageResult | null> {
  const dpi = opts?.dpi ?? PDF_TEXT_DEFAULT_DPI
  const { nodeRequire: require } = await import('../shared/nodeRequire.ts')
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  try {
    const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
    const { pathToFileURL } = await import('node:url')
    GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
  } catch {
    GlobalWorkerOptions.workerSrc = ''
  }

  const data = new Uint8Array(await readFile(absPath))
  const doc = await getDocument({
    data,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
    ...(standardFontsDir() ? { standardFontDataUrl: standardFontsDir() } : {}),
  } as Parameters<typeof getDocument>[0]).promise

  try {
    if (pageIndex < 0 || pageIndex >= doc.numPages) {
      throw new RangeError(`PDF pageIndex ${pageIndex} out of range 0..${doc.numPages - 1}`)
    }
    const page = await doc.getPage(pageIndex + 1)
    // The SAME viewport the rasterizer builds, so rotation, CropBox and scale
    // are handled identically and the two spaces cannot drift apart.
    const viewport = page.getViewport({ scale: dpi / 72 }) as unknown as ViewportLike
    const widthPx = Math.max(1, Math.ceil(viewport.width))
    const heightPx = Math.max(1, Math.ceil(viewport.height))

    const content = await page.getTextContent()
    const items = (content.items as PdfTextItemLike[]).filter(
      (i) => typeof i.str === 'string' && i.str.trim() !== '',
    )

    // 1:1 tokens first — the gate must see raw positions.
    const tokens: GeometryToken[] = []
    for (const item of items) {
      const bbox = itemToBox(item, viewport)
      if (bbox) tokens.push({ text: item.str ?? '', bbox })
    }

    const verdict = isLayerUsable(tokens, { widthPx, heightPx })
    if (!verdict.usable) return null

    const subs = tokens.flatMap((t) => splitItem(t.text, t.bbox))
    const words = mergeIntoWords(subs)
    if (words.length === 0) return null

    return {
      text: wordsToText(words),
      words,
      confidence: PDF_TEXT_CONFIDENCE,
      engine: 'pdf-text',
      itemCount: items.length,
    }
  } finally {
    await doc.destroy()
  }
}

/** Same as `extractPdfPageText` but surfaces WHY a layer was refused. Used by
 *  the import path's logging and by tests, so a rejection is explainable rather
 *  than a silent fallback. */
export async function inspectPdfPageText(
  absPath: string,
  pageIndex: number,
  opts?: { dpi?: number },
): Promise<{ result: PdfTextPageResult | null; reason: string }> {
  const result = await extractPdfPageText(absPath, pageIndex, opts)
  if (result) return { result, reason: 'usable' }

  // Recompute the verdict for the message. Cheap next to OCR, and only on the
  // fallback path.
  const dpi = opts?.dpi ?? PDF_TEXT_DEFAULT_DPI
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(await readFile(absPath))
  const doc = await getDocument({
    data,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true,
  } as Parameters<typeof getDocument>[0]).promise
  try {
    const page = await doc.getPage(pageIndex + 1)
    const viewport = page.getViewport({ scale: dpi / 72 }) as unknown as ViewportLike
    const content = await page.getTextContent()
    const tokens: GeometryToken[] = []
    for (const item of (content.items as PdfTextItemLike[]).filter(
      (i) => typeof i.str === 'string' && i.str.trim() !== '',
    )) {
      const bbox = itemToBox(item, viewport)
      if (bbox) tokens.push({ text: item.str ?? '', bbox })
    }
    const verdict = isLayerUsable(tokens, {
      widthPx: Math.max(1, Math.ceil(viewport.width)),
      heightPx: Math.max(1, Math.ceil(viewport.height)),
    })
    return { result: null, reason: verdict.usable ? 'no words after merge' : verdict.reason }
  } finally {
    await doc.destroy()
  }
}
