import type {
  ContactData,
  DocumentData,
  ExtractionRecord,
  ExtractableField,
  Item,
  ItemType,
  ReceiptData,
  ReceiptTaxLine,
  SplitGroup,
} from '../../shared/types.ts'
import {
  asCivilDate,
  asCurrency,
  asMinor,
} from '../../shared/types.ts'
import type {
  FilterTotals,
  GridRow,
  ItemDetail,
  ItemPatch,
  ListRequest,
  ListResponse,
  PatchResult,
} from '../../shared/ipc.ts'
import { ListsRepo, type ListName } from './lists.ts'
import { LOW_CONFIDENCE_THRESHOLD as SHARED_LOW_CONFIDENCE_THRESHOLD } from '../../shared/types.ts'
import { parseMoneyField } from './money.ts'
import { CustomFieldsRepo } from './customFields.ts'
import { PagesRepo } from './pages.ts'
import type { Database } from './types.ts'

// Single source of truth in the contract — the repo and the viewer previously
// disagreed (0.75 vs 0.85), so a field at 0.80 was flagged in one place and not
// the other.
const LOW_CONFIDENCE_THRESHOLD = SHARED_LOW_CONFIDENCE_THRESHOLD

const FIELD_TO_EXTRACTION: Partial<Record<keyof ItemPatch, ExtractableField>> = {
  txnDate: 'txnDate',
  vendorName: 'vendor',
  totalText: 'total',
  paymentTypeName: 'paymentType',
  taxTotalText: 'taxTotal',
  categoryName: 'category',
  taxCategoryName: 'taxCategory',
  externalRef: 'externalRef',
  description: 'description',
}

interface GridSqlRow {
  item_id: number
  type: string
  folder_id: number
  txn_date: string | null
  vendor_name: string | null
  category_name: string | null
  payment_type_name: string | null
  tax_total_minor: number | null
  total_minor: number | null
  currency: string | null
  reviewed_at: number | null
  has_images: number
  is_split_child: number
  extraction_json: string | null
  missing_vendor: number | null
  missing_date: number | null
  missing_total: number | null
  missing_category: number | null
  missing_tax_category: number | null
}

function lowConfidenceFields(extractionJson: string | null): string[] {
  if (!extractionJson) return []
  let rec: ExtractionRecord
  try {
    rec = JSON.parse(extractionJson) as ExtractionRecord
  } catch {
    return []
  }
  const out: string[] = []
  for (const [field, prov] of Object.entries(rec)) {
    if (!prov) continue
    if (typeof prov.confidence === 'number' && prov.confidence < LOW_CONFIDENCE_THRESHOLD) {
      out.push(field)
    }
  }
  return out
}

function missingFieldsFromRow(r: GridSqlRow): string[] {
  const out: string[] = []
  // Only receipt rows participate in v_missing_key_data; null markers mean n/a.
  if (r.type !== 'receipt') return out
  if (r.missing_vendor === 1 || (r.missing_vendor === null && !r.vendor_name && r.total_minor !== undefined)) {
    // Prefer view flags when present; fall back to column emptiness for complete receipts
    // that are NOT in v_missing_key_data (all null LEFT JOIN).
  }
  if (r.missing_vendor === 1) out.push('vendor')
  if (r.missing_date === 1) out.push('txnDate')
  if (r.missing_total === 1) out.push('total')
  if (r.missing_category === 1) out.push('category')
  if (r.missing_tax_category === 1) out.push('taxCategory')

  // Row not in the missing view (LEFT JOIN all-null): derive from columns for receipts.
  if (
    r.missing_vendor === null &&
    r.missing_date === null &&
    r.missing_total === null &&
    r.missing_category === null &&
    r.missing_tax_category === null &&
    r.type === 'receipt'
  ) {
    // Complete or partial? If the item has no receipt_data, total_minor/currency null.
    // We only flag keys that are empty when we have receipt context (currency set).
    if (r.currency != null) {
      if (!r.vendor_name) out.push('vendor')
      if (!r.txn_date) out.push('txnDate')
      if (r.total_minor === null) out.push('total')
      if (!r.category_name) out.push('category')
      // tax category not in grid row columns — leave to view only
    }
  }
  return out
}

function mapGridRow(r: GridSqlRow): GridRow {
  return {
    itemId: r.item_id,
    type: r.type as ItemType,
    folderId: r.folder_id,
    txnDate: r.txn_date ? asCivilDate(r.txn_date) : null,
    vendorName: r.vendor_name,
    categoryName: r.category_name,
    paymentTypeName: r.payment_type_name,
    taxTotalMinor: r.tax_total_minor !== null && r.tax_total_minor !== undefined
      ? asMinor(r.tax_total_minor)
      : null,
    totalMinor: r.total_minor !== null && r.total_minor !== undefined ? asMinor(r.total_minor) : null,
    currency: r.currency ?? 'USD',
    reviewed: r.reviewed_at != null,
    hasImages: r.has_images === 1,
    isSplitChild: r.is_split_child === 1,
    lowConfidenceFields: lowConfidenceFields(r.extraction_json),
    missingFields: missingFieldsFromRow(r),
  }
}

