/**
 * Shared test harness: in-memory DB from 001_initial.sql, seed helpers,
 * and a query-counting wrapper for the N+1 guard.
 */
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Database as KeeprDb, Statement } from '../types.ts'
import { createRepositories, type Repositories } from '../index.ts'
import { allocate, asMinor } from '../../../shared/types.ts'

const here = dirname(fileURLToPath(import.meta.url))
const schemaPath = join(here, '../../schema/001_initial.sql')
const schemaSql = readFileSync(schemaPath, 'utf8')

export const NOW = 1_753_900_000_000

export interface Fixture {
  raw: InstanceType<typeof Database>
  db: KeeprDb
  repos: Repositories
  /** Query execution counter (run/get/all). */
  queryCount: { n: number; reset: () => void }
  folderUser: number
  folderInbox: number
  folderTrash: number
  vendorId: number
  categoryId: number
  taxCategoryId: number
}

function wrapCounting(raw: InstanceType<typeof Database>): {
  db: KeeprDb
  queryCount: { n: number; reset: () => void }
} {
  const counter = { n: 0, reset: () => { counter.n = 0 } }
  const origPrepare = raw.prepare.bind(raw)
  raw.prepare = ((sql: string) => {
    const stmt = origPrepare(sql)
    const wrap = (method: 'run' | 'get' | 'all') => {
      const orig = stmt[method].bind(stmt)
      return (...args: unknown[]) => {
        counter.n++
        return orig(...args)
      }
    }
    stmt.run = wrap('run') as typeof stmt.run
    stmt.get = wrap('get') as typeof stmt.get
    stmt.all = wrap('all') as typeof stmt.all
    return stmt
  }) as typeof raw.prepare
  return { db: raw as unknown as KeeprDb, queryCount: counter }
}

export function openFixture(): Fixture {
  const raw = new Database(':memory:')
  raw.exec(schemaSql)
  raw.pragma('foreign_keys = ON')
  const { db, queryCount } = wrapCounting(raw)

  raw
    .prepare(
      `INSERT INTO cabinet(id, display_name, base_currency, created_at, modified_at)
       VALUES (1, 'Test', 'USD', ?, ?)`,
    )
    .run(NOW, NOW)

  const inbox = Number(
    raw
      .prepare(
        `INSERT INTO folder(kind, name, created_at, modified_at) VALUES ('inbox', 'Inbox', ?, ?)`,
      )
      .run(NOW, NOW).lastInsertRowid,
  )
  const user = Number(
    raw
      .prepare(
        `INSERT INTO folder(kind, name, created_at, modified_at) VALUES ('user', 'Materials', ?, ?)`,
      )
      .run(NOW, NOW).lastInsertRowid,
  )
  const trash = Number(
    raw
      .prepare(
        `INSERT INTO folder(kind, name, created_at, modified_at) VALUES ('trash', 'Trash', ?, ?)`,
      )
      .run(NOW, NOW).lastInsertRowid,
  )

  const categoryId = Number(
    raw.prepare(`INSERT INTO category(name, created_at) VALUES ('Materials', ?)`).run(NOW)
      .lastInsertRowid,
  )
  const taxCategoryId = Number(
    raw.prepare(`INSERT INTO tax_category(name, created_at) VALUES ('Standard', ?)`).run(NOW)
      .lastInsertRowid,
  )
  const vendorId = Number(
    raw
      .prepare(
        `INSERT INTO vendor(name, normalized_name, default_category_id, created_at)
         VALUES ('Home Depot', 'home depot', ?, ?)`,
      )
      .run(categoryId, NOW).lastInsertRowid,
  )

  const repos = createRepositories({ db })

  return {
    raw,
    db,
    repos,
    queryCount,
    folderUser: user,
    folderInbox: inbox,
    folderTrash: trash,
    vendorId,
    categoryId,
    taxCategoryId,
  }
}

