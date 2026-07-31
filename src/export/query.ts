/**
 * Load export rows ONLY through v_summable_receipts / v_summable_tax.
 * Never SUM from receipt_data — that double-counts split origins.
 */
import type { SearchQuery } from '../shared/types.ts'
import type { ExportReceiptRow, KeeprDatabase } from './types.ts'

export interface ExportFilter {
  itemIds?: number[]
  query?: SearchQuery
}

interface RawRow {
  item_id: number
  folder_id: number
  txn_date: string | null
  total_minor: number | null
  currency: string
  tax_total_minor: number | null
  vendor_name: string | null
  category_name: string | null
  tax_category_name: string | null
  description: string | null
  payment_type_name: string | null
  project_name: string | null
  external_ref: string | null
}

function buildWhere(filter: ExportFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = []
  const params: unknown[] = []
  const q = filter.query

  if (filter.itemIds && filter.itemIds.length > 0) {
    clauses.push(`v.item_id IN (${filter.itemIds.map(() => '?').join(',')})`)
    params.push(...filter.itemIds)
  }

  if (q?.folderId != null) {
    if (q.includeSubfolders) {
      // Walk descendants via recursive CTE; bind root once.
      clauses.push(`v.folder_id IN (
        WITH RECURSIVE desc AS (
          SELECT id FROM folder WHERE id = ?
          UNION ALL
          SELECT f.id FROM folder f JOIN desc d ON f.parent_id = d.id
        )
        SELECT id FROM desc
      )`)
      params.push(q.folderId)
    } else {
      clauses.push('v.folder_id = ?')
      params.push(q.folderId)
    }
  }

  if (q?.vendorId != null) {
    clauses.push('v.vendor_id = ?')
    params.push(q.vendorId)
  }
  if (q?.categoryId != null) {
    clauses.push('v.category_id = ?')
    params.push(q.categoryId)
  }
  if (q?.taxCategoryId != null) {
    clauses.push('v.tax_category_id = ?')
    params.push(q.taxCategoryId)
  }
  if (q?.projectId != null) {
    clauses.push('v.project_id = ?')
    params.push(q.projectId)
  }
  if (q?.dateFrom) {
    clauses.push('v.txn_date >= ?')
    params.push(q.dateFrom)
  }
  if (q?.dateTo) {
    clauses.push('v.txn_date <= ?')
    params.push(q.dateTo)
  }
  if (q?.amountMinMinor != null) {
    clauses.push('v.total_minor >= ?')
    params.push(q.amountMinMinor)
  }
  if (q?.amountMaxMinor != null) {
    clauses.push('v.total_minor <= ?')
    params.push(q.amountMaxMinor)
  }
  if (q?.reviewed === true) {
    clauses.push('v.reviewed_at IS NOT NULL')
  } else if (q?.reviewed === false) {
    clauses.push('v.reviewed_at IS NULL')
  }
  // type: view is already receipts only
  // includeTrashed: view already excludes trashed; no path reopens them for sums

  const sql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  return { sql, params }
}

/**
 * Receipt rows for CSV/XLSX. Money columns come from v_summable_receipts only.
 * Non-money labels join lookup tables; receipt_data is joined solely for
 * description / external_ref text — never for totals.
 */
export function queryExportReceipts(
  db: KeeprDatabase,
  filter: ExportFilter,
): ExportReceiptRow[] {
  const { sql: where, params } = buildWhere(filter)
  const rows = db
    .prepare(
      `SELECT v.item_id, v.folder_id, v.txn_date, v.total_minor, v.currency,
              v.tax_total_minor,
              vend.name AS vendor_name,
              cat.name AS category_name,
              tcat.name AS tax_category_name,
              r.description AS description,
              pt.name AS payment_type_name,
              proj.name AS project_name,
              r.external_ref AS external_ref
         FROM v_summable_receipts v
         JOIN receipt_data r ON r.item_id = v.item_id
         LEFT JOIN vendor vend ON vend.id = v.vendor_id
         LEFT JOIN category cat ON cat.id = v.category_id
         LEFT JOIN tax_category tcat ON tcat.id = v.tax_category_id
         LEFT JOIN payment_type pt ON pt.id = r.payment_type_id
         LEFT JOIN project proj ON proj.id = v.project_id
         ${where}
         ORDER BY v.currency ASC,
                  CASE WHEN v.txn_date IS NULL THEN 1 ELSE 0 END,
                  v.txn_date ASC,
                  v.item_id ASC`,
    )
    .all(...params) as RawRow[]

  return rows.map((r) => ({
    itemId: r.item_id,
    folderId: r.folder_id,
    txnDate: r.txn_date,
    vendorName: r.vendor_name,
    categoryName: r.category_name,
    taxCategoryName: r.tax_category_name,
    description: r.description,
    totalMinor: r.total_minor,
    currency: r.currency,
    taxTotalMinor: r.tax_total_minor,
    paymentTypeName: r.payment_type_name,
    projectName: r.project_name,
    externalRef: r.external_ref,
  }))
}

