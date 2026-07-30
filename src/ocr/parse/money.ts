/**
 * Pure money parsing for receipt OCR text.
 * Returns integer minor units (cents). Never floats.
 *
 * Handles labelled amounts, US/EU separators, trailing minus, and common
 * OCR noise ($→S, lost decimal). Returns null when nothing parseable —
 * callers must omit the field rather than invent 0.
 */

export interface MoneyParseResult {
  /** Integer minor units. Negative for refunds / trailing-minus. */
  minor: number
  /** 0..1 — how sure we are of the pattern (not OCR confidence). */
  confidence: number
}

/**
 * Parse a money-like token or short phrase into minor units.
 * Examples: "1,234.56", "1.234,56", "$84.37", "84.37-", "84,37", "8437", "S4.37"
 */
export function parseMoney(raw: string): MoneyParseResult | null {
  if (raw == null || typeof raw !== 'string') return null
  let s = raw.trim()
  if (!s) return null

  // Unicode minus variants → ASCII hyphen
  s = s.replace(/[−–—]/g, '-')

  // Strip currency words/symbols; keep digits, separators, sign.
  s = s
    .replace(/[€£¥₹]/g, '')
    .replace(/\b(?:USD|CAD|EUR|GBP|AUD|NZD)\b/gi, '')
    .replace(/S(?=\d)/g, '') // OCR: S4.37 → 4.37 (misread $)
    .replace(/\$/g, '')
    .trim()

  // Trailing minus (accounting style): 84.37-
  let negative = false
  if (/^-/.test(s)) {
    negative = true
    s = s.slice(1).trim()
  } else if (/-\s*$/.test(s)) {
    negative = true
    s = s.replace(/-\s*$/, '').trim()
  } else if (/^\(.*\)$/.test(s)) {
    // (84.37) accounting negative
    negative = true
    s = s.slice(1, -1).trim()
  } else if (/\(.*\d.*\)/.test(s)) {
    // embedded (12.50)
    negative = true
    s = s.replace(/[()]/g, '').trim()
  }

  // Parenthetical refund markers already handled; strip leftover currency junk.
  s = s.replace(/[^\d.,]/g, '')
  if (!s || !/\d/.test(s)) return null

  const parsed = parseAmountToken(s)
  if (parsed == null) return null

  const minor = negative ? -parsed.minor : parsed.minor
  return { minor, confidence: parsed.confidence }
}

/**
 * Scan free text for the first money-like amount (used when amount follows a label).
 */