export function mkItem(
  raw: InstanceType<typeof Database>,
  folderId: number,
  type = 'receipt',
  extra: { sg?: number | null; role?: string | null; sup?: number | null; trashed?: number | null } = {},
): number {
  return Number(
    raw
      .prepare(
        `INSERT INTO item(folder_id, type, split_group_id, split_role, superseded_at, trashed_at, created_at, modified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        folderId,
        type,
        extra.sg ?? null,
        extra.role ?? null,
        extra.sup ?? null,
        extra.trashed ?? null,
        NOW,
        NOW,
      ).lastInsertRowid,
  )
}

/** Seed a receipt with optional total/currency/tax. */
export function mkReceipt(
  raw: InstanceType<typeof Database>,
  folderId: number,
  opts: {
    totalMinor?: number | null
    taxMinor?: number | null
    currency?: string
    vendorId?: number | null
    categoryId?: number | null
    taxCategoryId?: number | null
    txnDate?: string | null
    sg?: number | null
    role?: string | null
    sup?: number | null
  } = {},
): number {
  const id = mkItem(raw, folderId, 'receipt', {
    sg: opts.sg,
    role: opts.role,
    sup: opts.sup,
  })
  raw
    .prepare(
      `INSERT INTO receipt_data(item_id, txn_date, vendor_id, total_minor, currency, tax_total_minor, category_id, tax_category_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      opts.txnDate ?? '2026-07-12',
      opts.vendorId ?? null,
      opts.totalMinor ?? null,
      opts.currency ?? 'USD',
      opts.taxMinor ?? null,
      opts.categoryId ?? null,
      opts.taxCategoryId ?? null,
    )
  return id
}

/** Perform a 3-way split of $100.00 like schema-verify, using real allocate(). */
export function seedSplitReceipt(fx: Fixture): {
  originId: number
  childIds: number[]
  splitGroupId: number
  originTotal: number
} {
  const { raw, folderUser, vendorId, categoryId, taxCategoryId } = fx
  const originTotal = 10000
  const taxTotal = 825
  const originId = mkReceipt(raw, folderUser, {
    totalMinor: originTotal,
    taxMinor: taxTotal,
    vendorId,
    categoryId,
    taxCategoryId,
  })
  raw
    .prepare(
      `INSERT INTO receipt_tax_line(item_id, label, rate_bp, amount_minor, tax_category_id)
       VALUES (?, 'Sales Tax', 825, ?, ?)`,
    )
    .run(originId, taxTotal, taxCategoryId)
  raw
    .prepare(
      `INSERT INTO page(item_id, seq, file_relpath, content_hash, ocr_status, created_at)
       VALUES (?, 1, 'images/o1.jpg', 'sha-abc', 'done', ?)`,
    )
    .run(originId, NOW)
  const pageId = (
    raw.prepare(`SELECT id FROM page WHERE item_id = ?`).get(originId) as { id: number }
  ).id

  const parts = allocate(asMinor(originTotal), 3)
  const taxParts = allocate(asMinor(taxTotal), 3)
  const sg = Number(
    raw
      .prepare(
        `INSERT INTO split_group(origin_item_id, origin_page_id, origin_total_minor, origin_tax_minor, currency, created_at)
         VALUES (?, ?, ?, ?, 'USD', ?)`,
      )
      .run(originId, pageId, originTotal, taxTotal, NOW).lastInsertRowid,
  )
  raw
    .prepare(
      `UPDATE item SET split_group_id = ?, split_role = 'origin', superseded_at = ? WHERE id = ?`,
    )
    .run(sg, NOW, originId)

  const childIds = parts.map((p, i) => {
    const id = mkReceipt(raw, folderUser, {
      totalMinor: p,
      taxMinor: taxParts[i],
      vendorId,
      categoryId: i === 0 ? categoryId : categoryId,
      taxCategoryId,
      sg,
      role: 'child',
    })
    raw
      .prepare(
        `INSERT INTO receipt_tax_line(item_id, label, rate_bp, amount_minor, tax_category_id)
         VALUES (?, 'Sales Tax', 825, ?, ?)`,
      )
      .run(id, taxParts[i], taxCategoryId)
    return id
  })

  return { originId, childIds, splitGroupId: sg, originTotal }
}

export type { Statement }