/**
 * Canonical sum for a filter, grouped by currency.
 * MUST use v_summable_receipts — tests compare export column sums to this.
 */
export function sumExportReceipts(
  db: KeeprDatabase,
  filter: ExportFilter,
): Array<{ currency: string; totalMinor: number; itemCount: number }> {
  const { sql: where, params } = buildWhere(filter)
  return db
    .prepare(
      `SELECT v.currency AS currency,
              COALESCE(SUM(v.total_minor), 0) AS totalMinor,
              COUNT(*) AS itemCount
         FROM v_summable_receipts v
         ${where}
         GROUP BY v.currency
         ORDER BY v.currency`,
    )
    .all(...params) as Array<{ currency: string; totalMinor: number; itemCount: number }>
}

export interface ItemPageRow {
  itemId: number
  pageId: number
  seq: number
  fileRelpath: string
  thumbRelpath: string | null
  rotation: number
  width: number | null
  height: number | null
  ocrWordsJson: string | null
  ocrText: string | null
  viaSplit: number
}

/** Pages for PDF export via v_item_pages (split children cite origin images). */
export function queryItemPages(
  db: KeeprDatabase,
  itemIds: number[],
): ItemPageRow[] {
  if (itemIds.length === 0) return []
  const placeholders = itemIds.map(() => '?').join(',')
  return db
    .prepare(
      `SELECT vip.item_id AS itemId,
              vip.page_id AS pageId,
              vip.seq AS seq,
              vip.file_relpath AS fileRelpath,
              vip.thumb_relpath AS thumbRelpath,
              vip.rotation AS rotation,
              p.width AS width,
              p.height AS height,
              p.ocr_words_json AS ocrWordsJson,
              p.ocr_text AS ocrText,
              vip.via_split AS viaSplit
         FROM v_item_pages vip
         JOIN page p ON p.id = vip.page_id
        WHERE vip.item_id IN (${placeholders})
        ORDER BY vip.item_id, vip.seq`,
    )
    .all(...itemIds) as ItemPageRow[]
}

/** Item ids matching the export filter (summable receipts + explicit ids). */
export function resolveExportItemIds(
  db: KeeprDatabase,
  filter: ExportFilter,
): number[] {
  if (filter.itemIds && filter.itemIds.length > 0 && !filter.query) {
    // Honour the caller's list but still only summable receipts for money exports.
    // For PDF, allow any non-trashed item so documents with pages export too.
    const placeholders = filter.itemIds.map(() => '?').join(',')
    const rows = db
      .prepare(
        `SELECT id FROM item
          WHERE id IN (${placeholders})
            AND trashed_at IS NULL
          ORDER BY id`,
      )
      .all(...filter.itemIds) as Array<{ id: number }>
    return rows.map((r) => r.id)
  }
  return queryExportReceipts(db, filter).map((r) => r.itemId)
}

export interface CabinetRow {
  displayName: string | null
  profileJson: string | null
  baseCurrency: string
}

export function loadCabinet(db: KeeprDatabase): CabinetRow | null {
  const row = db
    .prepare(
      `SELECT display_name AS displayName, profile_json AS profileJson,
              base_currency AS baseCurrency
         FROM cabinet WHERE id = 1`,
    )
    .get() as CabinetRow | undefined
  return row ?? null
}
