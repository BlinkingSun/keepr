/**
 * Parse user-entered money text into integer minor units at the repository boundary.
 * Never store floats. "84.37" -> 8437.
 */

export type MoneyParse =
  | { ok: true; minor: number }
  | { ok: false; error: string }

/**
 * Accept common user/grid forms: "84.37", "$84.37", "1,234.56", "-12.50", "84".
 * Whole numbers are dollars (major units). More than two fractional digits are
 * rejected rather than silently rounded — silent money rounding is a bug.
 */
export function parseMoneyText(text: string | null | undefined): MoneyParse {
  if (text === null || text === undefined) {
    return { ok: true, minor: 0 } // caller decides null vs zero; this path is for empty clear
  }
  let s = String(text).trim()
  if (s === '') {
    return { ok: false, error: 'amount is empty' }
  }

  // Strip currency symbols and surrounding whitespace/nbsp.
  s = s.replace(/[\s\u00a0]/g, '').replace(/[$€£¥]/g, '')

  // Accounting negatives: (84.37)
  let negative = false
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true
    s = s.slice(1, -1)
  }
  if (s.startsWith('+')) s = s.slice(1)
  if (s.startsWith('-')) {
    negative = !negative
    s = s.slice(1)
  }

  // Thousands separators: 1,234.56
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    s = s.replace(/,/g, '')
  }

  // Strict: digits, optional single decimal point, at most 2 fractional digits.
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    return { ok: false, error: `invalid amount: ${text}` }
  }

  const dot = s.indexOf('.')
  let major: string
  let frac: string
  if (dot === -1) {
    major = s
    frac = '00'
  } else {
    major = s.slice(0, dot)
    frac = s.slice(dot + 1).padEnd(2, '0')
  }

  // Avoid float: compose integer cents from digit strings.
  const majorN = Number(major)
  const fracN = Number(frac)
  if (!Number.isSafeInteger(majorN) || !Number.isInteger(fracN)) {
    return { ok: false, error: `amount out of range: ${text}` }
  }
  const abs = majorN * 100 + fracN
  if (!Number.isSafeInteger(abs)) {
    return { ok: false, error: `amount out of range: ${text}` }
  }
  return { ok: true, minor: negative ? -abs : abs }
}

/** Null-clearing variant used by patch: null/empty clears the field. */
export function parseMoneyField(
  text: string | null | undefined,
): MoneyParse | { ok: true; minor: null } {
  if (text === null || text === undefined) return { ok: true, minor: null }
  if (String(text).trim() === '') return { ok: true, minor: null }
  return parseMoneyText(text)
}
