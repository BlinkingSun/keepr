/**
 * CSV export tests — open artifacts and assert content.
 * Run: node --experimental-strip-types --test src/export/__tests__/csv.test.ts
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { exportCsv } from '../csv.ts'
import { queryExportReceipts, sumExportReceipts } from '../query.ts'
import {
  openExportFixture,
  mkReceipt,
  seedSplitReceipt,
  parseCsv,
  type ExportFixture,
} from './harness.ts'

describe('exportCsv', () => {
  let fx: ExportFixture
  let destDir: string

  before(() => {
    fx = openExportFixture()
    destDir = fx.libraryRoot
  })

  after(() => {
    fx.cleanup()
  })

  it('1. row count matches query and summed amount equals v_summable_receipts', async () => {
    mkReceipt(fx.db, fx.folderUser, {
      totalMinor: 8437,
      currency: 'USD',
      vendorId: fx.vendorId,
      categoryId: fx.categoryId,
      txnDate: '2026-07-01',
    })
    mkReceipt(fx.db, fx.folderUser, {
      totalMinor: 1500,
      currency: 'USD',
      vendorId: fx.vendorId,
      categoryId: fx.categoryId,
      txnDate: '2026-07-02',
    })
    mkReceipt(fx.db, fx.folderUser, {
      totalMinor: 2200,
      currency: 'EUR',
      vendorName: 'EuroMart',
      txnDate: '2026-07-03',
    })

    const filter = { query: { folderId: fx.folderUser } }
    const expectedRows = queryExportReceipts(fx.db, filter)
    const expectedSums = sumExportReceipts(fx.db, filter)

    const dest = join(destDir, 't1-receipts.csv')
    const path = await exportCsv(
      fx.db,
      { format: 'csv', destPath: dest, query: { folderId: fx.folderUser } },
      { libraryRoot: fx.libraryRoot },
    )
    assert.equal(path, dest)

    const text = readFileSync(dest, 'utf8')
    const table = parseCsv(text)
    assert.ok(table.length >= 2, 'header + data rows')
    const header = table[0]!
    const data = table.slice(1)
    assert.equal(data.length, expectedRows.length, 'CSV data rows match query row count')

    const totalIdx = header.indexOf('total')
    const currencyIdx = header.indexOf('currency')
    assert.ok(totalIdx >= 0)
    assert.ok(currencyIdx >= 0)

    // Sum per currency from the CSV amount column (plain decimals → minor).
    const byCur = new Map<string, number>()
    for (const row of data) {
      const cur = row[currencyIdx] ?? ''
      const dec = row[totalIdx] ?? '0'
      // "84.37" → 8437 minor without float: split on dot.
      const m = /^(-?)(\d+)\.(\d{2})$/.exec(dec)
      assert.ok(m, `plain decimal field: ${dec}`)
      const minor =
        (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 100 + Number(m[3]))
      byCur.set(cur, (byCur.get(cur) ?? 0) + minor)
    }

    for (const s of expectedSums) {
      assert.equal(
        byCur.get(s.currency),
        s.totalMinor,
        `CSV sum for ${s.currency} must equal v_summable_receipts`,
      )
    }
  })

  it('2. vendor with comma, quote, and newline round-trips through CSV parser', async () => {
    const tricky = 'Acme, "Best"\nSupplies'
    mkReceipt(fx.db, fx.folderUser, {
      totalMinor: 999,
      currency: 'USD',
      vendorName: tricky,
      description: 'line1\nline2, "x"',
    })

    const dest = join(destDir, 't2-escape.csv')
    await exportCsv(fx.db, {
      format: 'csv',
      destPath: dest,
      query: { folderId: fx.folderUser },
      options: { columns: ['vendor', 'description', 'total', 'currency'] },
    })

    const text = readFileSync(dest, 'utf8')
    // Must actually quote fields that need it.
    assert.match(text, /"/)
    const table = parseCsv(text)
    const header = table[0]!
    const vendorIdx = header.indexOf('vendor')
    const descIdx = header.indexOf('description')
    const found = table.slice(1).find((r) => r[vendorIdx] === tricky)
    assert.ok(found, 'vendor with comma/quote/newline must round-trip')
    assert.equal(found![descIdx], 'line1\nline2, "x"')
  })

  it('3. folder with split receipt totals ORIGIN amount, not double', async () => {
    // Fresh fixture folder content: seed split into Materials folder.
    const { originId, childIds, originTotal } = seedSplitReceipt(fx)

    // Naive receipt_data sum would double-count.
    const naive = (
      fx.db
        .prepare(
          `SELECT SUM(total_minor) s FROM receipt_data r
           JOIN item i ON i.id = r.item_id WHERE i.folder_id = ?`,
        )
        .get(fx.folderUser) as { s: number }
    ).s
    assert.ok(naive > originTotal, 'precondition: raw sum exceeds origin (double-count)')

    const viewSum = (
      fx.db
        .prepare(
          `SELECT COALESCE(SUM(total_minor),0) s FROM v_summable_receipts
           WHERE folder_id = ? AND currency = 'USD'`,
        )
        .get(fx.folderUser) as { s: number }
    ).s

    const dest = join(destDir, 't3-split.csv')
    await exportCsv(fx.db, {
      format: 'csv',
      destPath: dest,
      query: { folderId: fx.folderUser },
      options: { columns: ['item_id', 'total', 'currency'] },
    })

    const table = parseCsv(readFileSync(dest, 'utf8'))
    const header = table[0]!
    const totalIdx = header.indexOf('total')
    const idIdx = header.indexOf('item_id')
    const currencyIdx = header.indexOf('currency')
    let csvUsd = 0
    const ids = new Set<number>()
    for (const row of table.slice(1)) {
      if (row[currencyIdx] !== 'USD') continue
      const m = /^(-?)(\d+)\.(\d{2})$/.exec(row[totalIdx] ?? '')
      assert.ok(m)
      csvUsd += (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 100 + Number(m[3]))
      ids.add(Number(row[idIdx]))
    }

    // Origin must NOT appear; children may.
    assert.equal(ids.has(originId), false, 'superseded origin must not export')
    for (const c of childIds) {
      assert.equal(ids.has(c), true, `child ${c} should export`)
    }

    // Total equals origin (view sum for this folder may include other receipts
    // from prior tests). Compare children-only: sum of these three children.
    const childSum = childIds.reduce((acc, id) => {
      const r = fx.db
        .prepare(`SELECT total_minor t FROM v_summable_receipts WHERE item_id = ?`)
        .get(id) as { t: number } | undefined
      return acc + (r?.t ?? 0)
    }, 0)
    assert.equal(childSum, originTotal)
    assert.equal(
      childIds.reduce((acc, id) => {
        // re-read from CSV
        const row = table.slice(1).find((r) => Number(r[idIdx]) === id)
        if (!row) return acc
        const m = /^(-?)(\d+)\.(\d{2})$/.exec(row[totalIdx] ?? '')!
        return acc + (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 100 + Number(m[3]))
      }, 0),
      originTotal,
      'CSV sum of split children equals ORIGIN amount',
    )

    // Export sum for whole folder equals view, not naive double-count.
    const filter = { query: { folderId: fx.folderUser } }
    const sums = sumExportReceipts(fx.db, filter)
    const usdView = sums.find((s) => s.currency === 'USD')?.totalMinor ?? 0
    assert.equal(csvUsd, usdView)
    assert.equal(viewSum, usdView)
    assert.notEqual(csvUsd, naive)
  })
})
