/**
 * Lane I tests — every numbered acceptance from LANE-I-SPEC.md.
 * Run: node --experimental-strip-types --test src/splitting/__tests__/*.ts
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  openFixture,
  seedOriginReceipt,
  seedReceiptWithPage,
  summableTotal,
  summableTax,
  itemCount,
  errMessage,
  type Fixture,
} from './harness.ts'
import {
  splitReceipt,
  dissolveSplit,
  combineItems,
  separateItem,
} from '../index.ts'
import type { SplitPart } from '../../shared/ipc.ts'

describe('Lane I — split / dissolve / combine / separate', () => {
  let fx: Fixture

  beforeEach(() => {
    fx = openFixture()
  })

  // ── 1. 3-way split of $100.00 ──────────────────────────────────────────

  it('1. 3-way split of $100.00 → [3334,3333,3333], sumMinor === originTotalMinor', () => {
    const originId = seedOriginReceipt(fx)
    const parts: SplitPart[] = [{}, {}, {}]
    const result = splitReceipt(fx.db, originId, parts)

    assert.equal(result.originTotalMinor, 10000)
    assert.equal(result.sumMinor, 10000)
    assert.equal(result.sumMinor, result.originTotalMinor)
    assert.deepEqual(
      result.children.map((c) => c.totalMinor),
      [3334, 3333, 3333],
    )
  })

  // ── 2. Folder total unchanged ──────────────────────────────────────────

  it('2. folder total is unchanged by the split (v_summable_receipts, not doubled)', () => {
    const originId = seedOriginReceipt(fx)
    assert.equal(summableTotal(fx.db), 10000)

    splitReceipt(fx.db, originId, [{}, {}, {}])

    assert.equal(summableTotal(fx.db), 10000, 'summable total must stay 10000')
    // Naive sum of receipt_data would double-count (origin still holds 10000).
    const naive = (
      fx.db.prepare(`SELECT sum(total_minor) AS s FROM receipt_data`).get() as {
        s: number
      }
    ).s
    assert.equal(naive, 20000, 'sanity: raw receipt_data would show 20000')
  })

  // ── 3. Tax survives ────────────────────────────────────────────────────

  it('3. tax 825 splits to [275,275,275] and v_summable_tax still totals 825', () => {
    const originId = seedOriginReceipt(fx)
    assert.equal(summableTax(fx.db), 825)

    const result = splitReceipt(fx.db, originId, [{}, {}, {}])

    const childTaxes = result.children.map((c) => {
      const row = fx.db
        .prepare(`SELECT tax_total_minor FROM receipt_data WHERE item_id = ?`)
        .get(c.itemId) as { tax_total_minor: number | null }
      return row.tax_total_minor
    })
    assert.deepEqual(childTaxes, [275, 275, 275])
    assert.equal(summableTax(fx.db), 825, 'v_summable_tax must still total 825')
  })

  // ── 4. Shared content_hash via v_item_pages ────────────────────────────

  it('4. all children resolve the same content_hash through v_item_pages', () => {
    const originId = seedOriginReceipt(fx, { hash: 'sha-abc' })
    const result = splitReceipt(fx.db, originId, [{}, {}, {}])

    const hashes = result.children.map((c) => {
      const row = fx.db
        .prepare(
          `SELECT content_hash, via_split FROM v_item_pages WHERE item_id = ?`,
        )
        .get(c.itemId) as { content_hash: string; via_split: number }
      assert.equal(row.via_split, 1, 'child must cite via split')
      return row.content_hash
    })

    assert.equal(new Set(hashes).size, 1)
    assert.equal(hashes[0], 'sha-abc')
    assert.equal(result.imageSha256, 'sha-abc')

    // Children own no page rows.
    for (const c of result.children) {
      const n = (
        fx.db.prepare(`SELECT count(*) AS c FROM page WHERE item_id = ?`).get(c.itemId) as {
          c: number
        }
      ).c
      assert.equal(n, 0, 'child must not own page rows')
    }
  })

  // ── 5. Weighted splits ─────────────────────────────────────────────────

  it('5. weighted 60/40 of $100 → [6000,4000]; 1 cent across 3 weights sums to 1', () => {
    const a = seedOriginReceipt(fx, { totalMinor: 10000, taxMinor: 0 })
    const r60 = splitReceipt(fx.db, a, [{ weight: 60 }, { weight: 40 }])
    assert.deepEqual(
      r60.children.map((c) => c.totalMinor),
      [6000, 4000],
    )
    assert.equal(r60.sumMinor, 10000)

    const b = seedOriginReceipt(fx, { totalMinor: 1, taxMinor: 0, hash: 'sha-1cent' })
    // Remove default tax line path: taxMinor 0 still inserts nothing when 0.
    const r1 = splitReceipt(fx.db, b, [{ weight: 1 }, { weight: 1 }, { weight: 1 }])
    const sum = r1.children.reduce((s, c) => s + c.totalMinor, 0)
    assert.equal(sum, 1)
    assert.equal(r1.sumMinor, 1)
  })

  // ── 6. Reject bad part sum; DB unchanged ───────────────────────────────

  it('6. part list that does not sum to origin is rejected; database unchanged', () => {
    const originId = seedOriginReceipt(fx)
    const beforeItems = itemCount(fx.db)
    const beforeSum = summableTotal(fx.db)
    const beforeGroups = (
      fx.db.prepare(`SELECT count(*) AS c FROM split_group`).get() as { c: number }
    ).c

    assert.throws(
      () =>
        splitReceipt(fx.db, originId, [
          { amountText: '50.00' },
          { amountText: '30.00' },
        ]),
      (e: unknown) => {
        assert.match(errMessage(e), /sum|origin total/i)
        return true
      },
    )

    assert.equal(itemCount(fx.db), beforeItems)
    assert.equal(summableTotal(fx.db), beforeSum)
    assert.equal(
      (fx.db.prepare(`SELECT count(*) AS c FROM split_group`).get() as { c: number }).c,
      beforeGroups,
    )
    // Origin still summable with original amount.
    const origin = fx.db
      .prepare(`SELECT total_minor FROM v_summable_receipts WHERE item_id = ?`)
      .get(originId) as { total_minor: number } | undefined
    assert.equal(origin?.total_minor, 10000)
  })

  // ── 7. Dissolve restores origin ────────────────────────────────────────

  it('7. dissolve restores the origin to summable with its original amount', () => {
    const originId = seedOriginReceipt(fx)
    const result = splitReceipt(fx.db, originId, [{}, {}, {}])
    assert.equal(summableTotal(fx.db), 10000)

    // Origin is not summable while split.
    const during = fx.db
      .prepare(`SELECT total_minor FROM v_summable_receipts WHERE item_id = ?`)
      .get(originId) as { total_minor: number } | undefined
    assert.equal(during, undefined)

    dissolveSplit(fx.db, result.splitGroupId)

    const after = fx.db
      .prepare(`SELECT total_minor FROM v_summable_receipts WHERE item_id = ?`)
      .get(originId) as { total_minor: number } | undefined
    assert.equal(after?.total_minor, 10000)
    assert.equal(summableTotal(fx.db), 10000)
    assert.equal(summableTax(fx.db), 825)

    const flags = fx.db
      .prepare(`SELECT split_group_id, split_role, superseded_at FROM item WHERE id = ?`)
      .get(originId) as {
      split_group_id: number | null
      split_role: string | null
      superseded_at: number | null
    }
    assert.equal(flags.split_group_id, null)
    assert.equal(flags.split_role, null)
    assert.equal(flags.superseded_at, null)

    // No children remain.
    const kids = (
      fx.db
        .prepare(`SELECT count(*) AS c FROM item WHERE split_role = 'child'`)
        .get() as { c: number }
    ).c
    assert.equal(kids, 0)
  })

  // ── 8. Combine 3 → 1, separate restores fields ─────────────────────────

  it('8. combine 3 items into one 3-page item with correct seq; separate restores fields', () => {
    const a = seedReceiptWithPage(fx, {
      totalMinor: 1000,
      description: 'alpha-desc',
      hash: 'sha-a',
    })
    const b = seedReceiptWithPage(fx, {
      totalMinor: 2000,
      description: 'bravo-desc',
      hash: 'sha-b',
    })
    const c = seedReceiptWithPage(fx, {
      totalMinor: 3000,
      description: 'charlie-desc',
      hash: 'sha-c',
    })

    // Stash original field values for assertion after separate.
    const orig = [a, b, c].map((id) => {
      const r = fx.db
        .prepare(
          `SELECT total_minor, description FROM receipt_data WHERE item_id = ?`,
        )
        .get(id) as { total_minor: number; description: string }
      return { id, ...r }
    })

    const { itemId, mergeGroupId } = combineItems(fx.db, [a, b, c])
    assert.equal(itemId, a)
    assert.ok(mergeGroupId > 0)

    // Result has 3 pages with seq 1,2,3.
    const pages = fx.db
      .prepare(
        `SELECT id, seq, content_hash FROM page WHERE item_id = ? ORDER BY seq`,
      )
      .all(itemId) as Array<{ id: number; seq: number; content_hash: string }>
    assert.equal(pages.length, 3)
    assert.deepEqual(
      pages.map((p) => p.seq),
      [1, 2, 3],
    )
    assert.deepEqual(
      pages.map((p) => p.content_hash),
      ['sha-a', 'sha-b', 'sha-c'],
    )

    // Absorbed items soft-trashed.
    for (const id of [b, c]) {
      const row = fx.db
        .prepare(`SELECT trashed_at FROM item WHERE id = ?`)
        .get(id) as { trashed_at: number | null }
      assert.ok(row.trashed_at != null, `item ${id} should be soft-trashed`)
    }

    const sep = separateItem(fx.db, itemId)
    assert.equal(sep.itemIds.length, 3)
    assert.deepEqual(new Set(sep.itemIds), new Set([a, b, c]))

    // Original field values restored from snapshots.
    for (const o of orig) {
      const r = fx.db
        .prepare(
          `SELECT total_minor, description FROM receipt_data WHERE item_id = ?`,
        )
        .get(o.id) as { total_minor: number; description: string }
      assert.equal(r.total_minor, o.total_minor, `total for ${o.id}`)
      assert.equal(r.description, o.description, `description for ${o.id}`)

      const item = fx.db
        .prepare(`SELECT trashed_at FROM item WHERE id = ?`)
        .get(o.id) as { trashed_at: number | null }
      assert.equal(item.trashed_at, null, `item ${o.id} should be live again`)
    }

    // Pages re-homed with original seq.
    for (const o of orig) {
      const p = fx.db
        .prepare(
          `SELECT seq, content_hash FROM page WHERE item_id = ? ORDER BY seq`,
        )
        .all(o.id) as Array<{ seq: number; content_hash: string }>
      assert.equal(p.length, 1)
      assert.equal(p[0]?.seq, 1)
    }

    // Merge group gone.
    const mg = fx.db
      .prepare(`SELECT count(*) AS c FROM merge_group WHERE id = ?`)
      .get(mergeGroupId) as { c: number }
    assert.equal(mg.c, 0)
  })

  // ── 9. Split × combine mutual exclusion (trigger messages) ─────────────

  it('9. splitting a combined item is refused; combining a split item is refused', () => {
    // Combine two items, then try to split the result.
    const x = seedReceiptWithPage(fx, { totalMinor: 5000, hash: 'sha-x' })
    const y = seedReceiptWithPage(fx, { totalMinor: 5000, hash: 'sha-y' })
    const { itemId: combinedId } = combineItems(fx.db, [x, y])

    assert.throws(
      () => splitReceipt(fx.db, combinedId, [{}, {}]),
      (e: unknown) => {
        const msg = errMessage(e)
        assert.match(
          msg,
          /separate this combined item before splitting it/,
          `expected trigger message, got: ${msg}`,
        )
        return true
      },
    )

    // Split an item, then try to combine it with another.
    const s = seedOriginReceipt(fx, { totalMinor: 8000, taxMinor: 0, hash: 'sha-s' })
    const t = seedReceiptWithPage(fx, { totalMinor: 2000, hash: 'sha-t' })
    splitReceipt(fx.db, s, [{}, {}])

    // Combining where the result (first id) is a split origin.
    assert.throws(
      () => combineItems(fx.db, [s, t]),
      (e: unknown) => {
        const msg = errMessage(e)
        assert.match(
          msg,
          /cannot combine into an item that is part of a split/,
          `expected trigger/guard message, got: ${msg}`,
        )
        return true
      },
    )

    // Also refuse when a non-result input is part of a split.
    const u = seedReceiptWithPage(fx, { totalMinor: 1500, hash: 'sha-u' })
    const child = (
      fx.db
        .prepare(
          `SELECT id FROM item WHERE split_role = 'child' ORDER BY id LIMIT 1`,
        )
        .get() as { id: number }
    ).id
    assert.throws(
      () => combineItems(fx.db, [u, child]),
      (e: unknown) => {
        const msg = errMessage(e)
        assert.match(msg, /part of a split/)
        return true
      },
    )
  })

  // ── 10. Concurrent second split does not produce two groups ────────────

  it('10. a concurrent second split of the same origin does not produce two split groups', () => {
    const originId = seedOriginReceipt(fx)
    const first = splitReceipt(fx.db, originId, [{}, {}, {}])
    assert.equal(first.splitGroupId > 0, true)

    assert.throws(
      () => splitReceipt(fx.db, originId, [{}, {}]),
      (e: unknown) => {
        const msg = errMessage(e)
        assert.match(msg, /already part of a split|already has a split group/)
        return true
      },
    )

    const groups = (
      fx.db
        .prepare(`SELECT count(*) AS c FROM split_group WHERE origin_item_id = ?`)
        .get(originId) as { c: number }
    ).c
    assert.equal(groups, 1, 'exactly one split group for the origin')

    const children = (
      fx.db
        .prepare(
          `SELECT count(*) AS c FROM item WHERE split_group_id = ? AND split_role = 'child'`,
        )
        .get(first.splitGroupId) as { c: number }
    ).c
    assert.equal(children, 3)
  })

  // ── reconciliation assert inside transaction ───────────────────────────

  it('v_split_reconciliation shows zero drift after a legal split', () => {
    const originId = seedOriginReceipt(fx)
    const result = splitReceipt(fx.db, originId, [{}, {}, {}])
    const recon = fx.db
      .prepare(`SELECT * FROM v_split_reconciliation WHERE split_group_id = ?`)
      .get(result.splitGroupId) as {
      drift_minor: number
      tax_drift_minor: number
      currency_mismatch_count: number
      child_count: number
    }
    assert.equal(recon.drift_minor, 0)
    assert.equal(recon.tax_drift_minor, 0)
    assert.equal(recon.currency_mismatch_count, 0)
    assert.equal(recon.child_count, 3)
  })

  it('explicit amount parts allocate tax proportionally and recon stays clean', () => {
    const originId = seedOriginReceipt(fx) // 10000 + tax 825
    const result = splitReceipt(fx.db, originId, [
      { amountText: '60.00' },
      { amountText: '40.00' },
    ])
    assert.deepEqual(
      result.children.map((c) => c.totalMinor),
      [6000, 4000],
    )
    assert.equal(result.sumMinor, 10000)

    const childTaxes = result.children.map((c) => {
      const row = fx.db
        .prepare(`SELECT tax_total_minor FROM receipt_data WHERE item_id = ?`)
        .get(c.itemId) as { tax_total_minor: number }
      return row.tax_total_minor
    })
    // 825 * 60/100 = 495, 825 * 40/100 = 330
    assert.deepEqual(childTaxes, [495, 330])
    assert.equal(childTaxes.reduce((a, b) => a + b, 0), 825)
    assert.equal(summableTax(fx.db), 825)
    assert.equal(summableTotal(fx.db), 10000)
  })
})
