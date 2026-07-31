/**
 * CSV export — one row per summable receipt, money as plain decimals.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ExportRequest } from '../shared/ipc.ts'
import { minorToPlainDecimal } from './moneyFormat.ts'
import { beginExportProgress } from './progress.ts'
import { queryExportReceipts } from './query.ts'
import {
  DEFAULT_COLUMNS,
  type ExportColumn,
  type ExportContext,
  type ExportReceiptRow,
  type KeeprDatabase,
} from './types.ts'

/** RFC-style CSV field escape: quote when the value contains comma, quote, or newline. */
export function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function columnHeader(col: ExportColumn): string {
  switch (col) {
    case 'item_id':
      return 'item_id'
    case 'txn_date':
      return 'txn_date'
    case 'vendor':
      return 'vendor'
    case 'category':
      return 'category'
    case 'tax_category':
      return 'tax_category'
    case 'description':
      return 'description'
    case 'total':
      return 'total'
    case 'currency':
      return 'currency'
    case 'tax':
      return 'tax'
    case 'payment_type':
      return 'payment_type'
    case 'project':
      return 'project'
    case 'external_ref':
      return 'external_ref'
    case 'folder_id':
      return 'folder_id'
    default: {
      const _exhaustive: never = col
      return _exhaustive
    }
  }
}

function cellValue(row: ExportReceiptRow, col: ExportColumn): string {
  switch (col) {
    case 'item_id':
      return String(row.itemId)
    case 'txn_date':
      return row.txnDate ?? ''
    case 'vendor':
      return row.vendorName ?? ''
    case 'category':
      return row.categoryName ?? ''
    case 'tax_category':
      return row.taxCategoryName ?? ''
    case 'description':
      return row.description ?? ''
    case 'total':
      return row.totalMinor == null ? '' : minorToPlainDecimal(row.totalMinor)
    case 'currency':
      return row.currency
    case 'tax':
      return row.taxTotalMinor == null ? '' : minorToPlainDecimal(row.taxTotalMinor)
    case 'payment_type':
      return row.paymentTypeName ?? ''
    case 'project':
      return row.projectName ?? ''
    case 'external_ref':
      return row.externalRef ?? ''
    case 'folder_id':
      return String(row.folderId)
    default: {
      const _exhaustive: never = col
      return _exhaustive
    }
  }
}

function resolveColumns(req: ExportRequest): ExportColumn[] {
  const requested = req.options?.columns
  if (!requested || requested.length === 0) return [...DEFAULT_COLUMNS]
  const allowed = new Set<string>(DEFAULT_COLUMNS as string[])
  const aliases: Record<string, ExportColumn> = {
    amount: 'total',
    total_minor: 'total',
    tax_total: 'tax',
    tax_total_minor: 'tax',
    vendor_name: 'vendor',
    category_name: 'category',
  }
  const out: ExportColumn[] = []
  for (const c of requested) {
    const key = c.trim().toLowerCase().replace(/-/g, '_')
    if (allowed.has(key)) {
      out.push(key as ExportColumn)
    } else if (aliases[key]) {
      out.push(aliases[key]!)
    }
  }
  return out.length > 0 ? out : [...DEFAULT_COLUMNS]
}

export function rowsToCsv(rows: ExportReceiptRow[], columns: ExportColumn[]): string {
  const header = columns.map(columnHeader).map(escapeCsvField).join(',')
  const lines = [header]
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCsvField(cellValue(row, c))).join(','))
  }
  // Trailing newline so tools that count lines via split work cleanly.
  return lines.join('\n') + '\n'
}

/**
 * Write a CSV of summable receipts to `req.destPath`.
 * @returns absolute path written
 */
export async function exportCsv(
  db: KeeprDatabase,
  req: ExportRequest,
  ctx?: ExportContext,
): Promise<string> {
  const destPath = path.resolve(req.destPath)
  const progress = await beginExportProgress(ctx, 'csv', destPath, 1)
  try {
    const rows = queryExportReceipts(db, {
      itemIds: req.itemIds,
      query: req.query,
    })
    const columns = resolveColumns(req)
    const body = rowsToCsv(rows, columns)

    await mkdir(path.dirname(destPath), { recursive: true })
    await writeFile(destPath, body, 'utf8')
    await progress.bump(1)
    await progress.done({ path: destPath, rowCount: rows.length })
    return destPath
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await progress.fail(msg)
    throw e
  }
}
