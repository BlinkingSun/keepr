/**
 * In-memory test DB for Lane I — same seed pattern as spikes/schema-verify.ts.
 */
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const schemaPath = join(here, '../../db/schema/001_initial.sql')
const schemaSql = readFileSync(schemaPath, 'utf8')

export const NOW = 1_753_900_000_000

export interface Fixture {
  db: InstanceType<typeof Database>
  folderUser: number
  folderInbox: number
  folderTrash: number
  vendorId: number
  categoryId: number
  taxCategoryId: number
  categoryFuelId: number
}

export function openFixture(): Fixture {
  const db = new Database(':memory:')
  db.exec(schemaSql)
  db.pragma('foreign_keys = ON')

  db.prepare(
    `INSERT INTO cabinet(id, display_name, base_currency, created_at, modified_at)
     VALUES (1, 'Test', 'USD', ?, ?)`,
  ).run(NOW, NOW)

  const folderInbox = Number(
    db
      .prepare(
        `INSERT INTO folder(kind, name, created_at, modified_at) VALUES ('inbox', 'Inbox', ?, ?)`,
      )
      .run(NOW, NOW).lastInsertRowid,
  )
  const folderUser = Number(
    db
      .prepare(
        `INSERT INTO folder(kind, name, created_at, modified_at) VALUES ('user', 'Materials', ?, ?)`,
      )
      .run(NOW, NOW).lastInsertRowid,
  )
  const folderTrash = Number(
    db
      .prepare(
        `INSERT INTO folder(kind, name, created_at, modified_at) VALUES ('trash', 'Trash', ?, ?)`,
      )
      .run(NOW, NOW).lastInsertRowid,
  )

  const categoryId = Number(
    db.prepare(`INSERT INTO category(name, created_at) VALUES ('Materials', ?)`).run(NOW)
      .lastInsertRowid,
  )
  const categoryFuelId = Number(
    db.prepare(`INSERT INTO category(name, created_at) VALUES ('Fuel', ?)`).run(NOW)
      .lastInsertRowid,
  )
  const taxCategoryId = Number(
    db.prepare(`INSERT INTO tax_category(name, created_at) VALUES ('Standard', ?)`).run(NOW)
      .lastInsertRowid,
  )
  const vendorId = Number(
    db
      .prepare(
        `INSERT INTO vendor(name, normalized_name, default_category_id, created_at)
         VALUES ('Home Depot', 'home depot', ?, ?)`,
      )
      .run(categoryId, NOW).lastInsertRowid,
  )

  return {
    db,
    folderUser,
    folderInbox,
    folderTrash,
    vendorId,
    categoryId,
    taxCategoryId,
    categoryFuelId,
  }
}

export function summableTotal(db: InstanceType<typeof Database>, currency = 'USD'): number {
  const row = db
    .prepare(
      `SELECT coalesce(sum(total_minor), 0) AS s FROM v_summable_receipts WHERE currency = ?`,
    )
    .get(currency) as { s: number }
  return row.s
}

export function summableTax(db: InstanceType<typeof Database>, currency = 'USD'): number {
  const row = db
    .prepare(
      `SELECT coalesce(sum(amount_minor), 0) AS s FROM v_summable_tax WHERE currency = ?`,
    )
    .get(currency) as { s: number }
  return row.s
}

export function itemCount(db: InstanceType<typeof Database>): number {
  const row = db.prepare(`SELECT count(*) AS c FROM item`).get() as { c: number }
  return row.c
}

/** Seed a $100.00 receipt with $8.25 tax and one page. */
export function seedOriginReceipt(
  fx: Fixture,
  opts: {
    totalMinor?: number
    taxMinor?: number
    hash?: string
    description?: string | null
    folderId?: number
  } = {},
): number {
  const { db, folderUser, vendorId, categoryId, taxCategoryId } = fx
  const total = opts.totalMinor ?? 10000
  const tax = opts.taxMinor ?? 825
  const folderId = opts.folderId ?? folderUser

  const itemId = Number(
    db
      .prepare(
        `INSERT INTO item(folder_id, type, created_at, modified_at)
         VALUES (?, 'receipt', ?, ?)`,
      )
      .run(folderId, NOW, NOW).lastInsertRowid,
  )

  db.prepare(
    `INSERT INTO receipt_data(
       item_id, txn_date, vendor_id, total_minor, currency, tax_total_minor,
       category_id, tax_category_id, description
     ) VALUES (?, '2026-07-12', ?, ?, 'USD', ?, ?, ?, ?)`,
  ).run(
    itemId,
    vendorId,
    total,
    tax,
    categoryId,
    taxCategoryId,
    opts.description ?? null,
  )

  if (tax !== 0) {
    db.prepare(
      `INSERT INTO receipt_tax_line(item_id, label, rate_bp, amount_minor, tax_category_id)
       VALUES (?, 'Sales Tax', 825, ?, ?)`,
    ).run(itemId, tax, taxCategoryId)
  }

  db.prepare(
    `INSERT INTO page(item_id, seq, file_relpath, content_hash, ocr_status, created_at)
     VALUES (?, 1, ?, ?, 'done', ?)`,
  ).run(itemId, `images/${itemId}.jpg`, opts.hash ?? 'sha-abc', NOW)

  return itemId
}

export function seedReceiptWithPage(
  fx: Fixture,
  opts: {
    totalMinor: number
    taxMinor?: number
    description?: string
    hash?: string
    vendorName?: string
  },
): number {
  return seedOriginReceipt(fx, {
    totalMinor: opts.totalMinor,
    taxMinor: opts.taxMinor ?? 0,
    description: opts.description ?? null,
    hash: opts.hash ?? `sha-${opts.totalMinor}`,
  })
}

export function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}
