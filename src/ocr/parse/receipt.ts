/**
 * Pure, deterministic receipt field extraction from OCR results.
 * Same input → same output. No clock, no randomness, no IO.
 *
 * Never emit a value you did not find — omit the field. A confidently wrong
 * date is far worse than a missing one.
 */

import type {
  BBox,
  ExtractionRecord,
  FieldProvenance,
  MinorUnits,
  OcrResult,
  Word,
} from '../../shared/types.ts'
import { asMinor } from '../../shared/types.ts'
import { findDateInText, parseDate, type DateOrder, type DateParseHints } from './date.ts'
import { findMoneyInText, parseMoney } from './money.ts'

export interface ParseHints {
  /** Known vendor display names to prefer when matching. */
  vendors?: string[]
  /** BCP-47 locale for date order / money defaults. */
  locale?: string
  dateOrder?: DateOrder
  /** Optional page id stamped onto provenance. */
  pageId?: number | null
}

interface Line {
  text: string
  words: Word[]
  bbox: BBox
  /** Mean word confidence 0..1 */
  conf: number
  /** Vertical position (top) for ordering */
  y: number
}

export interface TaxLineValue {
  label: string
  amountMinor: MinorUnits
}

export interface TaxTotalValue {
  totalMinor: MinorUnits
  lines: TaxLineValue[]
}

/**
 * Extract proposed receipt fields from an OCR result.
 */
export function parseReceipt(ocr: OcrResult, hints: ParseHints = {}): ExtractionRecord {
  const pageId = hints.pageId ?? null
  const lines = buildLines(ocr.words, ocr.text)
  const fullText = ocr.text || lines.map((l) => l.text).join('\n')
  const out: ExtractionRecord = {}

  const total = extractTotal(lines)
  if (total) out.total = withPage(total, pageId)

  const date = extractDate(lines, fullText, hints)
  if (date) out.txnDate = withPage(date, pageId)

  const vendor = extractVendor(lines, hints.vendors ?? [])
  if (vendor && looksLikeVendorName(vendor.value)) out.vendor = withPage(vendor, pageId)

  const tax = extractTax(lines)
  if (tax) {
    const checked = plausibleTax(tax, total, extractSubtotal(lines), sumAdjustmentLines(lines))
    if (checked) out.taxTotal = withPage(checked, pageId)
  }

  const pay = extractPayment(lines, fullText)
  if (pay) out.paymentType = withPage(pay, pageId)

  const ref = extractExternalRef(lines, fullText)
  if (ref) out.externalRef = withPage(ref, pageId)

  const desc = extractDescription(lines)
  if (desc) out.description = withPage(desc, pageId)

  return out
}

function withPage<T>(fp: FieldProvenance<T>, pageId: number | null): FieldProvenance<T> {
  return { ...fp, pageId, pinned: false }
}

/* ---------------------------------------------------------------------------
 * Lines from words (or fall back to text split)
 * ------------------------------------------------------------------------ */

function buildLines(words: Word[], text: string): Line[] {
  if (words.length > 0) {
    // Group by approximate baseline (y), tolerance = half median height
    const heights = words.map((w) => w.bbox.h).filter((h) => h > 0).sort((a, b) => a - b)
    const medH = heights[Math.floor(heights.length / 2)] ?? 12
    const tol = Math.max(6, medH * 0.6)

    const sorted = [...words].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)
    const groups: Word[][] = []
    for (const w of sorted) {
      const last = groups[groups.length - 1]
      if (!last) {
        groups.push([w])
        continue
      }
      const lastY = meanY(last)
      if (Math.abs(w.bbox.y - lastY) <= tol) last.push(w)
      else groups.push([w])
    }

    return groups.map((ws) => {
      ws.sort((a, b) => a.bbox.x - b.bbox.x)
      const text = ws.map((w) => w.text).join(' ')
      const bbox = unionBBox(ws.map((w) => w.bbox))
      const conf = ws.reduce((s, w) => s + w.confidence, 0) / ws.length
      return { text, words: ws, bbox, conf, y: bbox.y }
    })
  }

  // Text-only synthetic path (unit fixtures)
  return text
    .split(/\r?\n/)
    .map((t, i) => t.trim())
    .filter(Boolean)
    .map((t, i) => ({
      text: t,
      words: [] as Word[],
      bbox: { x: 0, y: i * 20, w: Math.max(1, t.length * 8), h: 16 },
      conf: 0.85,
      y: i * 20,
    }))
}

