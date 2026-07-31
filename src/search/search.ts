import type {
  ExtractableField,
  ItemType,
  SearchHit,
  SearchQuery,
  SearchResult,
} from '../shared/types.ts'
import { requireFtsMatch, SearchQueryError } from './ftsQuery.ts'
import { fuseScore, normalizeBm25Side } from './ranking.ts'
import type { Database } from './types.ts'

const DEFAULT_LIMIT = 50

/** Map SearchQuery.missing / ExtractableField → v_missing_key_data columns. */
const MISSING_COL: Partial<Record<ExtractableField, string>> = {
  vendor: 'missing_vendor',
  txnDate: 'missing_date',
  total: 'missing_total',
  category: 'missing_category',
  taxCategory: 'missing_tax_category',
}

interface ItemMeta {
  itemId: number
  type: ItemType
  folderId: number
}

interface FusedCandidate {
  itemId: number
  score: number
  matchedIn: { ocrText: boolean; fields: boolean }
  snippet: string | null
}

/**
 * Free-text + structured search over the KeepR library.
 *
 * Pages are always read through `v_searchable_pages` (or an explicit include-
 * trashed join) — never `page_fts` alone. Field and OCR BM25 scores are
 * normalised per side and fused; see ranking.ts for the formula.
 */
export function search(db: Database, q: SearchQuery = {}): SearchResult {
  const limit = q.limit ?? DEFAULT_LIMIT
  const offset = q.offset ?? 0

  let ftsMatch = ''
  if (q.q !== undefined && q.q !== null && q.q.trim() !== '') {
    try {
      ftsMatch = requireFtsMatch(q.q)
    } catch (e) {
      // Clean error for leading wildcards; never surface raw FTS exceptions.
      if (e instanceof SearchQueryError) throw e
      throw new SearchQueryError(
        e instanceof Error ? e.message : 'Invalid search query',
      )
    }
  }

  // Structured-only path: no free text (or empty after sanitisation).
  if (!ftsMatch) {
    return structuredOnly(db, q, limit, offset)
  }

  const fieldRaw = queryFieldBm25(db, ftsMatch, q.includeTrashed === true)
  const { ocrRaw, snippets } = queryOcrBm25(db, ftsMatch, q.includeTrashed === true)

  const fieldNorm = normalizeBm25Side(fieldRaw)
  const ocrNorm = normalizeBm25Side(ocrRaw)

  const itemIds = new Set<number>([...fieldRaw.keys(), ...ocrRaw.keys()])
  const fused: FusedCandidate[] = []

  for (const itemId of itemIds) {
    const matchedFields = fieldRaw.has(itemId)
    const matchedOcr = ocrRaw.has(itemId)
    const fn = fieldNorm.get(itemId) ?? 0
    const on = ocrNorm.get(itemId) ?? 0
    fused.push({
      itemId,
      score: fuseScore(fn, on, matchedFields),
      matchedIn: { ocrText: matchedOcr, fields: matchedFields },
      snippet: snippets.get(itemId) ?? null,
    })
  }

  // Apply structured filters to the candidate item set.
  const filtered = applyStructuredFilters(db, fused, q)

  // Stable rank: score desc, then itemId asc.
  filtered.sort((a, b) => b.score - a.score || a.itemId - b.itemId)

  const total = filtered.length
  const page = filtered.slice(offset, offset + limit)
  const meta = loadItemMeta(db, page.map((c) => c.itemId))

  const hits: SearchHit[] = []
  for (const c of page) {
    const m = meta.get(c.itemId)
    if (!m) continue
    hits.push({
      itemId: c.itemId,
      type: m.type,
      folderId: m.folderId,
      score: c.score,
      matchedIn: c.matchedIn,
      snippet: c.snippet,
    })
  }

  return {
    hits,
    total,
    truncated: offset + hits.length < total,
  }
}

// ---------------------------------------------------------------------------
// FTS sides
// ---------------------------------------------------------------------------

