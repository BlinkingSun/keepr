/**
 * Lane A required tests.
 * Run: node --experimental-strip-types --test src/db/repo/__tests__/*.ts
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  openFixture,
  mkReceipt,
  seedSplitReceipt,
  NOW,
  type Fixture,
} from './harness.ts'
import { applyRules } from '../../../rules/engine.ts'
import { normalizeVendorName } from '../normalize.ts'

describe('Lane A repositories', () => {
  let fx: Fixture

  beforeEach(() => {
    fx = openFixture()
  })

  // 1. list() totals for a folder containing a split receipt equal the original
  it('1. list() totals for a split folder equal the original, not double', () => {
    const { originTotal } = seedSplitReceipt(fx)
    const res = fx.repos.items.list({ folderId: fx.folderUser })

    assert.equal(res.totals.byCurrency.length, 1)
    const usd = res.totals.byCurrency[0]
    assert.ok(usd)
    assert.equal(usd.currency, 'USD')
    assert.equal(usd.totalMinor, originTotal, `expected ${originTotal}, got ${usd.totalMinor}`)
    // Naive SUM(receipt_data) would be 20000 — prove the view path is used.
    const naive = (
      fx.raw.prepare(`SELECT SUM(total_minor) AS s FROM receipt_data`).get() as { s: number }
    ).s
    assert.equal(naive, 20000)
    assert.notEqual(usd.totalMinor, naive)
  })

  // 2. mixed-currency folder → one entry per currency, never blended
  it('2. list() mixed-currency returns one entry per currency, never blended', () => {
    mkReceipt(fx.raw, fx.folderUser, {
      totalMinor: 10000,
      currency: 'USD',
      vendorId: fx.vendorId,
    })
    mkReceipt(fx.raw, fx.folderUser, {
      totalMinor: 5000,
      currency: 'EUR',
      vendorId: fx.vendorId,
    })
    mkReceipt(fx.raw, fx.folderUser, {
      totalMinor: 2500,
      currency: 'CAD',
      vendorId: fx.vendorId,
    })

    const res = fx.repos.items.list({ folderId: fx.folderUser })
    const currencies = res.totals.byCurrency.map((c) => c.currency).sort()
    assert.deepEqual(currencies, ['CAD', 'EUR', 'USD'])

    const byCur = Object.fromEntries(
      res.totals.byCurrency.map((c) => [c.currency, c.totalMinor as number]),
    )
    assert.equal(byCur['USD'], 10000)
    assert.equal(byCur['EUR'], 5000)
    assert.equal(byCur['CAD'], 2500)

    // Never a single blended total field.
    assert.equal(
      (res.totals as { totalMinor?: number }).totalMinor,
      undefined,
      'must not expose a blended totalMinor',
    )
    const blended = res.totals.byCurrency.reduce((a, c) => a + (c.totalMinor as number), 0)
    assert.equal(blended, 17500) // only if you sum yourself — not a single currency figure
    assert.ok(res.totals.byCurrency.every((c) => typeof c.currency === 'string' && c.currency.length === 3))
  })

  // 3. bounded query count for 5,000 items
  it('3. list() issues a bounded query count for 5,000 seeded items', () => {
    const insertItem = fx.raw.prepare(
      `INSERT INTO item(folder_id, type, created_at, modified_at) VALUES (?, 'receipt', ?, ?)`,
    )
    const insertRd = fx.raw.prepare(
      `INSERT INTO receipt_data(item_id, txn_date, vendor_id, total_minor, currency, category_id)
       VALUES (?, '2026-01-01', ?, ?, 'USD', ?)`,
    )
    const seed = fx.raw.transaction(() => {
      for (let i = 0; i < 5000; i++) {
        const id = Number(insertItem.run(fx.folderUser, NOW, NOW).lastInsertRowid)
        insertRd.run(id, fx.vendorId, 100 + (i % 50), fx.categoryId)
      }
    })
    seed()

    fx.queryCount.reset()
    const res = fx.repos.items.list({ folderId: fx.folderUser, limit: 10_000 })
    const n = fx.queryCount.n

    assert.equal(res.total, 5000)
    assert.ok(res.rows.length === 5000)
    // No N+1: must stay well under a linear-per-row budget. Cap at 20 statements.
    assert.ok(
      n <= 20,
      `expected ≤20 queries for 5000 rows, got ${n} (N+1 regression)`,
    )
    assert.ok(n >= 1, 'should issue at least one query')
  })

  // 4. patch money parse
  it('4. patch "84.37" stores 8437; "abc" returns field error and writes nothing', () => {
    const id = mkReceipt(fx.raw, fx.folderUser, {
      totalMinor: 1000,
      vendorId: fx.vendorId,
      categoryId: fx.categoryId,
    })

    const ok = fx.repos.items.patch(id, { totalText: '84.37' })
    assert.equal(ok.ok, true)
    assert.deepEqual(ok.errors, {})
    const stored = (
      fx.raw.prepare(`SELECT total_minor FROM receipt_data WHERE item_id = ?`).get(id) as {
        total_minor: number
      }
    ).total_minor
    assert.equal(stored, 8437)

    const bad = fx.repos.items.patch(id, { totalText: 'abc' })
    assert.equal(bad.ok, false)
    assert.ok(bad.errors.totalText, 'expected totalText error')
    const after = (
      fx.raw.prepare(`SELECT total_minor FROM receipt_data WHERE item_id = ?`).get(id) as {
        total_minor: number
      }
    ).total_minor
    assert.equal(after, 8437, 'failed patch must not write')
  })

  // 5. patch new vendor creates list value
  it('5. patch on a new vendor name creates the vendor and reports createdListValues', () => {
    const id = mkReceipt(fx.raw, fx.folderUser, { totalMinor: 500 })
    const before = (
      fx.raw.prepare(`SELECT COUNT(*) AS c FROM vendor`).get() as { c: number }
    ).c

    const res = fx.repos.items.patch(id, { vendorName: 'Brand New Hardware Co' })
    assert.equal(res.ok, true)
    assert.ok(
      res.createdListValues.some(
        (v) => v.list === 'vendor' && v.name === 'Brand New Hardware Co',
      ),
      `expected createdListValues vendor entry, got ${JSON.stringify(res.createdListValues)}`,
    )
    const after = (
      fx.raw.prepare(`SELECT COUNT(*) AS c FROM vendor`).get() as { c: number }
    ).c
    assert.equal(after, before + 1)

    const row = fx.raw
      .prepare(
        `SELECT v.name FROM receipt_data r JOIN vendor v ON v.id = r.vendor_id WHERE r.item_id = ?`,
      )
      .get(id) as { name: string }
    assert.equal(row.name, 'Brand New Hardware Co')
  })

  // 6. vendor normalization
  it('6. vendor normalization: three spellings resolve to one vendor id', () => {
    const a = fx.repos.lists.upsertByName('vendor', 'Home Depot')
    const b = fx.repos.lists.upsertByName('vendor', 'HOME DEPOT')
    const c = fx.repos.lists.upsertByName('vendor', 'Home Depot.')

    assert.equal(a.id, b.id)
    assert.equal(b.id, c.id)
    assert.equal(a.created, false) // seeded in fixture as Home Depot
    assert.equal(b.created, false)
    assert.equal(c.created, false)

    assert.equal(normalizeVendorName('Home Depot.'), 'home depot')
    assert.equal(normalizeVendorName('HOME DEPOT'), 'home depot')

    const count = (
      fx.raw
        .prepare(`SELECT COUNT(*) AS c FROM vendor WHERE normalized_name = 'home depot'`)
        .get() as { c: number }
    ).c
    assert.equal(count, 1)
  })

  // 7. setOcrResult stale generation
  it('7. setOcrResult with stale generation returns applied:false and leaves row untouched', () => {
    const id = mkReceipt(fx.raw, fx.folderUser, { totalMinor: 100 })
    const pageId = fx.repos.pages.add({
      itemId: id,
      fileRelPath: 'images/x.jpg',
      contentHash: 'sha-x',
    }).pageId

    // generation defaults to 0; write a good result first
    const first = fx.repos.pages.setOcrResult(pageId, {
      text: 'ORIGINAL TEXT',
      words: [],
      confidence: 0.9,
      engine: 'test',
      generation: 0,
    })
    assert.equal(first.applied, true)

    // Bump generation (simulates crop / re-queue)
    fx.repos.pages.invalidateOcr(pageId)
    const gen = (
      fx.raw.prepare(`SELECT ocr_generation, ocr_text FROM page WHERE id = ?`).get(pageId) as {
        ocr_generation: number
        ocr_text: string | null
      }
    )
    assert.equal(gen.ocr_generation, 1)
    assert.equal(gen.ocr_text, null)

    // Set a known intermediate text at current generation, then try stale write
    fx.repos.pages.setOcrResult(pageId, {
      text: 'CURRENT',
      words: [],
      confidence: 0.8,
      engine: 'test',
      generation: 1,
    })

    const stale = fx.repos.pages.setOcrResult(pageId, {
      text: 'STALE CLOBBER',
      words: [],
      confidence: 0.99,
      engine: 'test',
      generation: 0, // stale
    })
    assert.equal(stale.applied, false)
    assert.ok(stale.reason)

    const row = fx.raw
      .prepare(`SELECT ocr_text, ocr_generation FROM page WHERE id = ?`)
      .get(pageId) as { ocr_text: string | null; ocr_generation: number }
    assert.equal(row.ocr_text, 'CURRENT')
    assert.equal(row.ocr_generation, 1)
  })

  // 8. rules respect pinned fields
  it('8. re-applying rules does not overwrite a pinned field; does fill an empty one', () => {
    const rules = [
      {
        id: 1,
        kind: 'vendor_to_category' as const,
        match: { vendorId: fx.vendorId },
        action: { categoryId: fx.categoryId },
        priority: 10,
        enabled: true,
      },
    ]

    // Empty category, not pinned → should propose
    const fill = applyRules({
      rules,
      candidate: { vendorId: fx.vendorId, categoryId: null },
      pinnedFields: [],
    })
    assert.equal(fill.proposals.length, 1)
    assert.equal(fill.proposals[0]?.field, 'categoryId')
    assert.equal(fill.proposals[0]?.value, fx.categoryId)
    assert.equal(fill.proposals[0]?.ruleId, 1)

    // Pinned category → must not propose even when empty
    const pinned = applyRules({
      rules,
      candidate: { vendorId: fx.vendorId, categoryId: null },
      pinnedFields: ['category'],
    })
    assert.equal(pinned.proposals.length, 0)

    // Already has a category → do not overwrite
    const existing = applyRules({
      rules,
      candidate: { vendorId: fx.vendorId, categoryId: 999 },
      pinnedFields: [],
    })
    assert.equal(existing.proposals.length, 0)

    // Fallback to vendor default when no rule matches
    const fallback = applyRules({
      rules: [],
      candidate: { vendorId: fx.vendorId, categoryId: null },
      pinnedFields: [],
      vendorDefaultCategoryId: fx.categoryId,
    })
    assert.equal(fallback.proposals.length, 1)
    assert.equal(fallback.proposals[0]?.ruleId, null)
    assert.equal(fallback.proposals[0]?.value, fx.categoryId)
  })

  // 9. reorder dense seq
  it('9. reorder produces dense sequential seq with no gaps or duplicates', () => {
    const id = mkReceipt(fx.raw, fx.folderUser, { totalMinor: 100 })
    const p1 = fx.repos.pages.add({ itemId: id, fileRelPath: 'images/a.jpg' }).pageId
    const p2 = fx.repos.pages.add({ itemId: id, fileRelPath: 'images/b.jpg' }).pageId
    const p3 = fx.repos.pages.add({ itemId: id, fileRelPath: 'images/c.jpg' }).pageId
    const p4 = fx.repos.pages.add({ itemId: id, fileRelPath: 'images/d.jpg' }).pageId

    // Reverse order
    const r = fx.repos.pages.reorder(id, [p4, p3, p2, p1])
    assert.equal(r.ok, true)

    const rows = fx.raw
      .prepare(`SELECT id, seq FROM page WHERE item_id = ? ORDER BY seq`)
      .all(id) as Array<{ id: number; seq: number }>

    assert.deepEqual(
      rows.map((x) => x.seq),
      [1, 2, 3, 4],
    )
    assert.deepEqual(
      rows.map((x) => x.id),
      [p4, p3, p2, p1],
    )
    const seqs = rows.map((x) => x.seq)
    assert.equal(new Set(seqs).size, seqs.length, 'no duplicate seq')
    assert.equal(Math.max(...seqs) - Math.min(...seqs) + 1, seqs.length, 'no gaps')
  })

  // 10. trash / restore round-trip
  it('10. trash then restore round-trips; absent from default list while trashed', () => {
    const id = mkReceipt(fx.raw, fx.folderUser, {
      totalMinor: 4200,
      vendorId: fx.vendorId,
    })

    const before = fx.repos.items.list({ folderId: fx.folderUser })
    assert.ok(before.rows.some((r) => r.itemId === id))
    assert.equal(
      before.totals.byCurrency.find((c) => c.currency === 'USD')?.totalMinor,
      4200,
    )

    const trashed = fx.repos.items.trash(id)
    assert.equal(trashed.ok, true)

    const mid = fx.repos.items.list({ folderId: fx.folderUser })
    assert.ok(!mid.rows.some((r) => r.itemId === id), 'trashed item absent from default list')
    assert.equal(mid.totals.byCurrency.length, 0)

    const inTrash = fx.repos.items.list({ smartFilter: 'trash' })
    assert.ok(inTrash.rows.some((r) => r.itemId === id))

    const restored = fx.repos.items.restore(id)
    assert.equal(restored.ok, true)

    const after = fx.repos.items.list({ folderId: fx.folderUser })
    assert.ok(after.rows.some((r) => r.itemId === id))
    assert.equal(
      after.totals.byCurrency.find((c) => c.currency === 'USD')?.totalMinor,
      4200,
    )
  })
})