function meanY(ws: Word[]): number {
  return ws.reduce((s, w) => s + w.bbox.y, 0) / ws.length
}

function unionBBox(boxes: BBox[]): BBox {
  if (!boxes.length) return { x: 0, y: 0, w: 0, h: 0 }
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const b of boxes) {
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.w)
    y1 = Math.max(y1, b.y + b.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * Cross-field sanity check on tax.
 *
 * The parser can only report what OCR gave it, and OCR sometimes gives nonsense:
 * on a real corpus run it read "PST 7% 9.79" as "PST 17% 99.0", so the tax lines
 * summed to $103.91 against a $112.95 total. The parser was faithful and the
 * answer was still wrong — and a wrong tax figure is worse than an absent one,
 * because the user sees a plausible number and files it.
 *
 * No sales tax anywhere is a majority of the amount charged. When the extracted
 * tax exceeds MAX_TAX_FRACTION of the total, this is not a tax reading, so drop
 * it and let the field show as missing. Missing prompts the user; wrong does not.
 *
 * Only applied when a total was actually found — with no total there is nothing
 * to judge the tax against, and a lone tax reading is better than nothing.
 */
const MAX_TAX_FRACTION = 0.5

/** Cent tolerance when comparing an extracted tax against total - subtotal. */
const TAX_ARITHMETIC_TOLERANCE = 2

/**
 * Lines that sit BETWEEN subtotal and total and are not tax.
 *
 * total = subtotal + tax + adjustments. Ignoring the adjustments is how the
 * arithmetic check went wrong on a restaurant receipt: subtotal 82.00, total
 * 96.60, so the naive difference called 14.60 "tax" when the real tax was 5.60
 * and the other 9.00 was the tip. A gratuity is not a tax and must never be
 * reported as one — it is not deductible the same way and it is not remitted to
 * anyone's revenue service.
 */
function sumAdjustmentLines(lines: Line[]): number {
  const re =
    /\b(tip|gratuity|service\s*(?:charge|fee)|delivery(?:\s*fee)?|shipping|handling|freight|surcharge|rounding|discount|coupon|savings|bag\s*fee|bottle\s*deposit)\b/i
  let sum = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!re.test(line.text)) continue
    const money = moneyFromLine(line, lines[i + 1])
    if (!money) continue
    // Discounts reduce the total, so they carry the opposite sign even when the
    // receipt prints them unsigned.
    const isReduction = /\b(discount|coupon|savings)\b/i.test(line.text)
    const v = Math.abs(money.minor)
    sum += isReduction ? -v : v
  }
  return sum
}

/**
 * The SUBTOTAL line, when the receipt prints one.
 *
 * Used only to sanity-check tax. It is deliberately separate from extractTotal,
 * which rejects subtotal lines outright.
 */
function extractSubtotal(lines: Line[]): number | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const lower = ocrNormalize(line.text).replace(/\s+/g, ' ')
    if (!/\bsub\s*total\b|\bsubtotal\b|\bnetto\b|\bsous\s*total\b/.test(lower)) continue
    const money = moneyFromLine(line, lines[i + 1])
    if (money) return money.minor
  }
  return null
}

