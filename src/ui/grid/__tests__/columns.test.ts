/**
 * Column reorder and resize produce valid ColumnState[] with unique orders.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_COLUMNS,
  hasUniqueOrders,
  normalizeColumns,
  renameColumn,
  reorderColumns,
  resizeColumn,
  setColumnVisible,
  visibleColumns,
} from '../columns.ts'

describe('DEFAULT_COLUMNS', () => {
  it('has unique sequential orders', () => {
    assert.ok(hasUniqueOrders(DEFAULT_COLUMNS))
    const orders = DEFAULT_COLUMNS.map((c) => c.order).sort((a, b) => a - b)
    assert.deepEqual(
      orders,
      orders.map((_, i) => i),
    )
  })
})

describe('reorderColumns', () => {
  it('moves a column and renumbers uniquely', () => {
    const next = reorderColumns(DEFAULT_COLUMNS, 1, 4)
    assert.ok(hasUniqueOrders(next))
    const orders = next.map((c) => c.order)
    assert.equal(new Set(orders).size, next.length)
    // Every order 0..n-1 present.
    for (let i = 0; i < next.length; i++) {
      assert.ok(orders.includes(i), `missing order ${i}`)
    }
    // The column that was at order 1 is now at order 4.
    const movedKey = DEFAULT_COLUMNS.find((c) => c.order === 1)!.key
    assert.equal(next.find((c) => c.key === movedKey)!.order, 4)
  })

  it('no-op when from === to', () => {
    const next = reorderColumns(DEFAULT_COLUMNS, 2, 2)
    assert.equal(next.find((c) => c.order === 2)!.key, DEFAULT_COLUMNS.find((c) => c.order === 2)!.key)
  })
})

describe('resizeColumn', () => {
  it('updates width and keeps unique orders', () => {
    const next = resizeColumn(DEFAULT_COLUMNS, 'vendorName', 240)
    assert.ok(hasUniqueOrders(next))
    assert.equal(next.find((c) => c.key === 'vendorName')!.width, 240)
  })

  it('clamps to minimum width', () => {
    const next = resizeColumn(DEFAULT_COLUMNS, 'vendorName', 5)
    assert.ok(next.find((c) => c.key === 'vendorName')!.width >= 40)
  })
})

describe('setColumnVisible / rename / visibleColumns', () => {
  it('hides a column', () => {
    const next = setColumnVisible(DEFAULT_COLUMNS, 'paymentTypeName', false)
    assert.equal(next.find((c) => c.key === 'paymentTypeName')!.visible, false)
    const vis = visibleColumns(next)
    assert.ok(!vis.some((c) => c.key === 'paymentTypeName'))
  })

  it('renames a column', () => {
    const next = renameColumn(DEFAULT_COLUMNS, 'vendorName', 'Payee')
    assert.equal(next.find((c) => c.key === 'vendorName')!.label, 'Payee')
  })

  it('normalizeColumns renumbers', () => {
    const messy = DEFAULT_COLUMNS.map((c, i) => ({ ...c, order: i * 10 }))
    const n = normalizeColumns(messy)
    assert.ok(hasUniqueOrders(n))
    assert.deepEqual(
      n.map((c) => c.order),
      n.map((_, i) => i),
    )
  })
})
