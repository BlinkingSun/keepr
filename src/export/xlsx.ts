/**
 * Excel export via exceljs — per-currency sheets, optional thumbnails,
 * category cross-total block. Money is integer minor until the cell.
 */
import { nodeRequire } from '../shared/nodeRequire.ts'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { ExportRequest } from '../shared/ipc.ts'
import type { LibraryRelPath } from '../shared/types.ts'
import { asRelPath } from '../shared/types.ts'
import { minorToNumber } from './moneyFormat.ts'
import { beginExportProgress } from './progress.ts'
import { queryExportReceipts, queryItemPages } from './query.ts'
import {
  DEFAULT_COLUMNS,
  type ExportColumn,
  type ExportContext,
  type ExportReceiptRow,
  type KeeprDatabase,
} from './types.ts'

// Dual-runtime: import.meta.url is undefined in the CJS bundle Electron loads,
// and esbuild compiles import.meta to {} so the .url read yields undefined.
const require = nodeRequire
// exceljs is CJS; createRequire is the reliable Node path without a new dep.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ExcelJS = require('exceljs') as typeof import('exceljs')

const HEADER_LABELS: Record<ExportColumn, string> = {
  item_id: 'Item ID',
  txn_date: 'Date',
  vendor: 'Vendor',
  category: 'Category',
  tax_category: 'Tax Category',
  description: 'Description',
  total: 'Total',
  currency: 'Currency',
  tax: 'Tax',
  payment_type: 'Payment',
  project: 'Project',
  external_ref: 'Reference',
  folder_id: 'Folder ID',
}

function resolveColumns(req: ExportRequest): ExportColumn[] {
  const requested = req.options?.columns
  if (!requested || requested.length === 0) {
    return DEFAULT_COLUMNS.filter((c) => c !== 'folder_id')
  }
  const allowed = new Set<string>(Object.keys(HEADER_LABELS))
  const out: ExportColumn[] = []
  for (const c of requested) {
    const key = c.trim().toLowerCase().replace(/-/g, '_') as ExportColumn
    if (allowed.has(key)) out.push(key)
  }
  return out.length > 0 ? out : DEFAULT_COLUMNS.filter((c) => c !== 'folder_id')
}

function cellFor(row: ExportReceiptRow, col: ExportColumn): string | number | null {
  switch (col) {
    case 'item_id':
      return row.itemId
    case 'txn_date':
      return row.txnDate
    case 'vendor':
      return row.vendorName
    case 'category':
      return row.categoryName
    case 'tax_category':
      return row.taxCategoryName
    case 'description':
      return row.description
    case 'total':
      return row.totalMinor == null ? null : minorToNumber(row.totalMinor)
    case 'currency':
      return row.currency
    case 'tax':
      return row.taxTotalMinor == null ? null : minorToNumber(row.taxTotalMinor)
    case 'payment_type':
      return row.paymentTypeName
    case 'project':
      return row.projectName
    case 'external_ref':
      return row.externalRef
    case 'folder_id':
      return row.folderId
    default: {
      const _exhaustive: never = col
      return _exhaustive
    }
  }
}

function groupByCurrency(rows: ExportReceiptRow[]): Map<string, ExportReceiptRow[]> {
  const map = new Map<string, ExportReceiptRow[]>()
  for (const r of rows) {
    const list = map.get(r.currency)
    if (list) list.push(r)
    else map.set(r.currency, [r])
  }
  return map
}

function categoryTotals(rows: ExportReceiptRow[]): Array<{ category: string; totalMinor: number }> {
  const m = new Map<string, number>()
  for (const r of rows) {
    if (r.totalMinor == null) continue
    const key = r.categoryName ?? '(uncategorized)'
    m.set(key, (m.get(key) ?? 0) + r.totalMinor)
  }
  return [...m.entries()]
    .map(([category, totalMinor]) => ({ category, totalMinor }))
    .sort((a, b) => a.category.localeCompare(b.category))
}

async function resolveThumbBuffer(
  ctx: ExportContext | undefined,
  itemId: number,
  db: KeeprDatabase,
): Promise<Buffer | null> {
  if (!ctx?.fileStore && !ctx?.libraryRoot) return null
  const pages = queryItemPages(db, [itemId])
  const first = pages[0]
  if (!first) return null
  const rel = (first.thumbRelpath ?? first.fileRelpath) as string
  try {
    if (ctx.fileStore) {
      return await ctx.fileStore.read(asRelPath(rel) as LibraryRelPath)
    }
    const abs = path.resolve(ctx.libraryRoot!, rel)
    const { readFile } = await import('node:fs/promises')
    return await readFile(abs)
  } catch {
    return null
  }
}