function plausibleTax(
  tax: FieldProvenance<TaxTotalValue>,
  total: FieldProvenance<MinorUnits> | null,
  subtotalMinor: number | null,
  adjustmentsMinor: number,
): FieldProvenance<TaxTotalValue> | null {
  if (!total) return tax
  const totalAbs = Math.abs(total.value as unknown as number)
  if (totalAbs === 0) return tax
  const taxAbs = Math.abs(tax.value.totalMinor as unknown as number)

  // Strongest available check: when the receipt prints both a subtotal and a
  // total, the difference IS the tax. Two prominent, well-printed figures beat a
  // small tax line that OCR routinely mangles — a corpus run had "PST 7% 9.79"
  // read as "PST 17% 99.0", while SUBTOTAL and TOTAL were read perfectly.
  if (subtotalMinor != null) {
    const implied = (total.value as unknown as number) - subtotalMinor - adjustmentsMinor
    const impliedAbs = Math.abs(implied)
    const impliedPlausible = impliedAbs <= totalAbs * MAX_TAX_FRACTION
    if (impliedPlausible && Math.abs(impliedAbs - taxAbs) > TAX_ARITHMETIC_TOLERANCE) {
      const sign = (total.value as unknown as number) < 0 ? -1 : 1
      return {
        ...tax,
        value: {
          totalMinor: asMinor(sign * impliedAbs),
          // Keep the lines that agree with the arithmetic; drop the rest rather
          // than reporting a breakdown that does not add up to its own total.
          lines: tax.value.lines.filter(
            (l) => Math.abs(l.amountMinor as unknown as number) <= impliedAbs + TAX_ARITHMETIC_TOLERANCE,
          ),
        },
        // Below the display threshold on purpose: this is a reconstruction, and
        // the user should confirm it.
        confidence: Math.min(tax.confidence, 0.55),
      }
    }
    if (impliedPlausible && Math.abs(impliedAbs - taxAbs) <= TAX_ARITHMETIC_TOLERANCE) {
      // Extraction and arithmetic agree — that is real corroboration, so raise
      // confidence rather than leaving it at the line-read value.
      return { ...tax, confidence: Math.max(tax.confidence, 0.9) }
    }
  }

  if (taxAbs <= totalAbs * MAX_TAX_FRACTION) return tax

  // Before discarding everything, try dropping the single implausible line: a
  // two-tax receipt where OCR mangled one of them still has a good other half.
  const kept = tax.value.lines.filter(
    (l) => Math.abs(l.amountMinor as unknown as number) <= totalAbs * MAX_TAX_FRACTION,
  )
  if (kept.length && kept.length < tax.value.lines.length) {
    const sum = kept.reduce((acc, l) => acc + (l.amountMinor as unknown as number), 0)
    if (Math.abs(sum) <= totalAbs * MAX_TAX_FRACTION) {
      return {
        ...tax,
        value: { totalMinor: asMinor(sum), lines: kept },
        // Confidence is capped well below the display threshold: a partial tax
        // reading must always be reviewed.
        confidence: Math.min(tax.confidence, 0.4),
      }
    }
  }
  return null
}

/* ---------------------------------------------------------------------------
 * TOTAL — hardest field
 *
 * Prefer a labelled TOTAL near the bottom. Beware SUBTOTAL, TAX, CASH, CHANGE,
 * TIP, BALANCE DUE. When several candidates tie, prefer the largest labelled
 * TOTAL that is not preceded by SUB.
 * ------------------------------------------------------------------------ */

interface TotalCandidate {
  minor: number
  moneyConf: number
  line: Line
  /** How good the label match is */
  labelScore: number
  /** Prefer lower lines (near bottom of receipt) */
  y: number
  kind: 'total' | 'amount_due' | 'balance' | 'grand' | 'bare'
}