export class ItemsRepo {
  private readonly db: Database
  private readonly lists: ListsRepo
  private readonly pages: PagesRepo
  private readonly customFields: CustomFieldsRepo

  constructor(db: Database) {
    this.db = db
    this.lists = new ListsRepo(db)
    this.pages = new PagesRepo(db)
    this.customFields = new CustomFieldsRepo(db)
  }

  /**
   * Bounded queries regardless of row count: one for rows (with joins), one for
   * count, one for totals via v_summable_receipts, one for unreviewed/incomplete.
   * NEVER SUM from receipt_data.
   */
  list(req: ListRequest = {}): ListResponse {
    const { whereSql, params } = this.buildWhere(req)
    const limit = req.limit ?? 10_000
    const offset = req.offset ?? 0
    const orderSql = this.buildOrder(req)

    const rowsSql = `
      SELECT
        i.id AS item_id,
        i.type,
        i.folder_id,
        r.txn_date,
        v.name AS vendor_name,
        c.name AS category_name,
        pt.name AS payment_type_name,
        r.tax_total_minor,
        r.total_minor,
        COALESCE(r.currency, 'USD') AS currency,
        i.reviewed_at,
        CASE WHEN EXISTS (
          SELECT 1 FROM v_item_pages vp WHERE vp.item_id = i.id
        ) THEN 1 ELSE 0 END AS has_images,
        CASE WHEN i.split_role = 'child' THEN 1 ELSE 0 END AS is_split_child,
        r.extraction_json,
        mk.missing_vendor,
        mk.missing_date,
        mk.missing_total,
        mk.missing_category,
        mk.missing_tax_category
      FROM item i
      LEFT JOIN receipt_data r ON r.item_id = i.id
      LEFT JOIN vendor v ON v.id = r.vendor_id
      LEFT JOIN category c ON c.id = r.category_id
      LEFT JOIN payment_type pt ON pt.id = r.payment_type_id
      LEFT JOIN v_missing_key_data mk ON mk.item_id = i.id
      WHERE ${whereSql}
      ${orderSql}
      LIMIT ? OFFSET ?`

    const rowParams = [...params, limit, offset]
    const rawRows = this.db.prepare(rowsSql).all(...rowParams) as GridSqlRow[]
    const rows = rawRows.map(mapGridRow)

    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS c FROM item i WHERE ${whereSql}`)
      .get(...params) as { c: number }

    const totals = this.computeFilterTotals(req)

    return {
      rows,
      total: countRow.c,
      totals,
    }
  }

  /**
   * Totals ONLY from v_summable_receipts / v_summable_tax — never receipt_data.
   * Always per-currency.
   */
  private computeFilterTotals(req: ListRequest): FilterTotals {
    // Map item-scoped WHERE (alias i) onto summable receipts (alias sr joined to item i).
    // Smart filter 'trash' means no live sums.
    if (req.smartFilter === 'trash') {
      return { byCurrency: [], unreviewedCount: 0, hasIncompleteAmounts: false }
    }

    // Rebuild a where clause that works when the driving table is v_summable_receipts.
    const { whereSql: sumWhere, params: sumParams } = this.buildSummableWhere(req)

    const byCur = this.db
      .prepare(
        `SELECT
           sr.currency AS currency,
           COUNT(*) AS item_count,
           COALESCE(SUM(sr.total_minor), 0) AS total_minor,
           COALESCE(SUM(sr.tax_total_minor), 0) AS tax_minor,
           SUM(CASE WHEN sr.total_minor IS NULL THEN 1 ELSE 0 END) AS missing_amount_count
         FROM v_summable_receipts sr
         JOIN item i ON i.id = sr.item_id
         WHERE ${sumWhere}
         GROUP BY sr.currency
         ORDER BY sr.currency`,
      )
      .all(...sumParams) as Array<{
      currency: string
      item_count: number
      total_minor: number
      tax_minor: number
      missing_amount_count: number
    }>

    const unreviewed = this.db
      .prepare(
        `SELECT COUNT(*) AS c
           FROM v_summable_receipts sr
           JOIN item i ON i.id = sr.item_id
          WHERE ${sumWhere} AND sr.reviewed_at IS NULL`,
      )
      .get(...sumParams) as { c: number }

    const incomplete = byCur.some((r) => r.missing_amount_count > 0)

    return {
      byCurrency: byCur.map((r) => ({
        currency: r.currency,
        itemCount: r.item_count,
        totalMinor: asMinor(r.total_minor),
        taxMinor: asMinor(r.tax_minor),
      })),
      unreviewedCount: unreviewed.c,
      hasIncompleteAmounts: incomplete,
    }
  }

  private buildWhere(req: ListRequest): { whereSql: string; params: unknown[] } {
    const clauses: string[] = []
    const params: unknown[] = []

    // Default: exclude trashed unless smartFilter is trash or includeTrashed semantics.
    if (req.smartFilter === 'trash') {
      clauses.push(`i.trashed_at IS NOT NULL`)
    } else {
      clauses.push(`i.trashed_at IS NULL`)
    }

    // Superseded split origins are excluded from the grid, matching
    // v_summable_receipts. The status-bar totals were already correct, but the
    // ROWS were not: a split $100 receipt listed the origin plus its three
    // children, so the visible amounts added to $200 while the footer said
    // $100. Guarding SQL sums was not enough, because the grid does not sum —
    // it displays, and the user does the arithmetic. Select-all showed a lie.
    //
    // The origin is not lost: it is historical truth, reachable from any
    // child's split badge via includeSuperseded.
    if (!req.includeSuperseded) {
      clauses.push(`i.superseded_at IS NULL`)
    }

    if (req.smartFilter === 'unreviewed') {
      clauses.push(`i.reviewed_at IS NULL`)
    }
    if (req.smartFilter === 'inbox') {
      clauses.push(`i.folder_id IN (SELECT id FROM folder WHERE kind = 'inbox')`)
    }
    if (req.smartFilter === 'recent') {
      // Last 30 days by created_at
      clauses.push(`i.created_at >= ?`)
      params.push(Date.now() - 30 * 24 * 60 * 60 * 1000)
    }

    if (req.folderId !== undefined) {
      if (req.includeSubfolders) {
        clauses.push(
          `i.folder_id IN (
             WITH RECURSIVE tree(id) AS (
               SELECT id FROM folder WHERE id = ?
               UNION ALL
               SELECT f.id FROM folder f JOIN tree t ON f.parent_id = t.id
             )
             SELECT id FROM tree
           )`,
        )
        params.push(req.folderId)
      } else {
        clauses.push(`i.folder_id = ?`)
        params.push(req.folderId)
      }
    }

    if (req.type) {
      clauses.push(`i.type = ?`)
      params.push(req.type)
    }

    const whereSql = clauses.length ? clauses.join(' AND ') : '1=1'
    return { whereSql, params }
  }

  /** Same filters as buildWhere, for queries driven by v_summable_receipts + item. */
  private buildSummableWhere(req: ListRequest): { whereSql: string; params: unknown[] } {
    // v_summable_receipts already excludes trashed + superseded. Mirror other filters.
    const clauses: string[] = ['1=1']
    const params: unknown[] = []

    if (req.smartFilter === 'unreviewed') {
      clauses.push(`sr.reviewed_at IS NULL`)
    }
    if (req.smartFilter === 'inbox') {
      clauses.push(`sr.folder_id IN (SELECT id FROM folder WHERE kind = 'inbox')`)
    }
    if (req.smartFilter === 'recent') {
      clauses.push(`i.created_at >= ?`)
      params.push(Date.now() - 30 * 24 * 60 * 60 * 1000)
    }
    if (req.folderId !== undefined) {
      if (req.includeSubfolders) {
        clauses.push(
          `sr.folder_id IN (
             WITH RECURSIVE tree(id) AS (
               SELECT id FROM folder WHERE id = ?
               UNION ALL
               SELECT f.id FROM folder f JOIN tree t ON f.parent_id = t.id
             )
             SELECT id FROM tree
           )`,
        )
        params.push(req.folderId)
      } else {
        clauses.push(`sr.folder_id = ?`)
        params.push(req.folderId)
      }
    }
    if (req.type && req.type !== 'receipt') {
      // Summable view is receipts-only; non-receipt type filter => empty totals.
      clauses.push(`0`)
    }
    return { whereSql: clauses.join(' AND '), params }
  }

  private buildOrder(req: ListRequest): string {
    const allowed = new Map<string, string>([
      ['txnDate', 'r.txn_date'],
      ['vendorName', 'v.name'],
      ['categoryName', 'c.name'],
      ['totalMinor', 'r.total_minor'],
      ['currency', 'r.currency'],
      ['createdAt', 'i.created_at'],
      ['modifiedAt', 'i.modified_at'],
      ['type', 'i.type'],
      ['folderId', 'i.folder_id'],
    ])
    const sorts = req.sort?.length
      ? req.sort
      : [{ column: 'txnDate', dir: 'desc' as const }, { column: 'createdAt', dir: 'desc' as const }]

    const parts: string[] = []
    for (const s of sorts) {
      const col = allowed.get(s.column)
      if (!col) continue
      const dir = s.dir === 'asc' ? 'ASC' : 'DESC'
      parts.push(`${col} ${dir} NULLS LAST`)
    }
    if (!parts.length) parts.push(`i.id DESC`)
    // SQLite before 3.30 may not like NULLS LAST — use CASE fallback if needed.
    // better-sqlite3 typically ships recent SQLite; keep NULLS LAST.
    return `ORDER BY ${parts.join(', ')}, i.id DESC`
  }

  detail(id: number): ItemDetail | null {
    const itemRow = this.db
      .prepare(
        `SELECT id, folder_id, type, split_group_id, split_role, superseded_at,
                reviewed_at, trashed_at, created_at, modified_at
           FROM item WHERE id = ?`,
      )
      .get(id) as
      | {
          id: number
          folder_id: number
          type: string
          split_group_id: number | null
          split_role: string | null
          superseded_at: number | null
          reviewed_at: number | null
          trashed_at: number | null
          created_at: number
          modified_at: number
        }
      | undefined
    if (!itemRow) return null

    const item: Item = {
      id: itemRow.id,
      folderId: itemRow.folder_id,
      type: itemRow.type as ItemType,
      splitGroupId: itemRow.split_group_id,
      splitRole: itemRow.split_role as Item['splitRole'],
      supersededAt: itemRow.superseded_at as Item['supersededAt'],
      reviewedAt: itemRow.reviewed_at as Item['reviewedAt'],
      trashedAt: itemRow.trashed_at as Item['trashedAt'],
      createdAt: itemRow.created_at as Item['createdAt'],
      modifiedAt: itemRow.modified_at as Item['modifiedAt'],
    }

    let receipt: ReceiptData | null = null
    let document: DocumentData | null = null
    let contact: ContactData | null = null
    let taxLines: ReceiptTaxLine[] = []
    let splitGroup: SplitGroup | null = null
    let splitSiblings: number[] = []

    if (item.type === 'receipt') {
      const r = this.db
        .prepare(
          `SELECT item_id, txn_date, vendor_id, total_minor, currency, payment_type_id,
                  tax_total_minor, category_id, tax_category_id, project_id,
                  external_ref, description, extraction_json
             FROM receipt_data WHERE item_id = ?`,
        )
        .get(id) as
        | {
            item_id: number
            txn_date: string | null
            vendor_id: number | null
            total_minor: number | null
            currency: string
            payment_type_id: number | null
            tax_total_minor: number | null
            category_id: number | null
            tax_category_id: number | null
            project_id: number | null
            external_ref: string | null
            description: string | null
            extraction_json: string | null
          }
        | undefined
      if (r) {
        let extraction: ExtractionRecord | null = null
        if (r.extraction_json) {
          try {
            extraction = JSON.parse(r.extraction_json) as ExtractionRecord
          } catch {
            extraction = null
          }
        }
        receipt = {
          itemId: r.item_id,
          txnDate: r.txn_date ? asCivilDate(r.txn_date) : null,
          vendorId: r.vendor_id,
          totalMinor: r.total_minor !== null ? asMinor(r.total_minor) : null,
          currency: asCurrency(r.currency),
          paymentTypeId: r.payment_type_id,
          taxTotalMinor: r.tax_total_minor !== null ? asMinor(r.tax_total_minor) : null,
          categoryId: r.category_id,
          taxCategoryId: r.tax_category_id,
          projectId: r.project_id,
          externalRef: r.external_ref,
          description: r.description,
          extraction,
        }
      }
      const tl = this.db
        .prepare(
          `SELECT id, item_id, label, rate_bp, amount_minor, tax_category_id
             FROM receipt_tax_line WHERE item_id = ? ORDER BY id`,
        )
        .all(id) as Array<{
        id: number
        item_id: number
        label: string
        rate_bp: number | null
        amount_minor: number
        tax_category_id: number | null
      }>
      taxLines = tl.map((t) => ({
        id: t.id,
        itemId: t.item_id,
        label: t.label,
        rateBp: t.rate_bp,
        amountMinor: asMinor(t.amount_minor),
        taxCategoryId: t.tax_category_id,
      }))
    }

    if (item.type === 'document') {
      const d = this.db
        .prepare(`SELECT item_id, title, doc_date, doc_type, notes FROM document_data WHERE item_id = ?`)
        .get(id) as
        | {
            item_id: number
            title: string | null
            doc_date: string | null
            doc_type: string | null
            notes: string | null
          }
        | undefined
      if (d) {
        document = {
          itemId: d.item_id,
          title: d.title,
          docDate: d.doc_date ? asCivilDate(d.doc_date) : null,
          docType: d.doc_type,
          notes: d.notes,
        }
      }
    }

    if (item.type === 'contact') {
      const c = this.db
        .prepare(
          `SELECT item_id, first_name, last_name, org, title, emails_json, phones_json,
                  addresses_json, url, notes
             FROM contact_data WHERE item_id = ?`,
        )
        .get(id) as
        | {
            item_id: number
            first_name: string | null
            last_name: string | null
            org: string | null
            title: string | null
            emails_json: string | null
            phones_json: string | null
            addresses_json: string | null
            url: string | null
            notes: string | null
          }
        | undefined
      if (c) {
        contact = {
          itemId: c.item_id,
          firstName: c.first_name,
          lastName: c.last_name,
          org: c.org,
          title: c.title,
          emails: parseJsonArray(c.emails_json),
          phones: parseJsonArray(c.phones_json),
          addresses: parseJsonArray(c.addresses_json),
          url: c.url,
          notes: c.notes,
        }
      }
    }

    if (item.splitGroupId != null) {
      const sg = this.db
        .prepare(
          `SELECT id, origin_item_id, origin_page_id, origin_total_minor, origin_tax_minor,
                  currency, created_at
             FROM split_group WHERE id = ?`,
        )
        .get(item.splitGroupId) as
        | {
            id: number
            origin_item_id: number
            origin_page_id: number | null
            origin_total_minor: number
            origin_tax_minor: number | null
            currency: string
            created_at: number
          }
        | undefined
      if (sg) {
        splitGroup = {
          id: sg.id,
          originItemId: sg.origin_item_id,
          originPageId: sg.origin_page_id,
          originTotalMinor: asMinor(sg.origin_total_minor),
          originTaxMinor: sg.origin_tax_minor !== null ? asMinor(sg.origin_tax_minor) : null,
          currency: asCurrency(sg.currency),
          createdAt: sg.created_at as SplitGroup['createdAt'],
        }
        const sibs = this.db
          .prepare(
            `SELECT id FROM item WHERE split_group_id = ? AND id <> ? ORDER BY id`,
          )
          .all(item.splitGroupId, id) as Array<{ id: number }>
        splitSiblings = sibs.map((s) => s.id)
      }
    }

    const pages = this.pages.listForItem(id)
    const customFields = this.customFields.getValues(id)

    return {
      item,
      receipt,
      document,
      contact,
      taxLines,
      pages,
      splitGroup,
      splitSiblings,
      customFields,
    }
  }

  create(input: { folderId: number; type: ItemType }): { itemId: number } {
    const now = Date.now()
    const run = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO item(folder_id, type, created_at, modified_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(input.folderId, input.type, now, now)
      const itemId = Number(result.lastInsertRowid)
      if (input.type === 'receipt') {
        this.db
          .prepare(`INSERT INTO receipt_data(item_id, currency) VALUES (?, 'USD')`)
          .run(itemId)
      } else if (input.type === 'document') {
        this.db.prepare(`INSERT INTO document_data(item_id) VALUES (?)`).run(itemId)
      } else if (input.type === 'contact') {
        this.db.prepare(`INSERT INTO contact_data(item_id) VALUES (?)`).run(itemId)
      }
      return itemId
    })
    return { itemId: run() }
  }

  /**
   * Parse strings to typed values; return per-field errors rather than throwing.
   * Auto-creates newly typed list values and reports them in createdListValues.
   * User-corrected fields are pinned in extraction_json.
   */
  patch(id: number, patch: ItemPatch): PatchResult {
    const errors: Record<string, string> = {}
    const createdListValues: Array<{ list: string; name: string }> = []

    const item = this.db
      .prepare(`SELECT id, type, folder_id FROM item WHERE id = ?`)
      .get(id) as { id: number; type: string; folder_id: number } | undefined
    if (!item) {
      return { ok: false, errors: { id: 'item not found' }, row: null, createdListValues: [] }
    }

    // Pre-parse money outside the transaction so we can fail cleanly.
    let totalMinor: number | null | undefined = undefined
    if (patch.totalText !== undefined) {
      const p = parseMoneyField(patch.totalText)
      if (!p.ok) errors.totalText = p.error
      else totalMinor = p.minor
    }
    let taxTotalMinor: number | null | undefined = undefined
    if (patch.taxTotalText !== undefined) {
      const p = parseMoneyField(patch.taxTotalText)
      if (!p.ok) errors.taxTotalText = p.error
      else taxTotalMinor = p.minor
    }

    let txnDate: string | null | undefined = undefined
    if (patch.txnDate !== undefined) {
      if (patch.txnDate === null || patch.txnDate === '') {
        txnDate = null
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.txnDate)) {
        errors.txnDate = `not a civil date: ${patch.txnDate}`
      } else {
        txnDate = patch.txnDate
      }
    }

    let currency: string | undefined = undefined
    if (patch.currency !== undefined) {
      if (!/^[A-Z]{3}$/.test(patch.currency)) {
        errors.currency = `not an ISO-4217 code: ${patch.currency}`
      } else {
        currency = patch.currency
      }
    }

    let docDate: string | null | undefined = undefined
    if (patch.docDate !== undefined) {
      if (patch.docDate === null || patch.docDate === '') {
        docDate = null
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.docDate)) {
        errors.docDate = `not a civil date: ${patch.docDate}`
      } else {
        docDate = patch.docDate
      }
    }

    if (Object.keys(errors).length > 0) {
      return { ok: false, errors, row: null, createdListValues: [] }
    }

    const apply = this.db.transaction(() => {
      const now = Date.now()

      if (patch.folderId !== undefined) {
        this.db.prepare(`UPDATE item SET folder_id = ?, modified_at = ? WHERE id = ?`).run(
          patch.folderId,
          now,
          id,
        )
      }
      if (patch.reviewed !== undefined) {
        this.db
          .prepare(`UPDATE item SET reviewed_at = ?, modified_at = ? WHERE id = ?`)
          .run(patch.reviewed ? now : null, now, id)
      } else {
        this.db.prepare(`UPDATE item SET modified_at = ? WHERE id = ?`).run(now, id)
      }

      if (item.type === 'receipt') {
        this.ensureReceiptRow(id)
        const listIds = this.resolveListPatches(patch, createdListValues, errors)
        if (Object.keys(errors).length > 0) {
          // Abort transaction by throwing; caller maps to PatchResult.
          throw new PatchValidationError(errors)
        }

        const sets: string[] = []
        const vals: unknown[] = []

        if (txnDate !== undefined) {
          sets.push('txn_date = ?')
          vals.push(txnDate)
        }
        if (totalMinor !== undefined) {
          sets.push('total_minor = ?')
          vals.push(totalMinor)
        }
        if (taxTotalMinor !== undefined) {
          sets.push('tax_total_minor = ?')
          vals.push(taxTotalMinor)
        }
        if (currency !== undefined) {
          sets.push('currency = ?')
          vals.push(currency)
        }
        if (listIds.vendorId !== undefined) {
          sets.push('vendor_id = ?')
          vals.push(listIds.vendorId)
        }
        if (listIds.categoryId !== undefined) {
          sets.push('category_id = ?')
          vals.push(listIds.categoryId)
        }
        if (listIds.taxCategoryId !== undefined) {
          sets.push('tax_category_id = ?')
          vals.push(listIds.taxCategoryId)
        }
        if (listIds.paymentTypeId !== undefined) {
          sets.push('payment_type_id = ?')
          vals.push(listIds.paymentTypeId)
        }
        if (listIds.projectId !== undefined) {
          sets.push('project_id = ?')
          vals.push(listIds.projectId)
        }
        if (patch.externalRef !== undefined) {
          sets.push('external_ref = ?')
          vals.push(patch.externalRef)
        }
        if (patch.description !== undefined) {
          sets.push('description = ?')
          vals.push(patch.description)
        }

        // Pin user-corrected extractable fields.
        const extraction = this.readExtraction(id)
        let extractionDirty = false
        for (const [patchKey, extractField] of Object.entries(FIELD_TO_EXTRACTION)) {
          if ((patch as Record<string, unknown>)[patchKey] === undefined) continue
          if (!extractField) continue
          const value = this.extractionValueForPatch(patchKey as keyof ItemPatch, patch, {
            totalMinor,
            taxTotalMinor,
            txnDate,
            listIds,
          })
          extraction[extractField] = {
            value,
            confidence: 1,
            bbox: null,
            pageId: null,
            pinned: true,
          }
          extractionDirty = true
        }
        if (extractionDirty) {
          sets.push('extraction_json = ?')
          vals.push(JSON.stringify(extraction))
        }

        if (sets.length) {
          vals.push(id)
          this.db
            .prepare(`UPDATE receipt_data SET ${sets.join(', ')} WHERE item_id = ?`)
            .run(...vals)
        }
      }

      if (item.type === 'document') {
        this.ensureDocumentRow(id)
        const sets: string[] = []
        const vals: unknown[] = []
        if (patch.title !== undefined) {
          sets.push('title = ?')
          vals.push(patch.title)
        }
        if (docDate !== undefined) {
          sets.push('doc_date = ?')
          vals.push(docDate)
        }
        if (patch.notes !== undefined) {
          sets.push('notes = ?')
          vals.push(patch.notes)
        }
        if (sets.length) {
          vals.push(id)
          this.db
            .prepare(`UPDATE document_data SET ${sets.join(', ')} WHERE item_id = ?`)
            .run(...vals)
        }
      }
    })

    try {
      apply()
    } catch (e: unknown) {
      if (e instanceof PatchValidationError) {
        return { ok: false, errors: e.errors, row: null, createdListValues: [] }
      }
      throw e
    }

    const row = this.gridRowFor(id)
    return { ok: true, errors: {}, row, createdListValues }
  }

  private resolveListPatches(
    patch: ItemPatch,
    created: Array<{ list: string; name: string }>,
    errors: Record<string, string>,
  ): {
    vendorId?: number | null
    categoryId?: number | null
    taxCategoryId?: number | null
    paymentTypeId?: number | null
    projectId?: number | null
  } {
    const out: {
      vendorId?: number | null
      categoryId?: number | null
      taxCategoryId?: number | null
      paymentTypeId?: number | null
      projectId?: number | null
    } = {}

    const one = (
      patchKey: keyof ItemPatch,
      list: ListName,
      reportList: string,
      assign: (id: number | null) => void,
    ) => {
      const raw = patch[patchKey]
      if (raw === undefined) return
      if (raw === null || raw === '') {
        assign(null)
        return
      }
      if (typeof raw !== 'string') {
        errors[patchKey] = 'expected string name'
        return
      }
      try {
        const { id, created: wasCreated } = this.lists.upsertByName(list, raw)
        if (wasCreated) created.push({ list: reportList, name: raw.trim() })
        assign(id)
      } catch (e: unknown) {
        errors[patchKey] = e instanceof Error ? e.message : String(e)
      }
    }

    one('vendorName', 'vendor', 'vendor', (id) => {
      out.vendorId = id
    })
    one('categoryName', 'category', 'category', (id) => {
      out.categoryId = id
    })
    one('taxCategoryName', 'tax_category', 'taxCategory', (id) => {
      out.taxCategoryId = id
    })
    one('paymentTypeName', 'payment_type', 'paymentType', (id) => {
      out.paymentTypeId = id
    })
    one('projectName', 'project', 'project', (id) => {
      out.projectId = id
    })

    return out
  }

  private extractionValueForPatch(
    patchKey: keyof ItemPatch,
    patch: ItemPatch,
    ctx: {
      totalMinor: number | null | undefined
      taxTotalMinor: number | null | undefined
      txnDate: string | null | undefined
      listIds: {
        vendorId?: number | null
        categoryId?: number | null
        taxCategoryId?: number | null
        paymentTypeId?: number | null
      }
    },
  ): unknown {
    switch (patchKey) {
      case 'totalText':
        return ctx.totalMinor ?? null
      case 'taxTotalText':
        return ctx.taxTotalMinor ?? null
      case 'txnDate':
        return ctx.txnDate ?? null
      case 'vendorName':
        return patch.vendorName
      case 'categoryName':
        return patch.categoryName
      case 'taxCategoryName':
        return patch.taxCategoryName
      case 'paymentTypeName':
        return patch.paymentTypeName
      case 'externalRef':
        return patch.externalRef
      case 'description':
        return patch.description
      default:
        return (patch as Record<string, unknown>)[patchKey]
    }
  }

  private readExtraction(itemId: number): ExtractionRecord {
    const row = this.db
      .prepare(`SELECT extraction_json FROM receipt_data WHERE item_id = ?`)
      .get(itemId) as { extraction_json: string | null } | undefined
    if (!row?.extraction_json) return {}
    try {
      return JSON.parse(row.extraction_json) as ExtractionRecord
    } catch {
      return {}
    }
  }

  private ensureReceiptRow(itemId: number): void {
    const exists = this.db
      .prepare(`SELECT 1 AS x FROM receipt_data WHERE item_id = ?`)
      .get(itemId) as { x: number } | undefined
    if (!exists) {
      this.db.prepare(`INSERT INTO receipt_data(item_id, currency) VALUES (?, 'USD')`).run(itemId)
    }
  }

  private ensureDocumentRow(itemId: number): void {
    const exists = this.db
      .prepare(`SELECT 1 AS x FROM document_data WHERE item_id = ?`)
      .get(itemId) as { x: number } | undefined
    if (!exists) {
      this.db.prepare(`INSERT INTO document_data(item_id) VALUES (?)`).run(itemId)
    }
  }

  private gridRowFor(id: number): GridRow | null {
    // Direct lookup — not list() — so a just-trashed row still round-trips after patch.
    const raw = this.db
      .prepare(
        `SELECT
           i.id AS item_id, i.type, i.folder_id, r.txn_date,
           v.name AS vendor_name, c.name AS category_name, pt.name AS payment_type_name,
           r.tax_total_minor, r.total_minor, COALESCE(r.currency, 'USD') AS currency,
           i.reviewed_at,
           CASE WHEN EXISTS (SELECT 1 FROM v_item_pages vp WHERE vp.item_id = i.id) THEN 1 ELSE 0 END AS has_images,
           CASE WHEN i.split_role = 'child' THEN 1 ELSE 0 END AS is_split_child,
           r.extraction_json,
           mk.missing_vendor, mk.missing_date, mk.missing_total, mk.missing_category, mk.missing_tax_category
         FROM item i
         LEFT JOIN receipt_data r ON r.item_id = i.id
         LEFT JOIN vendor v ON v.id = r.vendor_id
         LEFT JOIN category c ON c.id = r.category_id
         LEFT JOIN payment_type pt ON pt.id = r.payment_type_id
         LEFT JOIN v_missing_key_data mk ON mk.item_id = i.id
         WHERE i.id = ?`,
      )
      .get(id) as GridSqlRow | undefined
    return raw ? mapGridRow(raw) : null
  }

  bulk(
    op: 'move' | 'delete' | 'restore' | 'reviewed' | 'clear',
    ids: number[],
    targetFolderId?: number,
  ): { affected: number; errors: Array<{ itemId: number; reason: string }> } {
    const errors: Array<{ itemId: number; reason: string }> = []
    let affected = 0
    const now = Date.now()

    const run = this.db.transaction(() => {
      for (const id of ids) {
        try {
          switch (op) {
            case 'move': {
              if (targetFolderId === undefined) {
                errors.push({ itemId: id, reason: 'targetFolderId required for move' })
                continue
              }
              const r = this.db
                .prepare(`UPDATE item SET folder_id = ?, modified_at = ? WHERE id = ?`)
                .run(targetFolderId, now, id)
              if (r.changes) affected++
              else errors.push({ itemId: id, reason: 'not found' })
              break
            }
            case 'delete': {
              const r = this.db
                .prepare(`UPDATE item SET trashed_at = ?, modified_at = ? WHERE id = ? AND trashed_at IS NULL`)
                .run(now, now, id)
              if (r.changes) affected++
              else errors.push({ itemId: id, reason: 'not found or already trashed' })
              break
            }
            case 'restore': {
              const r = this.db
                .prepare(`UPDATE item SET trashed_at = NULL, modified_at = ? WHERE id = ? AND trashed_at IS NOT NULL`)
                .run(now, id)
              if (r.changes) affected++
              else errors.push({ itemId: id, reason: 'not found or not trashed' })
              break
            }
            case 'reviewed': {
              const r = this.db
                .prepare(`UPDATE item SET reviewed_at = ?, modified_at = ? WHERE id = ?`)
                .run(now, now, id)
              if (r.changes) affected++
              else errors.push({ itemId: id, reason: 'not found' })
              break
            }
            case 'clear': {
              // Clear reviewed flag.
              const r = this.db
                .prepare(`UPDATE item SET reviewed_at = NULL, modified_at = ? WHERE id = ?`)
                .run(now, id)
              if (r.changes) affected++
              else errors.push({ itemId: id, reason: 'not found' })
              break
            }
            default: {
              const _e: never = op
              errors.push({ itemId: id, reason: `unknown op ${_e}` })
            }
          }
        } catch (e: unknown) {
          errors.push({ itemId: id, reason: e instanceof Error ? e.message : String(e) })
        }
      }
    })
    run()
    return { affected, errors }
  }

  trash(id: number): { ok: boolean } {
    const now = Date.now()
    const r = this.db
      .prepare(`UPDATE item SET trashed_at = ?, modified_at = ? WHERE id = ? AND trashed_at IS NULL`)
      .run(now, now, id)
    return { ok: r.changes > 0 }
  }

  restore(id: number): { ok: boolean } {
    const now = Date.now()
    const r = this.db
      .prepare(
        `UPDATE item SET trashed_at = NULL, modified_at = ? WHERE id = ? AND trashed_at IS NOT NULL`,
      )
      .run(now, id)
    return { ok: r.changes > 0 }
  }
}

class PatchValidationError extends Error {
  errors: Record<string, string>
  constructor(errors: Record<string, string>) {
    super('patch validation failed')
    this.name = 'PatchValidationError'
    this.errors = errors
  }
}

function parseJsonArray(s: string | null): string[] {
  if (!s) return []
  try {
    const v: unknown = JSON.parse(s)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}
