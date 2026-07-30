/**
 * Pure civil-date parsing for receipt OCR text.
 * Returns YYYY-MM-DD with honest confidence. Ambiguous day/month pairs
 * resolve by locale hint and always drop confidence — never silently guess
 * with high confidence (a wrong date the user will not re-check).
 */

export type DateOrder = 'MDY' | 'DMY' | 'YMD'

export interface DateParseResult {
  /** Civil date YYYY-MM-DD */
  civil: string
  /** 0..1 */
  confidence: number
  /** True when day/month could swap under a different locale. */
  ambiguous: boolean
}

export interface DateParseHints {
  /** Preferred order for numeric dates. Default MDY (US). */
  dateOrder?: DateOrder
  /** BCP-47-ish locale; en-GB / de / fr → DMY, en-US → MDY, ja/zh → YMD. */
  locale?: string
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
}

export function resolveDateOrder(hints: DateParseHints = {}): DateOrder {
  if (hints.dateOrder) return hints.dateOrder
  const loc = (hints.locale ?? '').toLowerCase()
  if (!loc) return 'MDY'
  if (/^(en-us|en-ca|en_us|en_ca)/.test(loc)) return 'MDY'
  if (/^(ja|zh|ko|yue)/.test(loc)) return 'YMD'
  if (/^(en-gb|en-au|en-nz|en-ie|en_gb|de|fr|es|it|pt|nl|pl|sv|da|nb|fi|ru)/.test(loc)) {
    return 'DMY'
  }
  // bare "en" — prefer MDY
  if (loc === 'en' || loc.startsWith('en-') || loc.startsWith('en_')) return 'MDY'
  return 'MDY'
}

/**
 * Parse a date-like string into a civil date.
 * Returns null if nothing valid — omit the field rather than invent today.
 */
export function parseDate(raw: string, hints: DateParseHints = {}): DateParseResult | null {
  if (raw == null || typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s) return null

  // ISO first: 2026-07-30 or 2026/07/30
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (iso) {
    const y = Number(iso[1])
    const mo = Number(iso[2])
    const d = Number(iso[3])
    const civil = makeCivil(y, mo, d)
    if (!civil) return null
    return { civil, confidence: 0.98, ambiguous: false }
  }

  // Named month: 30 Jul 2026 / Jul 30, 2026 / 30-July-2026
  const named = tryNamedMonth(s)
  if (named) return named

  // Numeric: 03/04/2026, 3-4-26, 03.04.2026
  const num = s.match(/^(\d{1,4})[-/.\s]+(\d{1,2})[-/.\s]+(\d{1,4})$/)
  if (num) {
    return parseNumericTriple(num[1]!, num[2]!, num[3]!, hints)
  }

  return null
}

/**
 * Scan free text for the best date candidate.
 */
export function findDateInText(text: string, hints: DateParseHints = {}): DateParseResult | null {
  if (!text) return null
  const candidates: DateParseResult[] = []

  // ISO
  for (const m of text.matchAll(/\b(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\b/g)) {
    const r = parseDate(m[1]!, hints)
    if (r) candidates.push(r)
  }

  // Named month phrases
  const namedRe =
    /\b(?:(?:\d{1,2})(?:st|nd|rd|th)?[\s,/-]+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[\s,/-]+\d{2,4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[\s,/-]+\d{1,2}(?:st|nd|rd|th)?[\s,/-]+\d{2,4})\b/gi
  for (const m of text.matchAll(namedRe)) {
    const r = parseDate(m[0]!, hints)
    if (r) candidates.push(r)
  }

  // Numeric d/m/y
  for (const m of text.matchAll(/\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/g)) {
    const r = parseDate(m[1]!, hints)
    if (r) candidates.push(r)
  }

  if (!candidates.length) return null
  // Prefer higher confidence, then non-ambiguous
  candidates.sort((a, b) => b.confidence - a.confidence || (a.ambiguous === b.ambiguous ? 0 : a.ambiguous ? 1 : -1))
  return candidates[0] ?? null
}

function tryNamedMonth(s: string): DateParseResult | null {
  const cleaned = s.replace(/,/g, ' ').replace(/\s+/g, ' ').trim()

  // 30 Jul 2026 / 30th July 2026
  let m = cleaned.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{2,4})$/)
  if (m) {
    const d = Number(m[1])
    const mo = MONTHS[(m[2] ?? '').toLowerCase()]
    const y = expandYear(Number(m[3]))
    if (mo == null) return null
    const civil = makeCivil(y, mo, d)
    if (!civil) return null
    return { civil, confidence: 0.95, ambiguous: false }
  }

  // Jul 30 2026 / July 30, 2026
  m = cleaned.match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{2,4})$/)
  if (m) {
    const mo = MONTHS[(m[1] ?? '').toLowerCase()]
    const d = Number(m[2])
    const y = expandYear(Number(m[3]))
    if (mo == null) return null
    const civil = makeCivil(y, mo, d)
    if (!civil) return null
    return { civil, confidence: 0.95, ambiguous: false }
  }

  return null
}

function parseNumericTriple(
  a: string,
  b: string,
  c: string,
  hints: DateParseHints,
): DateParseResult | null {
  const order = resolveDateOrder(hints)
  const n1 = Number(a)
  const n2 = Number(b)
  const n3 = Number(c)

  // Year-first if first component is 4 digits or order is YMD
  if (a.length === 4 || (order === 'YMD' && n1 > 31)) {
    const y = expandYear(n1)
    const civil = makeCivil(y, n2, n3)
    if (!civil) return null
    return { civil, confidence: 0.9, ambiguous: false }
  }

  // Year-last
  const y = expandYear(n3)
  let day: number
  let month: number
  let ambiguous = false
  let confidence = 0.9

  if (order === 'MDY') {
    month = n1
    day = n2
  } else {
    // DMY
    day = n1
    month = n2
  }

  // Detect ambiguity: both components could be valid months (≤12) and days differ
  if (n1 <= 12 && n2 <= 12 && n1 !== n2) {
    ambiguous = true
    confidence = 0.55 // honest drop — do not silently guess
  } else if (n1 > 12 && n2 <= 12) {
    // Must be DMY regardless of hint
    day = n1
    month = n2
    confidence = 0.92
    ambiguous = false
  } else if (n2 > 12 && n1 <= 12) {
    // Must be MDY
    month = n1
    day = n2
    confidence = 0.92
    ambiguous = false
  }

  const civil = makeCivil(y, month, day)
  if (!civil) return null
  return { civil, confidence, ambiguous }
}

function expandYear(y: number): number {
  if (y >= 100) return y
  // Receipt years: 00–79 → 2000–2079, 80–99 → 1980–1999
  return y >= 80 ? 1900 + y : 2000 + y
}

function makeCivil(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  if (year < 1990 || year > 2100) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  // Validate calendar day
  const dim = daysInMonth(year, month)
  if (day > dim) return null
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}
