/**
 * Format integer minor units for display only.
 * Never parse or store a float. Divide by 100 at the last moment.
 * Currency is per-call — never assume USD.
 */

const SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CAD: 'CA$',
  AUD: 'A$',
}

/**
 * Format minor units as a display string.
 * 8437, 'USD' → "$84.37"
 * -8437, 'USD' → "-$84.37"
 * null → "—"
 * 123456789, 'USD' → "$1,234,567.89"
 * 8437, 'EUR' → "€84.37"
 */
export function formatMoney(
  minor: number | null | undefined,
  currency = 'USD',
): string {
  if (minor == null) return '—'

  // Integer path only: floor division and remainder, never /100 as float display source.
  const neg = minor < 0
  const abs = Math.abs(minor)
  const major = Math.floor(abs / 100)
  const cents = abs % 100
  const majorStr = String(major).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const amount = `${majorStr}.${String(cents).padStart(2, '0')}`

  const code = (currency || 'USD').toUpperCase()
  const sym = SYMBOLS[code] ?? (code ? `${code} ` : '')

  return `${neg ? '-' : ''}${sym}${amount}`
}