function extractTotal(lines: Line[]): FieldProvenance<MinorUnits> | null {
  const candidates: TotalCandidate[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const text = line.text
    // OCR-tolerant label view: 0↔o, 1↔l for common thermal misreads (T0TAL, SUBT0TAL)
    const lower = ocrNormalize(text).replace(/\s+/g, ' ')

    // Hard reject pure non-total labels even if they contain a number
    if (isRejectedTotalLine(lower) && !/\b(?:grand\s*)?total\b/.test(lower)) {
      continue
    }
    // SUBTOTAL line — never a total, even if it says "total"
    if (/\bsub\s*total\b|\bsubtotal\b/i.test(lower)) continue

    const labelScore = scoreTotalLabel(lower)
    if (labelScore <= 0) continue

    const money = moneyFromLine(line, lines[i + 1])
    if (!money) continue

    candidates.push({
      minor: money.minor,
      moneyConf: money.confidence,
      line,
      labelScore,
      y: line.y,
      kind: classifyTotalKind(lower),
    })
  }

  if (!candidates.length) {
    // No labelled total — do NOT guess from the largest number on the page.
    return null
  }

  // Sort: higher label score, then lower on page (larger y), then larger amount
  candidates.sort((a, b) => {
    if (b.labelScore !== a.labelScore) return b.labelScore - a.labelScore
    if (b.y !== a.y) return b.y - a.y
    return Math.abs(b.minor) - Math.abs(a.minor)
  })

  // When several candidates share the top label score, prefer the largest
  // labelled TOTAL that is not preceded by SUB (already filtered).
  const topScore = candidates[0]!.labelScore
  const top = candidates.filter((c) => c.labelScore === topScore)
  top.sort((a, b) => Math.abs(b.minor) - Math.abs(a.minor) || b.y - a.y)
  const chosen = top[0]!

  const conf = clamp01(chosen.labelScore * 0.55 + chosen.moneyConf * 0.35 + chosen.line.conf * 0.1)
  return {
    value: asMinor(chosen.minor),
    confidence: conf,
    bbox: chosen.line.bbox,
    pageId: null,
    pinned: false,
  }
}

function isRejectedTotalLine(lower: string): boolean {
  // Lines that are primarily a non-total label (lower is ocr-normalized)
  if (/\bsub\s*total\b|\bsubtotal\b/.test(lower)) return true
  if (/^\s*(?:tax|gst|hst|pst|vat|sales\s*tax)\b/.test(lower)) return true
  if (/^\s*(?:cash|change|tip|gratuity)\b/.test(lower)) return true
  if (/^\s*(?:visa|mc|mastercard|amex|debit)\b/.test(lower) && !/\btotal\b/.test(lower)) return true
  return false
}

function scoreTotalLabel(lower: string): number {
  if (/\bsub\s*total\b|\bsubtotal\b/.test(lower)) return 0
  // Non-English pre-tax lines behave exactly like SUBTOTAL and must never win:
  // netto (de/nl), sous-total (fr), subtotale (it), base imponible (es).
  if (/\bnetto\b|\bsous\s*total\b|\bsubtotale\b|\bbase\s*imponible\b|\bzwischensumme\b/.test(lower)) return 0
  // Non-English grand-total labels. A German receipt says SUMME or GESAMT and
  // never the word "total", so without these the total is simply not found —
  // which is what the corpus run showed on the Bauhaus receipt.
  if (/\bgesamtbetrag\b|\bzu\s*zahlen\b|\bendbetrag\b/.test(lower)) return 1.0
  if (/\bsumme\b|\bgesamt\b|\btotaal\b|\btotale\b|\bimporto\b|\bmontant\b|\bte\s*betalen\b/.test(lower)) return 0.92
  if (/\bgrand\s*total\b/.test(lower)) return 1.0
  if (/\bamount\s*due\b|\bamt\s*due\b|\btotal\s*due\b/.test(lower)) return 0.95
  // BALANCE DUE is weaker — often equals total but sometimes is remaining after partial pay
  if (/\bbalance\s*due\b/.test(lower)) return 0.75
  if (/\btotal\b/.test(lower)) {
    // "TOTAL" alone or "TOTAL USD" etc.
    if (/^\s*total\b/.test(lower) || /\btotal\s*[:$]/.test(lower) || /\btotal\s+\d/.test(lower)) {
      return 0.92
    }
    // "Items total" / mid-line total — weaker
    return 0.7
  }
  return 0
}

function classifyTotalKind(lower: string): TotalCandidate['kind'] {
  if (/\bgrand\s*total\b/.test(lower)) return 'grand'
  if (/\bamount\s*due\b|\bamt\s*due\b/.test(lower)) return 'amount_due'
  if (/\bbalance\b/.test(lower)) return 'balance'
  if (/\btotal\b/.test(lower)) return 'total'
  return 'bare'
}