function queryFieldBm25(
  db: Database,
  match: string,
  includeTrashed: boolean,
): Map<number, number> {
  // item_fts rowid = item.id. Still filter trash unless includeTrashed.
  const sql = includeTrashed
    ? `SELECT f.rowid AS item_id, bm25(item_fts) AS b
         FROM item_fts f
        WHERE item_fts MATCH ?`
    : `SELECT f.rowid AS item_id, bm25(item_fts) AS b
         FROM item_fts f
         JOIN item i ON i.id = f.rowid
        WHERE item_fts MATCH ?
          AND i.trashed_at IS NULL`

  const map = new Map<number, number>()
  try {
    const rows = db.prepare(sql).all(match) as Array<{ item_id: number; b: number }>
    for (const r of rows) {
      // One row per item in item_fts; keep the BM25 as-is.
      map.set(r.item_id, r.b)
    }
  } catch (e) {
    throw new SearchQueryError(
      e instanceof Error ? `Field search failed: ${e.message}` : 'Field search failed',
    )
  }
  return map
}

function queryOcrBm25(
  db: Database,
  match: string,
  includeTrashed: boolean,
): { ocrRaw: Map<number, number>; snippets: Map<number, string | null> } {
  // NEVER match page_fts alone for default search — join the trash gate.
  //
  // FTS5 forbids bm25()/snippet() inside aggregates or outer subqueries
  // ("unable to use function bm25 in the requested context"), so we fetch
  // one row per matching page and collapse to one item hit in JS:
  // best (minimum) BM25 wins; first non-null snippet is kept.
  const sql = includeTrashed
    ? `SELECT p.item_id AS item_id,
              bm25(page_fts) AS b,
              snippet(page_fts, 0, '', '', '…', 10) AS snip
         FROM page_fts f
         JOIN page p ON p.id = f.rowid
        WHERE page_fts MATCH ?`
    : `SELECT sp.item_id AS item_id,
              bm25(page_fts) AS b,
              snippet(page_fts, 0, '', '', '…', 10) AS snip
         FROM page_fts f
         JOIN v_searchable_pages sp ON sp.page_id = f.rowid
        WHERE page_fts MATCH ?`

  const ocrRaw = new Map<number, number>()
  const snippets = new Map<number, string | null>()
  try {
    const rows = db.prepare(sql).all(match) as Array<{
      item_id: number
      b: number
      snip: string | null
    }>
    for (const r of rows) {
      const prev = ocrRaw.get(r.item_id)
      // Lower BM25 is better — keep the best page score per item.
      if (prev === undefined || r.b < prev) {
        ocrRaw.set(r.item_id, r.b)
        if (r.snip != null) snippets.set(r.item_id, r.snip)
      } else if (!snippets.has(r.item_id) && r.snip != null) {
        snippets.set(r.item_id, r.snip)
      }
    }
  } catch (e) {
    throw new SearchQueryError(
      e instanceof Error ? `OCR search failed: ${e.message}` : 'OCR search failed',
    )
  }
  return { ocrRaw, snippets }
}

// ---------------------------------------------------------------------------
// Structured filters
// ---------------------------------------------------------------------------

function applyStructuredFilters(
  db: Database,
  candidates: FusedCandidate[],
  q: SearchQuery,
): FusedCandidate[] {
  if (candidates.length === 0) return candidates

  const { whereSql, params } = buildItemWhere(q, 'i')
  // Restrict to candidate ids.
  const ids = candidates.map((c) => c.itemId)
  const placeholders = ids.map(() => '?').join(',')
  const sql = `SELECT i.id AS item_id
                 FROM item i
                 LEFT JOIN receipt_data r ON r.item_id = i.id
                 LEFT JOIN v_missing_key_data mk ON mk.item_id = i.id
                WHERE i.id IN (${placeholders})
                  AND (${whereSql})`

  const allowed = new Set(
    (db.prepare(sql).all(...ids, ...params) as Array<{ item_id: number }>).map(
      (r) => r.item_id,
    ),
  )
  return candidates.filter((c) => allowed.has(c.itemId))
}