export function findMoneyInText(text: string): MoneyParseResult | null {
  if (!text) return null
  // Prefer tokens that look like currency amounts.
  // Leading minus/paren for refunds; trailing minus for accounting style.
  const re =
    /[(]?[-−–—]?\s*[$€£S]?\s*(?:\d{1,3}(?:[.,]\d{3})+[.,]\d{2}|\d+[.,]\d{2}|\d{1,3}(?:[.,]\d{3})+|\d+)\s*[-−–—)]?/g
  let best: MoneyParseResult | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const raw = (m[0] ?? '').trim()
    // Skip bare tiny integers that are likely quantities (e.g. "x3") when
    // a better decimal candidate may still appear — handled by confidence.
    const r = parseMoney(raw)
    if (!r) continue
    // Prefer higher-confidence (has decimal) over bare integers.
    // Prefer more negative? No — prefer higher conf, then larger abs with sign preserved.
    if (!best || r.confidence > best.confidence) best = r
    else if (best && r.confidence === best.confidence && Math.abs(r.minor) > Math.abs(best.minor)) {
      best = r
    }
  }
  // Also try whole-string parse for "TOTAL -54.11" style (minus after label)
  const whole = parseMoney(text.replace(/^[A-Za-z\s#:.*]+/u, '').trim())
  if (whole && (!best || whole.confidence >= best.confidence)) {
    // Prefer signed whole-line parse when it carries a negative and token scan missed it
    if (whole.minor < 0 || !best) best = whole
    else if (whole.minor === best.minor) best = whole
  }
  return best
}

function parseAmountToken(s: string): MoneyParseResult | null {
  const hasComma = s.includes(',')
  const hasDot = s.includes('.')

  // Both separators: last one is decimal (US 1,234.56 / EU 1.234,56)
  if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(',')
    const lastDot = s.lastIndexOf('.')
    if (lastDot > lastComma) {
      // US: 1,234.56
      const whole = s.slice(0, lastDot).replace(/,/g, '')
      const frac = s.slice(lastDot + 1)
      return fromParts(whole, frac, 0.95)
    }
    // EU: 1.234,56
    const whole = s.slice(0, lastComma).replace(/\./g, '')
    const frac = s.slice(lastComma + 1)
    return fromParts(whole, frac, 0.95)
  }

  if (hasComma && !hasDot) {
    // "84,37" EU decimal OR "1,234" thousands
    const parts = s.split(',')
    const last = parts[parts.length - 1] ?? ''
    if (parts.length === 2 && last.length === 2 && /^\d+$/.test(last)) {
      // decimal comma
      return fromParts(parts[0] ?? '', last, 0.85)
    }
    if (parts.length === 2 && last.length === 3 && /^\d+$/.test(last) && (parts[0] ?? '').length <= 3) {
      // 1,234 thousands → whole dollars
      const whole = s.replace(/,/g, '')
      return fromParts(whole, '00', 0.7)
    }
    // Multi-group thousands: 1,234,567
    if (parts.every((p, i) => (i === 0 ? /^\d{1,3}$/.test(p) : /^\d{3}$/.test(p)))) {
      return fromParts(s.replace(/,/g, ''), '00', 0.75)
    }
    // Fallback: last 2 digits as cents if exactly 2 after last comma
    if (last.length === 2) {
      const whole = parts.slice(0, -1).join('')
      return fromParts(whole, last, 0.7)
    }
    return fromParts(s.replace(/,/g, ''), '00', 0.55)
  }

  if (hasDot && !hasComma) {
    const parts = s.split('.')
    const last = parts[parts.length - 1] ?? ''
    if (parts.length === 2 && last.length === 2 && /^\d+$/.test(last)) {
      return fromParts(parts[0] ?? '', last, 0.95)
    }
    if (parts.length === 2 && last.length === 3 && /^\d+$/.test(last) && (parts[0] ?? '').length <= 3) {
      // EU thousands with dot only: 1.234
      return fromParts(s.replace(/\./g, ''), '00', 0.7)
    }
    if (parts.every((p, i) => (i === 0 ? /^\d{1,3}$/.test(p) : /^\d{3}$/.test(p)))) {
      return fromParts(s.replace(/\./g, ''), '00', 0.75)
    }
    if (last.length === 2) {
      const whole = parts.slice(0, -1).join('')
      return fromParts(whole, last, 0.7)
    }
    // Single digit after decimal: 84.3 → 8430? treat as tenths
    if (parts.length === 2 && last.length === 1 && /^\d+$/.test(last)) {
      return fromParts(parts[0] ?? '', last + '0', 0.6)
    }
    return fromParts(s.replace(/\./g, ''), '00', 0.55)
  }

  // Digits only — OCR often drops the decimal: "8437" means $84.37
  if (/^\d+$/.test(s)) {
    if (s.length >= 3) {
      // Interpret last two digits as cents (high prior for receipt totals)
      const whole = s.slice(0, -2)
      const frac = s.slice(-2)
      return fromParts(whole === '' ? '0' : whole, frac, 0.55)
    }
    // 1–2 digit bare integer: whole dollars
    return fromParts(s, '00', 0.4)
  }

  return null
}

function fromParts(whole: string, frac: string, confidence: number): MoneyParseResult | null {
  if (!/^\d+$/.test(whole) || !/^\d+$/.test(frac)) return null
  // Normalize fractional to exactly 2 digits
  let f = frac
  if (f.length === 0) f = '00'
  else if (f.length === 1) f = f + '0'
  else if (f.length > 2) {
    // More than 2 decimal places — reject rather than invent
    return null
  }
  const major = Number(whole)
  const cents = Number(f)
  if (!Number.isFinite(major) || !Number.isFinite(cents)) return null
  const minor = major * 100 + cents
  if (!Number.isInteger(minor)) return null
  return { minor, confidence }
}