function moneyFromLine(line: Line, next: Line | undefined): { minor: number; confidence: number } | null {
  // Prefer amount on the same line after the label
  const same = findMoneyInText(line.text, { labelled: true })
  if (same) return same
  // Amount often sits alone on the next line (thermal layout)
  if (next) {
    const n = findMoneyInText(next.text, { labelled: true })
    // Only take next-line if it is mostly a number
    if (n && /^[\s$€£S(]*[\d.,]+-?[\s)]*$/.test(next.text.trim())) return n
  }
  return null
}

/* ---------------------------------------------------------------------------
 * Date
 * ------------------------------------------------------------------------ */

function extractDate(
  lines: Line[],
  fullText: string,
  hints: ParseHints,
): FieldProvenance<string> | null {
  const dateHints: DateParseHints = {
    locale: hints.locale,
    dateOrder: hints.dateOrder,
  }

  // Prefer lines that look like date labels near the top half
  for (const line of lines.slice(0, Math.max(8, Math.ceil(lines.length * 0.5)))) {
    const labelled = line.text.match(
      /(?:date|datum|fecha|dated)\s*[:#]?\s*(.+)$/i,
    )
    if (labelled?.[1]) {
      const r = parseDate(labelled[1].trim(), dateHints) ?? findDateInText(labelled[1], dateHints)
      if (r) {
        return {
          value: r.civil,
          confidence: clamp01(r.confidence * 0.7 + line.conf * 0.3),
          bbox: line.bbox,
          pageId: null,
          pinned: false,
        }
      }
    }
    const r = findDateInText(line.text, dateHints)
    if (r) {
      return {
        value: r.civil,
        confidence: clamp01(r.confidence * 0.65 + line.conf * 0.25),
        bbox: line.bbox,
        pageId: null,
        pinned: false,
      }
    }
  }

  const fallback = findDateInText(fullText, dateHints)
  if (!fallback) return null
  return {
    value: fallback.civil,
    confidence: clamp01(fallback.confidence * 0.6),
    bbox: lines[0]?.bbox ?? null,
    pageId: null,
    pinned: false,
  }
}

/* ---------------------------------------------------------------------------
 * Vendor
 * ------------------------------------------------------------------------ */

/**
 * Does this look like a merchant name, or like OCR noise?
 *
 * When a scan is bad enough, Tesseract still returns text — it just returns
 * rubbish. A corpus run on a faded, speckled receipt produced the vendor
 * "FEAT a HL IRR Ls SE 1 Toe a desires", which the app would then have created as
 * a real vendor, polluting the list and attaching itself to a receipt forever.
 *
 * Emitting nothing is strictly better: the field shows as missing, the Inbox asks
 * the user, and the vendor list stays clean. These thresholds reject noise, not
 * unusual names — real merchants are short, mostly letters, and do not consist of
 * a dozen one-character tokens.
 */
function looksLikeVendorName(raw: string): boolean {
  const s = raw.trim()
  if (s.length < 2 || s.length > 60) return false

  const letters = (s.match(/\p{L}/gu) ?? []).length
  // At least a few real letters: "#1188" alone is not a merchant.
  if (letters < 3) return false

  // Ratio counts DIGITS as legitimate content, not just letters. Requiring
  // letters alone rejected "BEST BUY #1188" — a perfectly normal receipt header
  // where the store number is over a third of the string. Punctuation soup like
  // ". Lo - Le" still fails this.
  const alnum = (s.match(/[\p{L}\p{N}]/gu) ?? []).length
  if (alnum / s.length < 0.6) return false

  const tokens = s.split(/\s+/).filter(Boolean)
  if (tokens.length > 8) return false
  // Garbled OCR fragments into many one-character tokens; real names do not.
  const singles = tokens.filter((t) => t.replace(/[^\p{L}\p{N}]/gu, '').length <= 1).length
  if (tokens.length >= 4 && singles / tokens.length > 0.35) return false

  // A name that is one long unbroken run of mixed case is usually noise.
  if (tokens.length === 1 && s.length > 24) return false
  return true
}

function extractVendor(
  lines: Line[],
  knownVendors: string[],
): FieldProvenance<string> | null {
  const top = lines.slice(0, 6)
  if (!top.length) return null

  // Known vendor list first (case-insensitive substring / OCR-tolerant)
  if (knownVendors.length) {
    const blob = top.map((l) => l.text).join(' ')
    let best: { name: string; line: Line; score: number } | null = null
    for (const name of knownVendors) {
      for (const line of top) {
        if (vendorMatches(name, line.text) || vendorMatches(name, blob)) {
          const score = name.length
          if (!best || score > best.score) best = { name, line, score }
        }
      }
    }
    if (best) {
      return {
        value: best.name,
        confidence: clamp01(0.85 + best.line.conf * 0.1),
        bbox: best.line.bbox,
        pageId: null,
        pinned: false,
      }
    }
  }

  // Fall back to the topmost substantial text block (not a date, phone, or pure number)
  for (const line of top) {
    const t = line.text.trim()
    if (t.length < 2) continue
    if (/^\d+[-/.]\d+/.test(t)) continue
    if (/^[\d\s.()-]+$/.test(t)) continue
    if (/^(tel|phone|fax|www\.|http)/i.test(t)) continue
    if (/receipt|invoice|order\s*#/i.test(t) && t.length < 20) continue
    return {
      value: cleanVendorName(t),
      confidence: clamp01(0.55 + line.conf * 0.25),
      bbox: line.bbox,
      pageId: null,
      pinned: false,
    }
  }
  return null
}

function cleanVendorName(t: string): string {
  return t.replace(/\s{2,}/g, ' ').trim()
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** OCR-tolerant vendor match: 0↔O, 1↔I/l, etc. */
function vendorMatches(known: string, haystack: string): boolean {
  const re = new RegExp(escapeRe(known), 'i')
  if (re.test(haystack)) return true
  const normKnown = ocrNormalize(known)
  const normHay = ocrNormalize(haystack)
  if (normHay.includes(normKnown)) return true
  // Token: first word of known appears as prefix of a token in haystack
  const first = normKnown.split(/\s+/)[0] ?? ''
  if (first.length >= 4 && normHay.includes(first)) return true
  return false
}

function ocrNormalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/5/g, 's')
    .replace(/\$/g, 's')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/* ---------------------------------------------------------------------------
 * Tax lines — GST/HST/PST/VAT/Sales Tax
 * Value carries per-label rows for Lane A → receipt_tax_line.
 * ------------------------------------------------------------------------ */

function extractTax(lines: Line[]): FieldProvenance<TaxTotalValue> | null {
  // mwst/ust (de), tva (fr), iva (es/it), btw (nl), moms (dk/se), alv (fi) all mean
  // the same thing as VAT. Without them a European receipt reports no tax at all.
  const taxRe =
    /\b((?:sales\s*)?tax|gst|hst|pst|vat|qst|tvq|tps|mwst|m\.?w\.?st|ust|tva|iva|btw|moms|alv)(?:\s*(?:\d+(?:\.\d+)?\s*%)?)?\b/i
  const linesOut: TaxLineValue[] = []
  let bbox: BBox | null = null
  let confAcc = 0
  let confN = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/\bsub\s*total\b|\bsubtotal\b|\btotal\b/i.test(line.text) && !taxRe.test(line.text)) {
      continue
    }
    const m = line.text.match(taxRe)
    if (!m) continue
    // Skip "tax category" noise without amounts
    const money = moneyFromLine(line, lines[i + 1])
    if (!money) continue
    // Don't treat TOTAL tax of 0 as the order total line
    const label = normalizeTaxLabel(m[1] ?? 'TAX')
    // Avoid duplicate identical labels+amounts
    if (linesOut.some((l) => l.label === label && l.amountMinor === money.minor)) continue
    linesOut.push({ label, amountMinor: asMinor(money.minor) })
    bbox = bbox ? unionBBox([bbox, line.bbox]) : line.bbox
    confAcc += line.conf * 0.4 + money.confidence * 0.6
    confN++
  }

  if (!linesOut.length) return null
  const totalMinor = asMinor(linesOut.reduce((s, l) => s + l.amountMinor, 0))
  return {
    value: { totalMinor, lines: linesOut },
    confidence: clamp01(confAcc / confN),
    bbox,
    pageId: null,
    pinned: false,
  }
}

