/**
 * splitReceipt — divide one receipt into N children that sum EXACTLY.
 *
 * Non-negotiables (Lane I):
 *  - allocate / allocateByWeight from shared/types (never hand-roll division)
 *  - one transaction
 *  - assert v_split_reconciliation before commit
 *  - tax allocates alongside money; children get receipt_tax_line rows
 *  - children own no page rows (cite origin via v_item_pages)
 *  - origin becomes split_role='origin' with superseded_at set
 */

import {
  allocate,
  allocateByWeight,
  asMinor,
  type MinorUnits,
  type Sha256,
} from '../shared/types.ts'
import type { SplitPart, SplitResult } from '../shared/ipc.ts'
import type { Database } from './db.ts'
import { nowMs } from './db.ts'
import { parseAmountText } from './parseAmount.ts'
import {
  resolveCategoryId,
  resolveProjectId,
  resolveTaxCategoryId,
} from './lists.ts'
import { assertSplitReconciliation } from './reconcile.ts'

interface ItemRow {
  id: number
  folder_id: number
  type: string
  split_group_id: number | null
  split_role: string | null
  superseded_at: number | null
  trashed_at: number | null
  reviewed_at: number | null
}

interface ReceiptRow {
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

interface TaxLineRow {
  id: number
  item_id: number
  label: string
  rate_bp: number | null
  amount_minor: number
  tax_category_id: number | null
}

interface PageRow {
  id: number
  seq: number
  content_hash: string | null
}

type AllocMode =
  | { kind: 'equal' }
  | { kind: 'weight'; weights: number[] }
  | { kind: 'amount'; amounts: MinorUnits[] }

function resolveAllocMode(parts: SplitPart[]): AllocMode {
  if (parts.length < 2) {
    throw new Error('KeepR: split requires at least 2 parts')
  }

  let hasAmount = false
  let hasWeight = false
  let hasNeither = false

  for (const p of parts) {
    const amt = p.amountText !== undefined && p.amountText !== null && String(p.amountText).trim() !== ''
    const w = p.weight !== undefined && p.weight !== null
    if (amt && w) {
      throw new Error('KeepR: a SplitPart cannot carry both amountText and weight')
    }
    if (amt) hasAmount = true
    else if (w) hasWeight = true
    else hasNeither = true
  }

  if (hasAmount && hasWeight) {
    throw new Error('KeepR: parts must be all amounts or all weights, not mixed')
  }
  if (hasAmount && hasNeither) {
    throw new Error('KeepR: every part must include amountText in amount mode')
  }
  if (hasWeight && hasNeither) {
    throw new Error('KeepR: every part must include weight in weight mode')
  }

  if (hasAmount) {
    const amounts: MinorUnits[] = []
    for (const p of parts) {
      const parsed = parseAmountText(p.amountText)
      if (!parsed.ok) throw new Error(`KeepR: ${parsed.error}`)
      amounts.push(asMinor(parsed.minor))
    }
    return { kind: 'amount', amounts }
  }

  if (hasWeight) {
    const weights = parts.map((p) => {
      const w = p.weight
      if (w === undefined || w === null || !Number.isFinite(w)) {
        throw new Error('KeepR: weight must be a finite number')
      }
      return w
    })
    return { kind: 'weight', weights }
  }

  // Empty parts → equal N-way split via allocate().
  return { kind: 'equal' }
}

/**
 * Partition `total` across parts.
 * - equal: largest-remainder via allocate()
 * - weight: allocateByWeight()
 * - amount: for money, the explicit amounts themselves; for any other total
 *   (tax lines, tax_total), re-partition with those amounts as weights so tax
 *   tracks the money split without inventing a second divisor.
 */
function allocateTotal(
  total: MinorUnits,
  mode: AllocMode,
  n: number,
  opts: { explicitAmounts?: boolean } = {},
): MinorUnits[] {
  switch (mode.kind) {
    case 'equal':
      return allocate(total, n)
    case 'weight':
      return allocateByWeight(total, mode.weights)
    case 'amount':
      if (opts.explicitAmounts) return mode.amounts
      // Use absolute values as weights so a negative refund still partitions.
      return allocateByWeight(
        total,
        mode.amounts.map((a) => Math.abs(a)),
      )
  }
}

export function splitReceipt(db: Database, itemId: number, parts: SplitPart[]): SplitResult {
  const mode = resolveAllocMode(parts)
  const n = parts.length

  const run = db.transaction((): SplitResult => {
    const item = db
      .prepare(
        `SELECT id, folder_id, type, split_group_id, split_role, superseded_at, trashed_at, reviewed_at
         FROM item WHERE id = ?`,
      )
      .get(itemId) as ItemRow | undefined

    if (!item) throw new Error(`KeepR: item ${itemId} not found`)
    if (item.trashed_at != null) throw new Error('KeepR: cannot split a trashed item')
    if (item.type !== 'receipt') throw new Error('KeepR: only receipts can be split')
    if (item.split_role != null || item.split_group_id != null) {
      throw new Error('KeepR: item is already part of a split')
    }
    if (item.superseded_at != null) {
      throw new Error('KeepR: cannot split a superseded item')
    }

    // Concurrent / second split of the same origin: refuse if a split_group
    // already points at this item as origin (defence if flags were cleared
    // without dissolving — should not happen under normal operation).
    const existingSg = db
      .prepare(`SELECT id FROM split_group WHERE origin_item_id = ? LIMIT 1`)
      .get(itemId) as { id: number } | undefined
    if (existingSg) {
      throw new Error('KeepR: item already has a split group')
    }

    // merge × split: active merge_group on this item is refused by trigger,
    // but fail early with a clearer path for callers that check pre-flight.
    const activeMerge = db
      .prepare(`SELECT id FROM merge_group WHERE result_item_id = ? LIMIT 1`)
      .get(itemId) as { id: number } | undefined
    // Note: we still attempt the update so the schema trigger message is what
    // tests assert for the combine×split matrix; early check is optional.
    void activeMerge

    const receipt = db
      .prepare(
        `SELECT item_id, txn_date, vendor_id, total_minor, currency, payment_type_id,
                tax_total_minor, category_id, tax_category_id, project_id,
                external_ref, description, extraction_json
         FROM receipt_data WHERE item_id = ?`,
      )
      .get(itemId) as ReceiptRow | undefined

    if (!receipt) throw new Error('KeepR: receipt has no receipt_data row')
    if (receipt.total_minor === null || receipt.total_minor === undefined) {
      throw new Error('KeepR: cannot split a receipt with no total')
    }

    const originTotal = asMinor(receipt.total_minor)
    // Money: in amount mode the parts ARE the child totals (must sum exactly).
    const childTotals = allocateTotal(originTotal, mode, n, { explicitAmounts: true })

    if (mode.kind === 'amount') {
      const sum = childTotals.reduce((a, b) => a + b, 0)
      if (sum !== originTotal) {
        throw new Error(
          `KeepR: part amounts sum to ${sum} but origin total is ${originTotal}`,
        )
      }
    }

    // Tax: same allocation method. Prefer receipt.tax_total_minor; fall back to
    // sum of tax lines so a filled lines table still partitions correctly.
    const taxLines = db
      .prepare(
        `SELECT id, item_id, label, rate_bp, amount_minor, tax_category_id
         FROM receipt_tax_line WHERE item_id = ? ORDER BY id`,
      )
      .all(itemId) as TaxLineRow[]

    const taxLineSum = taxLines.reduce((a, t) => a + t.amount_minor, 0)
    const originTaxRaw =
      receipt.tax_total_minor !== null && receipt.tax_total_minor !== undefined
        ? receipt.tax_total_minor
        : taxLines.length > 0
          ? taxLineSum
          : null

    let childTaxTotals: (MinorUnits | null)[]
    let allocatedTaxLines: Array<Array<{ label: string; rate_bp: number | null; amount_minor: MinorUnits; tax_category_id: number | null }>>

    if (originTaxRaw === null) {
      childTaxTotals = Array.from({ length: n }, () => null)
      allocatedTaxLines = Array.from({ length: n }, () => [])
    } else {
      const originTax = asMinor(originTaxRaw)
      // When we have per-line rows, allocate each line so SUM(v_summable_tax)
      // across children equals the original line total. tax_total_minor on each
      // child is the sum of its allocated lines — that keeps recon clean when
      // origin_tax_minor equals the line sum (or the stored tax_total_minor).
      if (taxLines.length > 0) {
        allocatedTaxLines = Array.from({ length: n }, () => [])
        for (const line of taxLines) {
          const partsForLine = allocateTotal(asMinor(line.amount_minor), mode, n)
          for (let i = 0; i < n; i++) {
            const amt = partsForLine[i]
            if (amt === undefined) throw new Error('KeepR: tax allocation length mismatch')
            const bucket = allocatedTaxLines[i]
            if (!bucket) throw new Error('KeepR: tax allocation bucket missing')
            bucket.push({
              label: line.label,
              rate_bp: line.rate_bp,
              amount_minor: amt,
              tax_category_id: line.tax_category_id,
            })
          }
        }
        childTaxTotals = allocatedTaxLines.map((lines) =>
          asMinor(lines.reduce((a, l) => a + l.amount_minor, 0)),
        )
        // If origin_tax_minor is the stored tax_total (which may disagree with
        // line sum by a prior edit), re-scale child tax_total from originTax so
        // recon tax_drift is zero. Prefer line-sum children when they already
        // match; otherwise allocate originTax directly onto tax_total_minor and
        // keep the line rows as the line-sum partition.
        const childTaxSum = childTaxTotals.reduce((a, b) => a + (b ?? 0), 0)
        if (childTaxSum !== originTax) {
          // Force tax_total_minor to reconcile to originTax; keep line amounts
          // as the line-wise partition (reports may show line detail that sums
          // to line totals while tax_total matches origin snapshot).
          childTaxTotals = allocateTotal(originTax, mode, n)
        }
      } else {
        // No lines: allocate tax_total and synthesize one line per child so tax
        // does not vanish from v_summable_tax after the split.
        childTaxTotals = allocateTotal(originTax, mode, n)
        allocatedTaxLines = childTaxTotals.map((amt) => {
          if (amt === null) return []
          return [
            {
              label: 'Tax',
              rate_bp: null as number | null,
              amount_minor: amt,
              tax_category_id: receipt.tax_category_id,
            },
          ]
        })
      }
    }

    const pages = db
      .prepare(
        `SELECT id, seq, content_hash FROM page WHERE item_id = ? ORDER BY seq`,
      )
      .all(itemId) as PageRow[]
    const originPageId = pages.length === 1 ? (pages[0]?.id ?? null) : null
    // Multi-page: leave origin_page_id NULL so v_item_pages cites every page.
    // Single-page: pin the page id for precise citation.

    const ts = nowMs()
    const originTaxForGroup =
      originTaxRaw === null || originTaxRaw === undefined ? null : originTaxRaw

    const sgResult = db
      .prepare(
        `INSERT INTO split_group(
           origin_item_id, origin_page_id, origin_total_minor, origin_tax_minor, currency, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        itemId,
        originPageId,
        originTotal,
        originTaxForGroup,
        receipt.currency,
        ts,
      )
    const splitGroupId = Number(sgResult.lastInsertRowid)

    // Mark origin superseded. Triggers refuse this if the item is an active
    // merge result ("separate this combined item before splitting it").
    db.prepare(
      `UPDATE item
       SET split_group_id = ?, split_role = 'origin', superseded_at = ?, modified_at = ?
       WHERE id = ?`,
    ).run(splitGroupId, ts, ts, itemId)

    const children: Array<{ itemId: number; totalMinor: MinorUnits }> = []

    const insertItem = db.prepare(
      `INSERT INTO item(folder_id, type, split_group_id, split_role, superseded_at, reviewed_at, trashed_at, created_at, modified_at)
       VALUES (?, 'receipt', ?, 'child', NULL, NULL, NULL, ?, ?)`,
    )
    const insertReceipt = db.prepare(
      `INSERT INTO receipt_data(
         item_id, txn_date, vendor_id, total_minor, currency, payment_type_id,
         tax_total_minor, category_id, tax_category_id, project_id,
         external_ref, description, extraction_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const insertTaxLine = db.prepare(
      `INSERT INTO receipt_tax_line(item_id, label, rate_bp, amount_minor, tax_category_id)
       VALUES (?, ?, ?, ?, ?)`,
    )

    for (let i = 0; i < n; i++) {
      const total = childTotals[i]
      if (total === undefined) throw new Error('KeepR: child total missing')

      const part = parts[i]
      const categoryId =
        part?.categoryName !== undefined
          ? resolveCategoryId(db, part.categoryName)
          : receipt.category_id
      const taxCategoryId =
        part?.taxCategoryName !== undefined
          ? resolveTaxCategoryId(db, part.taxCategoryName)
          : receipt.tax_category_id
      const projectId =
        part?.projectName !== undefined
          ? resolveProjectId(db, part.projectName)
          : receipt.project_id
      const description =
        part?.description !== undefined ? part.description : receipt.description

      const childId = Number(
        insertItem.run(item.folder_id, splitGroupId, ts, ts).lastInsertRowid,
      )

      const taxTotal = childTaxTotals[i] ?? null
      insertReceipt.run(
        childId,
        receipt.txn_date,
        receipt.vendor_id,
        total,
        receipt.currency,
        receipt.payment_type_id,
        taxTotal,
        categoryId,
        taxCategoryId,
        projectId,
        receipt.external_ref,
        description,
        null, // do not copy extraction provenance onto synthetic children
      )

      const lines = allocatedTaxLines[i] ?? []
      for (const line of lines) {
        insertTaxLine.run(
          childId,
          line.label,
          line.rate_bp,
          line.amount_minor,
          line.tax_category_id,
        )
      }

      children.push({ itemId: childId, totalMinor: total })
    }

    // THE money gate: zero drift or the transaction aborts.
    assertSplitReconciliation(db, splitGroupId)

    // Shared citation proof through v_item_pages (acceptance #7 / test 4).
    const childHashes = children.map((c) => {
      const rows = db
        .prepare(
          `SELECT content_hash FROM v_item_pages WHERE item_id = ? ORDER BY seq`,
        )
        .all(c.itemId) as Array<{ content_hash: string | null }>
      return rows.map((r) => r.content_hash)
    })
    const firstHashes = childHashes[0] ?? []
    const imageSha256 = (firstHashes[0] ?? null) as Sha256 | null

    const sumMinor = asMinor(children.reduce((a, c) => a + c.totalMinor, 0))

    return {
      splitGroupId,
      originItemId: itemId,
      originTotalMinor: originTotal,
      children,
      sumMinor,
      imageSha256,
    }
  })

  return run()
}
