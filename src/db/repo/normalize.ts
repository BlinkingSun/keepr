/**
 * Vendor name normalization for dedupe.
 * "Home Depot", "HOME DEPOT", "Home Depot." → "home depot"
 */
export function normalizeVendorName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '') // strip punctuation
    .replace(/\s+/g, ' ')
    .trim()
}