/**
 * Write an .xlsx workbook. Multiple currencies → one sheet per currency.
 * Never a blended multi-currency total.
 */
export async function exportXlsx(
  db: KeeprDatabase,
  req: ExportRequest,
  ctx?: ExportContext,
): Promise<string> {
  const destPath = path.resolve(req.destPath)
  const progress = await beginExportProgress(ctx, 'xlsx', destPath, 1)
  try {
    const rows = queryExportReceipts(db, {
      itemIds: req.itemIds,
      query: req.query,
    })
    const columns = resolveColumns(req)
    const byCur = groupByCurrency(rows)
    const currencies = [...byCur.keys()].sort()
    const includeImages = req.options?.includeImages === true

    const wb = new ExcelJS.Workbook()
    wb.creator = 'KeepR'
    wb.created = new Date()

    // Single currency still gets a named sheet; mixed → one sheet each.
    const sheetNames =
      currencies.length === 0
        ? ['Receipts']
        : currencies.length === 1
          ? [currencies[0]!]
          : currencies

    if (currencies.length === 0) {
      const ws = wb.addWorksheet('Receipts')
      ws.addRow(columns.map((c) => HEADER_LABELS[c]))
    } else {
      let unit = 0
      const totalUnits = currencies.length
      await progress.setTotal(totalUnits)

      for (const cur of currencies) {
        const sheetRows = byCur.get(cur) ?? []
        const name = sheetNames.includes(cur) ? cur : cur
        const ws = wb.addWorksheet(name.slice(0, 31))

        const headers = [...columns.map((c) => HEADER_LABELS[c])]
        if (includeImages) headers.push('Image')
        ws.addRow(headers)
        ws.getRow(1).font = { bold: true }

        for (let i = 0; i < sheetRows.length; i++) {
          const row = sheetRows[i]!
          const values = columns.map((c) => cellFor(row, c))
          if (includeImages) values.push(null)
          const excelRow = ws.addRow(values)

          // Money columns: 2 decimal places, no currency symbol (currency is a column / sheet).
          for (let ci = 0; ci < columns.length; ci++) {
            const col = columns[ci]!
            if (col === 'total' || col === 'tax') {
              const cell = excelRow.getCell(ci + 1)
              if (typeof cell.value === 'number') {
                cell.numFmt = '0.00'
              }
            }
          }

          if (includeImages) {
            const buf = await resolveThumbBuffer(ctx, row.itemId, db)
            if (buf) {
              const imgId = wb.addImage({
                buffer: buf as unknown as import('exceljs').Buffer,
                extension: 'jpeg',
              })
              // Fit roughly in a cell: row height ~60, col width ~12.
              const imgCol = columns.length // 0-based last col
              ws.getColumn(imgCol + 1).width = 14
              excelRow.height = 60
              ws.addImage(imgId, {
                tl: { col: imgCol, row: excelRow.number - 1 },
                ext: { width: 80, height: 60 },
                editAs: 'oneCell',
              })
            }
          }
        }

        // Category cross-total block (this currency only — never blended).
        const totals = categoryTotals(sheetRows)
        ws.addRow([])
        ws.addRow(['Category totals', cur])
        ws.getRow(ws.rowCount).font = { bold: true }
        let catSumMinor = 0
        for (const t of totals) {
          catSumMinor += t.totalMinor
          ws.addRow([t.category, minorToNumber(t.totalMinor)])
          ws.getRow(ws.rowCount).getCell(2).numFmt = '0.00'
        }
        ws.addRow(['Total', minorToNumber(catSumMinor)])
        ws.getRow(ws.rowCount).font = { bold: true }
        ws.getRow(ws.rowCount).getCell(2).numFmt = '0.00'

        unit++
        await progress.bump(1)
        void totalUnits
      }
    }

    await mkdir(path.dirname(destPath), { recursive: true })
    await wb.xlsx.writeFile(destPath)
    await progress.done({ path: destPath, sheets: sheetNames })
    return destPath
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await progress.fail(msg)
    throw e
  }
}
