/**
 * Parse SplitPart.amountText into integer minor units.
 * Self-contained so this lane does not depend on repo internals.
 *
 * Accepts: "84.37", "$84.37", "1,234.56", "-12.50", "84".
 * Whole numbers are major units. More than two fractional digits are rejected.
 */

export type AmountParse =
  | { ok: true; minor: number }
  | { ok: false; error: string }

export function parseAmountText(text: string | null | undefined): AmountParse {
  if (text === null || text === undefined) {
    return { ok: false, error: 'amount is empty' }
  }
  let s = String(text).trim()
  if (s === '') {
    return { ok: false, error: 'amount is empty' }
  }

  s = s.replace(/[\s\u00a0]/g, '').replace(/[$€£¥]/g, '')

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

  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    s = s.replace(/,/g, '')
  }

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
