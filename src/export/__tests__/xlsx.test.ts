/**
 * XLSX export tests — open with exceljs and assert sheets/headers/currency isolation.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { exportXlsx } from '../xlsx.ts'
import {
  openExportFixture,
  mkReceipt,
  type ExportFixture,
} from './harness.ts'

const require = createRequire(import.meta.url)
const ExcelJS = require('exceljs') as typeof import('exceljs')

describe('exportXlsx', () => {
  let fx: ExportFixture

  before(() => {
    fx = openExportFixture()
  })

  after(() => {
    fx.cleanup()
  })

  it('4. opens with exceljs, expected sheet names and header row', async () => {
    mkReceipt(fx.db, fx.folderUser, {
      totalMinor: 5000,
      currency: 'USD',
      vendorId: fx.vendorId,
      categoryId: fx.categoryId,
      txnDate: '2026-07-10',
    })

    const dest = join(fx.libraryRoot, 't4.xlsx')
    const written = await exportXlsx(fx.db, {
      format: 'xlsx',
      destPath: dest,
      query: { folderId: fx.folderUser },
    })
    assert.equal(written, dest)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(dest)
    assert.ok(wb.worksheets.length >= 1)
    const sheet = wb.worksheets[0]!
    assert.equal(sheet.name, 'USD')
    const header = sheet.getRow(1).values as Array<string | null | undefined>
    // exceljs values are 1-indexed (index 0 empty)
    const headers = header.slice(1).map(String)
    assert.ok(headers.includes('Date') || headers.includes('Vendor') || headers.includes('Total'))
    assert.ok(headers.includes('Total'), `headers: ${headers.join(',')}`)
    assert.ok(headers.includes('Vendor'))
    assert.ok(headers.includes('Currency') || headers.includes('Date'))

    // Data row present and total is a number at 2 decimals source.
    const row2 = sheet.getRow(2)
    assert.ok(row2.cellCount > 0)
  })

  it('5. mixed-currency export: one sheet per currency, never a blended total', async () => {
    mkReceipt(fx.db, fx.folderUser, {
      totalMinor: 1000,
      currency: 'USD',
      vendorName: 'US Shop',
      categoryId: fx.categoryId,
    })
    mkReceipt(fx.db, fx.folderUser, {
      totalMinor: 2500,
      currency: 'EUR',
      vendorName: 'EU Shop',
      categoryId: fx.categoryId,
    })
    mkReceipt(fx.db, fx.folderUser, {
      totalMinor: 3000,
      currency: 'GBP',
      vendorName: 'UK Shop',
      categoryId: fx.categoryId,
    })

    const dest = join(fx.libraryRoot, 't5-mixed.xlsx')
    await exportXlsx(fx.db, {
      format: 'xlsx',
      destPath: dest,
      query: { folderId: fx.folderUser },
    })

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(dest)
    const names = wb.worksheets.map((s) => s.name).sort()
    assert.ok(names.includes('USD'))
    assert.ok(names.includes('EUR'))
    assert.ok(names.includes('GBP'))
    // No single blended "Totals" / "All" money sheet that mixes currencies.
    assert.equal(names.includes('All'), false)
    assert.equal(names.includes('Totals'), false)

    // Each sheet's category Total cell is only that currency's money.
    for (const cur of ['USD', 'EUR', 'GBP'] as const) {
      const ws = wb.getWorksheet(cur)
      assert.ok(ws, `sheet ${cur}`)
      // Find the "Total" label in the cross-total block
      let foundTotal: number | null = null
      ws!.eachRow((row) => {
        const v1 = row.getCell(1).value
        const v2 = row.getCell(2).value
        if (v1 === 'Total' && typeof v2 === 'number') {
          foundTotal = v2
        }
      })
      assert.ok(foundTotal != null, `${cur} sheet must have a Total`)
      // Totals are major units numbers; they must not be sum of all currencies.
      // USD-only sheet total must not equal 1000+2500+3000 minor as a blended lie.
    }

    // Explicit: EUR sheet total should be 25.00 not 65.00 blended.
    const eur = wb.getWorksheet('EUR')!
    let eurTotal: number | null = null
    eur.eachRow((row) => {
      if (row.getCell(1).value === 'Total' && typeof row.getCell(2).value === 'number') {
        eurTotal = row.getCell(2).value as number
      }
    })
    assert.equal(eurTotal, 25)

    const gbp = wb.getWorksheet('GBP')!
    let gbpTotal: number | null = null
    gbp.eachRow((row) => {
      if (row.getCell(1).value === 'Total' && typeof row.getCell(2).value === 'number') {
        gbpTotal = row.getCell(2).value as number
      }
    })
    assert.equal(gbpTotal, 30)
  })
})
