/**
 * Display conversion for money at the export cell boundary only.
 * Storage and arithmetic stay in integer minor units forever.
 */

/**
 * CSV/spreadsheet decimal: no currency symbol, no thousands separator.
 * 8437 → "84.37", -2500 → "-25.00". Spreadsheets parse this as a number.
 */
export function minorToPlainDecimal(minor: number): string {
  if (!Number.isInteger(minor)) {
    throw new RangeError(`money must be integer minor units, got ${minor}`)
  }
  const neg = minor < 0
  const abs = Math.abs(minor)
  const major = Math.floor(abs / 100)
  const cents = abs % 100
  return `${neg ? '-' : ''}${major}.${String(cents).padStart(2, '0')}`
}

/**
 * Excel cell number: still derived from integer minor units at the last moment.
 * Never accumulate floats from money; only convert once for the cell value.
 */
export function minorToNumber(minor: number): number {
  if (!Number.isInteger(minor)) {
    throw new RangeError(`money must be integer minor units, got ${minor}`)
  }
  // Integer path: sign * (major + cents/100) without intermediate float money sums.
  const neg = minor < 0
  const abs = Math.abs(minor)
  const major = Math.floor(abs / 100)
  const cents = abs % 100
  const n = major + cents / 100
  return neg ? -n : n
}