function normalizeTaxLabel(raw: string): string {
  const u = raw.replace(/\s+/g, ' ').trim().toUpperCase()
  if (/SALES\s*TAX/.test(u) || u === 'TAX') return 'TAX'
  if (u === 'GST' || u === 'TPS') return 'GST'
  if (u === 'HST') return 'HST'
  if (u === 'PST' || u === 'TVQ' || u === 'QST') return u === 'TVQ' || u === 'QST' ? 'QST' : 'PST'
  if (u === 'VAT') return 'VAT'
  // Fold the regional names onto VAT so a tax-category report does not split the
  // same tax across four labels.
  if (/^(?:MWST|M\.W\.ST|UST|TVA|IVA|BTW|MOMS|ALV)$/.test(u.replace(/\s+/g, ''))) return 'VAT'
  return u
}

/* ---------------------------------------------------------------------------
 * Payment type
 * ------------------------------------------------------------------------ */

function extractPayment(
  lines: Line[],
  fullText: string,
): FieldProvenance<string> | null {
  // Order matters: more specific card brands before generic CHECK/CASH.
  // Avoid matching "Guest check" / "Check #" as payment CHECK.
  // One canonical name per method. "MC" and "MASTERCARD" appearing as two entries
  // in the payment-type list is how a lookup list turns into junk, and a corpus
  // run showed exactly that — the same card reported under an abbreviation the
  // seeded list did not contain.
  const patterns: Array<{ re: RegExp; name: string; keepMatch?: boolean }> = [
    { re: /\bamerican\s*express\b|\bamex\b/i, name: 'AMEX' },
    { re: /\bmaster\s*card\b|\bmastercard\b|\bmc\b(?![a-z])/i, name: 'MASTERCARD' },
    { re: /\bvisa\b/i, name: 'VISA' },
    { re: /\bdiscover\b/i, name: 'DISCOVER' },
    // Regional debit networks. Each is its own method, not a flavour of DEBIT:
    // they settle differently and users reconcile them separately.
    { re: /\binterac\b/i, name: 'INTERAC' },
    { re: /\bgirocard\b|\bec[-\s]?karte\b/i, name: 'GIROCARD' },
    { re: /\bmaestro\b/i, name: 'MAESTRO' },
    { re: /\bideal\b/i, name: 'IDEAL' },
    { re: /\bbacs\b|\bfaster\s*payments?\b/i, name: 'BANK TRANSFER' },
    { re: /\bapple\s*pay\b/i, name: 'APPLE PAY' },
    { re: /\bgoogle\s*pay\b|\bg\s*pay\b/i, name: 'GOOGLE PAY' },
    { re: /\bpaypal\b/i, name: 'PAYPAL' },
    { re: /\bdebit\b/i, name: 'DEBIT' },
    { re: /\bcredit\s*card\b/i, name: 'CREDIT CARD' },
    // Invoice terms are a payment method on a B2B receipt: nothing was tendered
    // at the counter, and the user still needs to know how it settles.
    // Keep the day count: NET 30 and NET 60 are different obligations, and
    // collapsing both to 'NET TERMS' throws away the only part that matters.
    { re: /\bnet\s*\d{1,3}\b/i, name: 'NET', keepMatch: true },
    { re: /\bterms?\s*:\s*net\b/i, name: 'NET TERMS' },
    { re: /\bon\s*account\b|\bcharge\s*account\b/i, name: 'ON ACCOUNT' },
    { re: /^\s*cash\b|\bpaid\s+cash\b|\bcash\s*[:$]|\bcash\s+tend/i, name: 'CASH' },
    { re: /^\s*check\b|\bcheque\b|\bpaid\s+by\s+check\b|\bpayment\s*:\s*check\b/i, name: 'CHECK' },
  ]

  for (const line of lines) {
    for (const p of patterns) {
      if (p.re.test(line.text)) {
        const tail = line.text.match(/(?:\*{2,}|\bx{2,}|\bX{2,}|\b•{2,}|\b·+\s*)(\d{3,5})\b/)
          ?? fullText.match(/(?:\*{4,}|\bx{4,})\s*(\d{3,5})\b/i)
        // keepMatch preserves the matched text (normalised), so "Terms: net 30"
        // becomes "NET 30" rather than a generic label.
        const matched = p.keepMatch ? (line.text.match(p.re)?.[0] ?? p.name) : null
        const base = matched ? matched.replace(/\s+/g, ' ').trim().toUpperCase() : p.name
        const value = tail?.[1] ? `${base} ****${tail[1]}` : base
        return {
          value,
          confidence: clamp01(0.75 + line.conf * 0.2),
          bbox: line.bbox,
          pageId: null,
          pinned: false,
        }
      }
    }
  }
  // Last-resort CASH on a line that is exactly "CASH"
  for (const line of lines) {
    if (/^\s*cash\s*$/i.test(line.text)) {
      return {
        value: 'CASH',
        confidence: clamp01(0.7 + line.conf * 0.2),
        bbox: line.bbox,
        pageId: null,
        pinned: false,
      }
    }
  }
  return null
}

