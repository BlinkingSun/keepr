/**
 * PDF fixtures for the text-layer path — generated, not committed as binaries.
 *
 * The plan audit called calibrating on `cupsfilter` output alone a HIGH process
 * risk, and it was right: that produces one tidy shape of PDF and none of the
 * shapes that actually break things. These five are written byte-by-byte so we
 * control exactly the properties under test:
 *
 *   sandwich     invisible text (Tr 3) over a raster — what a searchable scan is
 *   imageOnly    raster, no text layer at all — must fall back to OCR
 *   glyphStream  one show-text op per glyph — the "T O T A L" shredder
 *   misaligned   correct strings, every item at the same point — state (d)
 *   rotated90    /Rotate 90 with real text — proves we do not hand-roll the flip
 *
 * A minimal writer is used rather than a dependency: pdf-lib is not in the tree,
 * and adding one to make test data would be a poor trade.
 */
import sharp from 'sharp'

const PAGE_W = 612
const PAGE_H = 792

/** Lines of a plausible receipt, positioned from the top of the page. */
export const RECEIPT_LINES: Array<{ text: string; x: number; yFromTop: number }> = [
  { text: 'HOME DEPOT #4821', x: 72, yFromTop: 80 },
  { text: '1200 COMMERCE BLVD', x: 72, yFromTop: 100 },
  { text: '07/12/2026 14:22', x: 72, yFromTop: 130 },
  { text: 'LUMBER 2X4 48.00', x: 72, yFromTop: 170 },
  { text: 'SCREWS BOX 12.99', x: 72, yFromTop: 190 },
  { text: 'SUBTOTAL 115.48', x: 72, yFromTop: 230 },
  { text: 'TAX 9.53', x: 72, yFromTop: 250 },
  { text: 'TOTAL 125.01', x: 72, yFromTop: 270 },
  { text: 'VISA ****4242', x: 72, yFromTop: 300 },
]

/** PDF text position is baseline-from-bottom; the table above is top-down. */
const toPdfY = (yFromTop: number): number => PAGE_H - yFromTop

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

interface PdfObject {
  /** Body without the "N 0 obj"/"endobj" wrapper. */
  body: string | Buffer
}

/**
 * Assemble objects into a valid PDF with a correct xref table. Offsets must be
 * byte-exact or pdfjs rejects the file, so the objects are serialised once and
 * measured as Buffers rather than strings (a JPEG payload is not UTF-8).
 */
function buildPdf(objects: PdfObject[], rootIndex = 1): Buffer {
  const header = Buffer.from('%PDF-1.4\n')
  const chunks: Buffer[] = [header]
  const offsets: number[] = []
  let pos = header.length

  objects.forEach((obj, i) => {
    const num = i + 1
    const open = Buffer.from(`${num} 0 obj\n`)
    const body = Buffer.isBuffer(obj.body) ? obj.body : Buffer.from(obj.body)
    const close = Buffer.from('\nendobj\n')
    offsets.push(pos)
    chunks.push(open, body, close)
    pos += open.length + body.length + close.length
  })

  const xrefStart = pos
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${rootIndex} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  chunks.push(Buffer.from(xref))

  return Buffer.concat(chunks)
}

function streamObject(content: string): PdfObject {
  return { body: `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream` }
}

interface PageOptions {
  content: string
  /** Extra resource entries, e.g. an image XObject. */
  xobject?: boolean
  rotate?: 0 | 90 | 180 | 270
  imageBytes?: Buffer
  imageW?: number
  imageH?: number
}

function buildOnePagePdf(opts: PageOptions): Buffer {
  const resources = opts.xobject
    ? '<< /Font << /F1 5 0 R >> /XObject << /Im0 6 0 R >> >>'
    : '<< /Font << /F1 5 0 R >> >>'
  const rotate = opts.rotate ? ` /Rotate ${opts.rotate}` : ''

  const objects: PdfObject[] = [
    { body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    {
      body:
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}]${rotate} ` +
        `/Resources ${resources} /Contents 4 0 R >>`,
    },
    streamObject(opts.content),
    { body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
  ]

  if (opts.xobject && opts.imageBytes) {
    const head = Buffer.from(
      `<< /Type /XObject /Subtype /Image /Width ${opts.imageW} /Height ${opts.imageH} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
        `/Length ${opts.imageBytes.length} >>\nstream\n`,
    )
    objects.push({ body: Buffer.concat([head, opts.imageBytes, Buffer.from('\nendstream')]) })
  }

  return buildPdf(objects)
}

/** A page-filling JPEG that looks like a scanned receipt (for the sandwich). */
async function receiptJpeg(): Promise<{ bytes: Buffer; w: number; h: number }> {
  const w = 850
  const h = 1100
  const bytes = await sharp({
    create: { width: w, height: h, channels: 3, background: { r: 248, g: 248, b: 246 } },
  })
    .jpeg({ quality: 80 })
    .toBuffer()
  return { bytes, w, h }
}

const drawImage = `q ${PAGE_W} 0 0 ${PAGE_H} 0 0 cm /Im0 Do Q\n`