function structuredOnly(
  db: Database,
  q: SearchQuery,
  limit: number,
  offset: number,
): SearchResult {
  const { whereSql, params } = buildItemWhere(q, 'i')

  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS c
         FROM item i
         LEFT JOIN receipt_data r ON r.item_id = i.id
         LEFT JOIN v_missing_key_data mk ON mk.item_id = i.id
        WHERE ${whereSql}`,
    )
    .get(...params) as { c: number }

  const total = countRow.c
  const rows = db
    .prepare(
      `SELECT i.id AS item_id, i.type, i.folder_id
         FROM item i
         LEFT JOIN receipt_data r ON r.item_id = i.id
         LEFT JOIN v_missing_key_data mk ON mk.item_id = i.id
        WHERE ${whereSql}
        ORDER BY i.id ASC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Array<{
    item_id: number
    type: string
    folder_id: number
  }>

  const hits: SearchHit[] = rows.map((r) => ({
    itemId: r.item_id,
    type: r.type as ItemType,
    folderId: r.folder_id,
    score: 0,
    matchedIn: { ocrText: false, fields: false },
    snippet: null,
  }))

  return {
    hits,
    total,
    truncated: offset + hits.length < total,
  }
}

/**
 * WHERE clause over item i (+ optional receipt_data r, v_missing_key_data mk).
 * Default excludes trashed unless includeTrashed.
 */
function buildItemWhere(
  q: SearchQuery,
  itemAlias: string,
): { whereSql: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []
  const i = itemAlias

  if (q.includeTrashed) {
    // no trash gate
  } else {
    clauses.push(`${i}.trashed_at IS NULL`)
  }

  if (q.folderId !== undefined) {
    if (q.includeSubfolders) {
      clauses.push(
        `${i}.folder_id IN (
           WITH RECURSIVE tree(id) AS (
             SELECT id FROM folder WHERE id = ?
             UNION ALL
             SELECT f.id FROM folder f JOIN tree t ON f.parent_id = t.id
           )
           SELECT id FROM tree
         )`,
      )
      params.push(q.folderId)
    } else {
      clauses.push(`${i}.folder_id = ?`)
      params.push(q.folderId)
    }
  }

  if (q.type) {
    clauses.push(`${i}.type = ?`)
    params.push(q.type)
  }

  if (q.reviewed === true) {
    clauses.push(`${i}.reviewed_at IS NOT NULL`)
  } else if (q.reviewed === false) {
    clauses.push(`${i}.reviewed_at IS NULL`)
  }

  if (q.vendorId !== undefined) {
    clauses.push(`r.vendor_id = ?`)
    params.push(q.vendorId)
  }
  if (q.categoryId !== undefined) {
    clauses.push(`r.category_id = ?`)
    params.push(q.categoryId)
  }
  if (q.taxCategoryId !== undefined) {
    clauses.push(`r.tax_category_id = ?`)
    params.push(q.taxCategoryId)
  }
  if (q.projectId !== undefined) {
    clauses.push(`r.project_id = ?`)
    params.push(q.projectId)
  }
  if (q.dateFrom !== undefined) {
    clauses.push(`r.txn_date >= ?`)
    params.push(q.dateFrom)
  }
  if (q.dateTo !== undefined) {
    clauses.push(`r.txn_date <= ?`)
    params.push(q.dateTo)
  }
  if (q.amountMinMinor !== undefined) {
    clauses.push(`r.total_minor >= ?`)
    params.push(q.amountMinMinor)
  }
  if (q.amountMaxMinor !== undefined) {
    clauses.push(`r.total_minor <= ?`)
    params.push(q.amountMaxMinor)
  }

  if (q.missing && q.missing.length > 0) {
    // Item must be in v_missing_key_data and flag every requested field.
    clauses.push(`mk.item_id IS NOT NULL`)
    for (const field of q.missing) {
      const col = MISSING_COL[field]
      if (!col) {
        // Fields the view does not track (paymentType, etc.): no row matches.
        clauses.push(`0`)
        continue
      }
      clauses.push(`mk.${col} = 1`)
    }
  }

  const whereSql = clauses.length ? clauses.join(' AND ') : '1=1'
  return { whereSql, params }
}

function loadItemMeta(db: Database, ids: number[]): Map<number, ItemMeta> {
  const map = new Map<number, ItemMeta>()
  if (ids.length === 0) return map
  const placeholders = ids.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT id AS item_id, type, folder_id FROM item WHERE id IN (${placeholders})`,
    )
    .all(...ids) as Array<{ item_id: number; type: string; folder_id: number }>
  for (const r of rows) {
    map.set(r.item_id, {
      itemId: r.item_id,
      type: r.type as ItemType,
      folderId: r.folder_id,
    })
  }
  return map
}
