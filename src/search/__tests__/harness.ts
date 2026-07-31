/**
 * In-memory DB for Lane H tests — same pattern as spikes/schema-verify.ts.
 */
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const schemaSql = readFileSync(join(here, '../../db/schema/001_initial.sql'), 'utf8')

export const NOW = 1_753_900_000_000

export interface SearchFixture {
  raw: InstanceType<typeof Database>
  folderInbox: number
  folderUser: number
  folderChild: number
  folderTrash: number
  vendorId: number
  vendorStaples: number
  categoryId: number
  taxCategoryId: number
  projectId: number
}

export function openFixture(): SearchFixture {
  const raw = new Database(':memory:')
  raw.exec(schemaSql)
  raw.pragma('foreign_keys = ON')

  raw
    .prepare(
      `INSERT INTO cabinet(id, display_name, base_currency, created_at, modified_at)
       VALUES (1, 'Test', 'USD', ?, ?)`,
    )
    .run(NOW, NOW)

  const folderInbox = Number(
    raw
      .prepare(
        `INSERT INTO folder(kind, name, created_at, modified_at) VALUES ('inbox', 'Inbox', ?, ?)`,
      )
      .run(NOW, NOW).lastInsertRowid,
  )
  const folderUser = Number(
    raw
      .prepare(
        `INSERT INTO folder(kind, name, created_at, modified_at) VALUES ('user', 'Materials', ?, ?)`,
      )
      .run(NOW, NOW).lastInsertRowid,
  )
  const folderChild = Number(
    raw
      .prepare(
        `INSERT INTO folder(parent_id, kind, name, created_at, modified_at)
         VALUES (?, 'user', 'Subfolder', ?, ?)`,
      )
      .run(folderUser, NOW, NOW).lastInsertRowid,
  )
  const folderTrash = Number(
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
  const projectId = Number(
    raw.prepare(`INSERT INTO project(name, created_at) VALUES ('Job-42', ?)`).run(NOW)
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
  const vendorStaples = Number(
    raw
      .prepare(
        `INSERT INTO vendor(name, normalized_name, default_category_id, created_at)
         VALUES ('Staples', 'staples', ?, ?)`,
      )
      .run(categoryId, NOW).lastInsertRowid,
  )

  return {
    raw,
    folderInbox,
    folderUser,
    folderChild,
    folderTrash,
    vendorId,
    vendorStaples,
    categoryId,
    taxCategoryId,
    projectId,
  }
}

export function mkItem(
  raw: InstanceType<typeof Database>,
  folderId: number,
  type = 'receipt',
  extra: { trashed?: number | null; reviewed?: number | null } = {},
): number {
  return Number(
    raw
      .prepare(
        `INSERT INTO item(folder_id, type, trashed_at, reviewed_at, created_at, modified_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(folderId, type, extra.trashed ?? null, extra.reviewed ?? null, NOW, NOW)
      .lastInsertRowid,
  )
}

export function mkReceipt(
  raw: InstanceType<typeof Database>,
  folderId: number,
  opts: {
    totalMinor?: number | null
    currency?: string
    vendorId?: number | null
    categoryId?: number | null
    taxCategoryId?: number | null
    projectId?: number | null
    txnDate?: string | null
    description?: string | null
    trashed?: number | null
    reviewed?: number | null
  } = {},
): number {
  const id = mkItem(raw, folderId, 'receipt', {
    trashed: opts.trashed,
    reviewed: opts.reviewed,
  })
  raw
    .prepare(
      `INSERT INTO receipt_data(
         item_id, txn_date, vendor_id, total_minor, currency,
         category_id, tax_category_id, project_id, description
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      opts.txnDate ?? '2026-07-12',
      opts.vendorId ?? null,
      opts.totalMinor ?? null,
      opts.currency ?? 'USD',
      opts.categoryId ?? null,
      opts.taxCategoryId ?? null,
      opts.projectId ?? null,
      opts.description ?? null,
    )
  return id
}

export function mkPage(
  raw: InstanceType<typeof Database>,
  itemId: number,
  seq: number,
  ocrText: string | null,
  relpath?: string,
): number {
  return Number(
    raw
      .prepare(
        `INSERT INTO page(item_id, seq, file_relpath, content_hash, ocr_status, ocr_text, ocr_conf, created_at)
         VALUES (?, ?, ?, ?, 'done', ?, 0.9, ?)`,
      )
      .run(
        itemId,
        seq,
        relpath ?? `images/${itemId}-${seq}.jpg`,
        `sha-${itemId}-${seq}`,
        ocrText,
        NOW,
      ).lastInsertRowid,
  )
}
