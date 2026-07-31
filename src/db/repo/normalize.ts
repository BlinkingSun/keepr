/**
 * Vendor name normalization for dedupe and rule matching.
 *
 * Receipts print the same merchant a dozen ways, and every variant that fails to
 * match creates a duplicate vendor — which then misses its default category, so
 * the receipt lands uncategorised and the vendor list fills with near-identical
 * junk. Found by an end-to-end run: OCR read "HOME DEPOT #4821", the old
 * normalizer produced "home depot 4821", that did not match the seeded
 * "home depot", so a new vendor was created and the category rule never fired.
 * Every unit test passed at the time.
 *
 * The hard part is not stripping too much. Numbers are load-bearing in plenty of
 * real names — 7-Eleven, 76, 99 Ranch Market — so this removes only numbers that
 * are clearly store or location identifiers, and never touches a leading number.
 */

/** STORE #123 / STR 4821 / LOC# 9 / NO. 55 / UNIT 7 — explicit outlet markers. */
const OUTLET_MARKER = /\b(?:store|str|stor|loc|location|shop|unit|branch|site|no)\b\.?\s*#?\s*\d+/gi

/** A bare #1234 anywhere. */
const HASH_NUMBER = /#\s*\d+/g

/** Legal suffixes that vary between a receipt header and a vendor list entry. */
const LEGAL_SUFFIX = /\b(?:inc|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|bv|srl|pty)\b\.?/gi

/**
 * A trailing run of 3+ digits, kept only when letters precede it.
 *
 * 3+ rather than any digits, because short numbers are often part of the brand
 * ("Chevron 76"). Requiring preceding letters means an all-numeric name like "76"
 * survives untouched.
 */
const TRAILING_STORE_NUMBER = /^(.*\p{L}.*?)\s+\d{3,}$/u

export function normalizeVendorName(name: string): string {
  let s = name.toLowerCase()

  s = s.replace(OUTLET_MARKER, ' ')
  s = s.replace(HASH_NUMBER, ' ')

  // Punctuation becomes a space, not nothing: "wal-mart" and "wal mart" must
  // agree, and deleting the hyphen outright gives "walmart" which matches neither.
  s = s.replace(/[^\p{L}\p{N}\s]/gu, ' ')

  s = s.replace(LEGAL_SUFFIX, ' ')
  s = s.replace(/\s+/g, ' ').trim()

  const m = TRAILING_STORE_NUMBER.exec(s)
  if (m?.[1]) s = m[1].trim()

  return s.replace(/\s+/g, ' ').trim()
}

/**
 * A looser key, used only as a SECOND pass when the normalized name misses.
 * Spaces removed, so "wal mart" and "walmart" collide. Deliberately separate:
 * using this as the primary key would merge merchants whose names genuinely
 * differ only by spacing.
 */
export function vendorMatchKey(name: string): string {
  return normalizeVendorName(name).replace(/\s+/g, '')
}
