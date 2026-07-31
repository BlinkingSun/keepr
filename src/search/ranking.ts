/**
 * Ranking fusion for dual-index FTS search.
 *
 * BM25 scores from `page_fts` and `item_fts` are NOT commensurate: the two
 * indexes have different column sets, document lengths, and term statistics.
 * You cannot UNION the raw ranks and ORDER BY them.
 *
 * Formula (documented, intentional — not accidental SQL ORDER BY):
 *
 *   1. Per index, collapse multi-row hits to one BM25 per item_id
 *      (page_fts: MIN(bm25) across pages of the same item; lower BM25 is better).
 *
 *   2. Min-max normalise each index's BM25 values independently into [0, 1]
 *      where 1 = best match on that side:
 *        norm(s) = 1                              if only one score on that side
 *        norm(s) = (maxS - s) / (maxS - minS)     otherwise
 *      (BM25 from SQLite FTS5 is typically ≤ 0; lower/more-negative is better.)
 *
 *   3. Fuse with an explicit field bias so structured field hits outrank a
 *      single incidental OCR occurrence of the same token:
 *        score = W_FIELD * fieldNorm + W_OCR * ocrNorm + FIELD_BONUS
 *      where fieldNorm/ocrNorm are 0 when that side did not match, and
 *        FIELD_BONUS = B if the item matched item_fts, else 0.
 *
 *   Constants: W_FIELD = 1.0, W_OCR = 0.35, B = 1.0
 *   → a pure field hit scores ≥ 1.0; a pure OCR hit scores ≤ 0.35.
 */

export const W_FIELD = 1.0
export const W_OCR = 0.35
export const FIELD_BONUS = 1.0

/** Lower BM25 is better. Map a side's raw BM25 map → higher-is-better norms in [0,1]. */
export function normalizeBm25Side(rawByItem: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>()
  if (rawByItem.size === 0) return out
  if (rawByItem.size === 1) {
    for (const id of rawByItem.keys()) out.set(id, 1)
    return out
  }
  let minS = Infinity
  let maxS = -Infinity
  for (const s of rawByItem.values()) {
    if (s < minS) minS = s
    if (s > maxS) maxS = s
  }
  const span = maxS - minS
  if (span === 0) {
    for (const id of rawByItem.keys()) out.set(id, 1)
    return out
  }
  for (const [id, s] of rawByItem) {
    out.set(id, (maxS - s) / span)
  }
  return out
}

export function fuseScore(fieldNorm: number, ocrNorm: number, matchedFields: boolean): number {
  const bonus = matchedFields ? FIELD_BONUS : 0
  return W_FIELD * fieldNorm + W_OCR * ocrNorm + bonus
}