/** Invisible text (Tr 3) over a raster — a real searchable scan's structure. */
export async function sandwichPdf(): Promise<Buffer> {
  const img = await receiptJpeg()
  let content = drawImage + 'BT /F1 12 Tf 3 Tr\n'
  for (const line of RECEIPT_LINES) {
    content += `1 0 0 1 ${line.x} ${toPdfY(line.yFromTop)} Tm (${escapeText(line.text)}) Tj\n`
  }
  content += 'ET'
  return buildOnePagePdf({
    content,
    xobject: true,
    imageBytes: img.bytes,
    imageW: img.w,
    imageH: img.h,
  })
}

/** Raster only: no text operators anywhere. Must fall back to OCR. */
export async function imageOnlyPdf(): Promise<Buffer> {
  const img = await receiptJpeg()
  return buildOnePagePdf({
    content: drawImage.trim(),
    xobject: true,
    imageBytes: img.bytes,
    imageW: img.w,
    imageH: img.h,
  })
}

/**
 * Helvetica advance widths (per 1000 units) for the glyphs these fixtures use.
 *
 * Real widths matter: an earlier version advanced every glyph by a uniform 7.2
 * points, which made the space in "TOTAL 125.01" geometrically identical to the
 * gap between two digits. No adapter could separate those, and no real producer
 * emits text that way — the fixture was unfair rather than adversarial.
 */
const HELVETICA_W: Record<string, number> = {
  ' ': 278, '#': 556, '*': 389, '.': 278, '/': 278, ':': 278,
  A: 667, B: 667, C: 722, D: 722, E: 667, H: 722, I: 278, L: 556, M: 833,
  N: 722, O: 778, P: 667, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667,
}
const advanceOf = (ch: string, size: number): number =>
  ((HELVETICA_W[ch] ?? (/[0-9]/.test(ch) ? 556 : 611)) / 1000) * size

/**
 * One show-text operator per glyph, each positioned individually — the shape
 * that turns TOTAL into "T O T A L" if items are mapped 1:1 to words. Glyphs
 * advance by their true widths, so word gaps are genuinely wider than
 * inter-glyph gaps, exactly as a real glyph-placing producer emits them.
 */
export function glyphStreamPdf(): Buffer {
  const size = 12
  let content = `BT /F1 ${size} Tf\n`
  for (const line of RECEIPT_LINES) {
    const y = toPdfY(line.yFromTop)
    let x = line.x
    for (const ch of line.text) {
      if (ch !== ' ') content += `1 0 0 1 ${x.toFixed(2)} ${y} Tm (${escapeText(ch)}) Tj\n`
      x += advanceOf(ch, size)
    }
  }
  content += 'ET'
  return buildOnePagePdf({ content })
}

/**
 * State (d): every string is correct, every position is the same point. Text
 * search would look perfect; click-to-assign would lie. Must be rejected.
 */
export function misalignedPdf(): Buffer {
  let content = 'BT /F1 12 Tf\n'
  for (const line of RECEIPT_LINES) {
    content += `1 0 0 1 72 700 Tm (${escapeText(line.text)}) Tj\n`
  }
  content += 'ET'
  return buildOnePagePdf({ content })
}

/** /Rotate 90 with real text — the case a hand-rolled y-flip gets wrong. */
export function rotated90Pdf(): Buffer {
  let content = 'BT /F1 12 Tf\n'
  for (const line of RECEIPT_LINES) {
    content += `1 0 0 1 ${line.x} ${toPdfY(line.yFromTop)} Tm (${escapeText(line.text)}) Tj\n`
  }
  content += 'ET'
  return buildOnePagePdf({ content, rotate: 90 })
}

/** Visible text, upright, no image — the simple positive control. */
export function plainTextPdf(): Buffer {
  let content = 'BT /F1 12 Tf\n'
  for (const line of RECEIPT_LINES) {
    content += `1 0 0 1 ${line.x} ${toPdfY(line.yFromTop)} Tm (${escapeText(line.text)}) Tj\n`
  }
  content += 'ET'
  return buildOnePagePdf({ content })
}

/**
 * A two-line parking receipt on a full US Letter page.
 *
 * The batch-3 execution audit proved this shape was being REFUSED by the
 * structure gate and pushed onto slow OCR, which is backwards: it is one of the
 * most common things anyone scans, and its text layer is perfectly good. Sparse
 * is not degenerate.
 */
export function shortReceiptPdf(): Buffer {
  const lines = [
    { text: 'PARKING METER 118', x: 72, yFromTop: 90 },
    { text: 'TOTAL 4.00', x: 72, yFromTop: 120 },
  ]
  let content = 'BT /F1 12 Tf\n'
  for (const l of lines) content += `1 0 0 1 ${l.x} ${toPdfY(l.yFromTop)} Tm (${escapeText(l.text)}) Tj\n`
  content += 'ET'
  return buildOnePagePdf({ content })
}

/** Text layer that is only whitespace — present but worthless. */
export function whitespaceOnlyPdf(): Buffer {
  let content = 'BT /F1 12 Tf\n'
  for (let i = 0; i < 6; i++) {
    content += `1 0 0 1 72 ${700 - i * 20} Tm (   ) Tj\n`
  }
  content += 'ET'
  return buildOnePagePdf({ content })
}
