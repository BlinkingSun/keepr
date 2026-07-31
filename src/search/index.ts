/**
 * KeepR search — Lane H.
 *
 * Free text over OCR body (page_fts ∩ v_searchable_pages) and structured
 * fields (item_fts), plus every structured filter on SearchQuery.
 * Ranking: see ranking.ts — BM25 sides are normalised and fused explicitly.
 */

export { search } from './search.ts'
export { missingKeyData } from './missing.ts'
export {
  buildFtsMatch,
  requireFtsMatch,
  SearchQueryError,
} from './ftsQuery.ts'
export {
  fuseScore,
  normalizeBm25Side,
  W_FIELD,
  W_OCR,
  FIELD_BONUS,
} from './ranking.ts'
export type { Database, MissingKeyDataRow } from './types.ts'
