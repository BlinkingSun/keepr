/**
 * Lane H search tests.
 * Run: node --experimental-strip-types --test src/search/__tests__/search.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  openFixture,
  mkReceipt,
  mkPage,
  mkItem,
  type SearchFixture,
} from './harness.ts'
import {
  search,
  missingKeyData,
  buildFtsMatch,
  SearchQueryError,
} from '../index.ts'
import { asMinor, asCivilDate } from '../../shared/types.ts'

function ids(result: { hits: Array<{ itemId: number }> }): number[] {
  return result.hits.map((h) => h.itemId)
}

describe('Lane H — search', () => {
  // 1. Token present ONLY in ocr_text is found.
  it('1: finds a token present only in ocr_text', () => {
    const fx = openFixture()
    const id = mkReceipt(fx.raw, fx.folderUser, {
      vendorId: fx.vendorId,
      totalMinor: 1000,
      categoryId: fx.categoryId,
      taxCategoryId: fx.taxCategoryId,
    })
    mkPage(fx.raw, id, 1, 'RECEIPT zzocronlytoken TOTAL 10.00')

    // Ensure the token is not in item_fts
    const fieldHits = fx.raw
      .prepare(`SELECT count(*) AS c FROM item_fts WHERE item_fts MATCH ?`)
      .get('"zzocronlytoken"') as { c: number }
    assert.equal(fieldHits.c, 0)

    const result = search(fx.raw, { q: 'zzocronlytoken' })
    assert.equal(result.total, 1)
    assert.deepEqual(ids(result), [id])
    assert.equal(result.hits[0]?.matchedIn.ocrText, true)
    assert.equal(result.hits[0]?.matchedIn.fields, false)
  })

  // 2. Trashed OCR token NOT found by default; IS with includeTrashed.
  it('2: trashed item OCR is hidden by default and found with includeTrashed', () => {
    const fx = openFixture()
    const live = mkReceipt(fx.raw, fx.folderUser, {
      vendorId: fx.vendorId,
      totalMinor: 500,
      categoryId: fx.categoryId,
      taxCategoryId: fx.taxCategoryId,
    })
    mkPage(fx.raw, live, 1, 'live zztrashprobe token')

    const trashed = mkReceipt(fx.raw, fx.folderUser, {
      vendorId: fx.vendorId,
      totalMinor: 600,
      categoryId: fx.categoryId,
      taxCategoryId: fx.taxCategoryId,
      trashed: Date.now(),
    })
    mkPage(fx.raw, trashed, 1, 'trashed zztrashprobe token')

    // Raw page_fts still indexes the trashed row (schema invariant).
    const rawFts = fx.raw
      .prepare(`SELECT count(*) AS c FROM page_fts WHERE page_fts MATCH ?`)
      .get('"zztrashprobe"') as { c: number }
    assert.equal(rawFts.c, 2)

    const def = search(fx.raw, { q: 'zztrashprobe' })
    assert.equal(def.total, 1)
    assert.deepEqual(ids(def), [live])

    const withTrash = search(fx.raw, { q: 'zztrashprobe', includeTrashed: true })
    assert.equal(withTrash.total, 2)
    assert.ok(ids(withTrash).includes(live))
    assert.ok(ids(withTrash).includes(trashed))
  })

  // 3. Item matching in both indexes appears once.
  it('3: dual-index match appears once, not twice', () => {
    const fx = openFixture()
    const id = mkReceipt(fx.raw, fx.folderUser, {
      vendorId: fx.vendorStaples,
      totalMinor: 1200,
      categoryId: fx.categoryId,
      taxCategoryId: fx.taxCategoryId,
      description: 'Office staples order',
    })
    mkPage(fx.raw, id, 1, 'Thank you for shopping at Staples today')

    const result = search(fx.raw, { q: 'Staples' })
    assert.equal(result.total, 1)
    assert.equal(result.hits.length, 1)
    assert.equal(result.hits[0]?.itemId, id)
    assert.equal(result.hits[0]?.matchedIn.ocrText, true)
    assert.equal(result.hits[0]?.matchedIn.fields, true)
  })

  // 4. Multi-page item matching on two pages appears once.
  it('4: multi-page item collapses to one hit', () => {
    const fx = openFixture()
    const id = mkReceipt(fx.raw, fx.folderUser, {
      vendorId: fx.vendorId,
      totalMinor: 2000,
      categoryId: fx.categoryId,
      taxCategoryId: fx.taxCategoryId,
    })
    mkPage(fx.raw, id, 1, 'page one has zzmultipagetoken here')
    mkPage(fx.raw, id, 2, 'page two also has zzmultipagetoken again')

    const pageHits = fx.raw
      .prepare(
        `SELECT count(*) AS c FROM page_fts f
           JOIN v_searchable_pages sp ON sp.page_id = f.rowid
          WHERE page_fts MATCH ?`,
      )
      .get('"zzmultipagetoken"') as { c: number }
    assert.equal(pageHits.c, 2)

    const result = search(fx.raw, { q: 'zzmultipagetoken' })
    assert.equal(result.total, 1)
    assert.equal(result.hits.length, 1)
    assert.equal(result.hits[0]?.itemId, id)
    assert.equal(result.hits[0]?.matchedIn.ocrText, true)
  })

  // 5. Combined filters: date + amount + vendor.
  it('5: combined date, amount, and vendor filters narrow correctly', () => {
    const fx = openFixture()

    const match = mkReceipt(fx.raw, fx.folderUser, {
      vendorId: fx.vendorId,
      totalMinor: 5000,
      txnDate: '2026-07-15',
      categoryId: fx.categoryId,
      taxCategoryId: fx.taxCategoryId,
    })
    mkPage(fx.raw, match, 1, 'filtercombo receipt')

    // Wrong vendor
    mkReceipt(fx.raw, fx.folderUser, {
      vendorId: fx.vendorStaples,
      totalMinor: 5000,
      txnDate: '2026-07-15',
      categoryId: fx.categoryId,
      taxCategoryId: fx.taxCategoryId,
    })
    // Wrong date
    mkReceipt(fx.raw, fx.folderUser, {
      vendorId: fx.vendorId,
      totalMinor: 5000,
      txnDate: '2026-01-01',
      categoryId: fx.categoryId,
      taxCategoryId: fx.taxCategoryId,
    })
    // Wrong amount
    mkReceipt(fx.raw, fx.folderUser, {
      vendorId: fx.vendorId,
      totalMinor: 100,
      txnDate: '2026-07-15',
      categoryId: fx.categoryId,
      taxCategoryId: fx.taxCategoryId,
    })

    const result = search(fx.raw, {
      dateFrom: asCivilDate('2026-07-01'),
      dateTo: asCivilDate('2026-07-31'),
      amountMinMinor: asMinor(4000),
      amountMaxMinor: asMinor(6000),
      vendorId: fx.vendorId,
    })
    assert.equal(result.total, 1)
    assert.deepEqual(ids(result), [match])
  })

  // 6. missing=vendor,total returns exactly the incomplete fixtures.
  it('6: missing=vendor,total returns only incomplete fixtures', () => {
    const fx = openFixture()

    // Complete — not missing
    mkReceipt(fx.raw, fx.folderUser, {
      vendorId: fx.vendorId,
      totalMinor: 1000,
      categoryId: fx.categoryId,
      taxCategoryId: fx.taxCategoryId,
    })

    // Missing vendor only
    const missVendor = mkReceipt(fx.raw, fx.folderUser, {
      vendorId: null,
      totalMinor: 2000,
      categoryId: fx.categoryId,
      taxCategoryId: fx.taxCategoryId,
    })

    // Missing total only
    const missTotal = mkReceipt(fx.raw, fx.folderUser, {
      vendorId: fx.vendorId,
      totalMinor: null,
      categoryId: fx.categoryId,
      taxCategoryId: fx.taxCategoryId,
    })

    // Missing both vendor and total — should match missing=[vendor,total]
    const missBoth = mkReceipt(fx.raw, fx.folderUser, {
      vendorId: null,
      totalMinor: null,
      categoryId: fx.categoryId,
      taxCategoryId: fx.taxCategoryId,
    })

    // Missing category only — not vendor+total
    mkReceipt(fx.raw, fx.folderUser, {
      vendorId: fx.vendorId,
      totalMinor: 3000,
      categoryId: null,
      taxCategoryId: fx.taxCategoryId,
    })

    const result = search(fx.raw, { missing: ['vendor', 'total'] })
    assert.deepEqual(ids(result).sort((a, b) => a - b), [missBoth].sort((a, b) => a - b))
    assert.equal(result.total, 1)

    // missingKeyData returns all incomplete via the view
    const missing = missingKeyData(fx.raw)
    const missingIds = missing.map((r) => r.itemId).sort((a, b) => a - b)
    assert.ok(missingIds.includes(missVendor))
    assert.ok(missingIds.includes(missTotal))
    assert.ok(missingIds.includes(missBoth))
    // Complete receipt must not appear
    const completeRows = missing.filter(
      (r) => !r.missingVendor && !r.missingDate && !r.missingTotal &&
        !r.missingCategory && !r.missingTaxCategory,
    )
    assert.equal(completeRows.length, 0)
  })

  // 7. Special FTS syntax does not throw SQLite exceptions.
  it('7: quotes, stars, and boolean operators never throw raw exceptions', () => {
    const fx = openFixture()
    const id = mkReceipt(fx.raw, fx.folderUser, {
      vendorId: fx.vendorId,
      totalMinor: 100,
      categoryId: fx.categoryId,
      taxCategoryId: fx.taxCategoryId,
    })
    mkPage(fx.raw, id, 1, 'AND OR NOT specials')

    // Bare quote — escaped / empty, must not throw
    assert.doesNotThrow(() => search(fx.raw, { q: '"' }))
    const qQuote = search(fx.raw, { q: '"' })
    assert.ok(qQuote.hits !== undefined)
    assert.equal(typeof qQuote.total, 'number')

    // Bare * — clean SearchQueryError, not a SQLite exception
    assert.throws(
      () => search(fx.raw, { q: '*' }),
      (e: unknown) => e instanceof SearchQueryError && /wildcard|Bare \*/i.test(e.message),
    )

    // Boolean operators as user terms — quoted, must not throw
    assert.doesNotThrow(() => search(fx.raw, { q: 'AND OR NOT' }))
    const boolResult = search(fx.raw, { q: 'AND OR NOT' })
    assert.ok(Array.isArray(boolResult.hits))

    // Leading wildcard rejected with clear reason
    assert.throws(
      () => search(fx.raw, { q: '*home' }),
      (e: unknown) => e instanceof SearchQueryError && /Leading wildcards/i.test(e.message),
    )

    // Trailing wildcard allowed
    assert.doesNotThrow(() => search(fx.raw, { q: 'Home*' }))
  })

  // 8. limit sets truncated: true; total is the true count.
  it('8: limit sets truncated true and total reflects true count', () => {
    const fx = openFixture()
    for (let n = 0; n < 5; n++) {
      const id = mkReceipt(fx.raw, fx.folderUser, {
        vendorId: fx.vendorId,
        totalMinor: 100 + n,
        categoryId: fx.categoryId,
        taxCategoryId: fx.taxCategoryId,
        description: `zzlimitprobe item ${n}`,
      })
      mkPage(fx.raw, id, 1, `zzlimitprobe page ${n}`)
    }

    const result = search(fx.raw, { q: 'zzlimitprobe', limit: 2 })
    assert.equal(result.hits.length, 2)
    assert.equal(result.total, 5)
    assert.equal(result.truncated, true)

    const full = search(fx.raw, { q: 'zzlimitprobe', limit: 100 })
    assert.equal(full.hits.length, 5)
    assert.equal(full.total, 5)
    assert.equal(full.truncated, false)
  })

  // 9. Vendor field hit outranks incidental OCR occurrence.
  it('9: vendor field match outranks incidental OCR match', () => {
    const fx = openFixture()

    // Field hit: vendor is "Staples"
    const fieldItem = mkReceipt(fx.raw, fx.folderUser, {
      vendorId: fx.vendorStaples,
      totalMinor: 999,
      categoryId: fx.categoryId,
      taxCategoryId: fx.taxCategoryId,
      description: 'paper clips',
    })
    mkPage(fx.raw, fieldItem, 1, 'Thank you for your purchase today total 9.99')

    // OCR-only incidental: different vendor, token once in OCR body
    const ocrItem = mkReceipt(fx.raw, fx.folderUser, {
      vendorId: fx.vendorId,
      totalMinor: 888,
      categoryId: fx.categoryId,
      taxCategoryId: fx.taxCategoryId,
      description: 'lumber',
    })
    mkPage(fx.raw, ocrItem, 1, 'Note: rival store Staples is cheaper on pens')

    const result = search(fx.raw, { q: 'Staples' })
    assert.equal(result.total, 2)
    assert.equal(result.hits.length, 2)
    assert.equal(result.hits[0]?.itemId, fieldItem, 'field hit must rank first')
    assert.equal(result.hits[1]?.itemId, ocrItem)
    assert.ok(
      (result.hits[0]?.score ?? 0) > (result.hits[1]?.score ?? 0),
      `expected field score > ocr score, got ${result.hits[0]?.score} vs ${result.hits[1]?.score}`,
    )
    assert.equal(result.hits[0]?.matchedIn.fields, true)
    assert.equal(result.hits[1]?.matchedIn.fields, false)
    assert.equal(result.hits[1]?.matchedIn.ocrText, true)
  })

  // Extra: fts builder unit checks
  it('buildFtsMatch quotes operators and allows trailing *', () => {
    assert.deepEqual(buildFtsMatch('AND OR NOT'), {
      ok: true,
      match: '"AND" "OR" "NOT"',
    })
    assert.deepEqual(buildFtsMatch('home*'), { ok: true, match: '"home"*' })
    assert.equal(buildFtsMatch('*x').ok, false)
    assert.equal(buildFtsMatch('*').ok, false)
    assert.deepEqual(buildFtsMatch('"'), { ok: true, match: '' })
  })

  // Extra: folder + subfolders filter
  it('folder filter with includeSubfolders walks the tree', () => {
    const fx = openFixture()
    const inParent = mkReceipt(fx.raw, fx.folderUser, {
      vendorId: fx.vendorId,
      totalMinor: 100,
      categoryId: fx.categoryId,
      taxCategoryId: fx.taxCategoryId,
    })
    const inChild = mkReceipt(fx.raw, fx.folderChild, {
      vendorId: fx.vendorId,
      totalMinor: 200,
      categoryId: fx.categoryId,
      taxCategoryId: fx.taxCategoryId,
    })
    const inInbox = mkReceipt(fx.raw, fx.folderInbox, {
      vendorId: fx.vendorId,
      totalMinor: 300,
      categoryId: fx.categoryId,
      taxCategoryId: fx.taxCategoryId,
    })

    const onlyParent = search(fx.raw, { folderId: fx.folderUser })
    assert.deepEqual(ids(onlyParent).sort((a, b) => a - b), [inParent])

    const withSub = search(fx.raw, {
      folderId: fx.folderUser,
      includeSubfolders: true,
    })
    assert.deepEqual(
      ids(withSub).sort((a, b) => a - b),
      [inParent, inChild].sort((a, b) => a - b),
    )
    assert.ok(!ids(withSub).includes(inInbox))
  })

  // Extra: missingKeyData folder scope
  it('missingKeyData respects folderId', () => {
    const fx = openFixture()
    const a = mkReceipt(fx.raw, fx.folderUser, {
      vendorId: null,
      totalMinor: null,
      categoryId: fx.categoryId,
      taxCategoryId: fx.taxCategoryId,
    })
    const b = mkReceipt(fx.raw, fx.folderChild, {
      vendorId: null,
      totalMinor: null,
      categoryId: fx.categoryId,
      taxCategoryId: fx.taxCategoryId,
    })
    const scoped = missingKeyData(fx.raw, fx.folderUser)
    assert.deepEqual(
      scoped.map((r) => r.itemId),
      [a],
    )
    assert.ok(!scoped.some((r) => r.itemId === b))
  })
})