/* ---------------------------------------------------------------------------
 * External ref — invoice / receipt / order number
 * ------------------------------------------------------------------------ */

function extractExternalRef(
  lines: Line[],
  fullText: string,
): FieldProvenance<string> | null {
  const re =
    /(?:invoice|receipt|order|trans(?:action)?|ref(?:erence)?|ticket|auth)\s*(?:no|num|number|#|id)?\s*[:#.]?\s*([A-Z0-9][-A-Z0-9]{2,})/i

  for (const line of lines) {
    const m = line.text.match(re)
    if (m?.[1]) {
      return {
        value: m[1],
        confidence: clamp01(0.7 + line.conf * 0.2),
        bbox: line.bbox,
        pageId: null,
        pinned: false,
      }
    }
  }
  const m = fullText.match(re)
  if (m?.[1]) {
    return {
      value: m[1],
      confidence: 0.55,
      bbox: lines[0]?.bbox ?? null,
      pageId: null,
      pinned: false,
    }
  }
  return null
}

/* ---------------------------------------------------------------------------
 * Description — line-item-ish text, excluding headers/totals
 * ------------------------------------------------------------------------ */

function extractDescription(lines: Line[]): FieldProvenance<string> | null {
  if (lines.length < 2) return null
  const skip =
    /^(?:total|subtotal|sub\s*total|tax|gst|hst|pst|vat|tip|cash|change|visa|mastercard|amex|debit|thank|www\.|http|tel|phone|date|receipt|invoice)/i

  const items: string[] = []
  // Skip first line (vendor) and bottom summary region
  const start = 1
  const end = Math.max(start, lines.length - 4)
  for (let i = start; i < end; i++) {
    const t = lines[i]!.text.trim()
    if (!t || t.length < 2) continue
    if (skip.test(t)) continue
    if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(t)) continue
    if (findMoneyInText(t) && /^(?:total|tax|tip|amount)/i.test(t)) continue
    items.push(t)
  }
  if (!items.length) return null
  const value = items.join('; ').slice(0, 500)
  return {
    value,
    confidence: 0.45,
    bbox: lines[start]?.bbox ?? null,
    pageId: null,
    pinned: false,
  }
}

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

/** Build a synthetic OcrResult from plain text — for pure parser fixtures. */
export function ocrFromText(text: string, engine = 'fixture'): OcrResult {
  return {
    text,
    words: [],
    confidence: 0.85,
    engine,
    generation: 1,
    msElapsed: 0,
  }
}
