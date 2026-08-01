/**
 * On-disk library harness for maintenance tests.
 * Uses createContext so WAL, file store, and migrations match production.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, type AppContext } from '../../main/context.ts'
import { allocate, asMinor, asRelPath, type LibraryRelPath } from '../../shared/types.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
export const SCHEMA_DIR = path.resolve(here, '../../db/schema')

export const NOW = 1_753_900_000_000

export async function openLibraryRoot(): Promise<{ root: string; ctx: AppContext }> {
  const root = await mkdtemp(path.join(tmpdir(), 'keepr-maint-'))
  const ctx = createContext({
    libraryRoot: root,
    schemaDir: SCHEMA_DIR,
    skipBackup: true,
      skipSeed: true,
    })
  return { root, ctx }
}

export async function dispose(ctx: AppContext, root: string): Promise<void> {
  try {
    ctx.close()
  } catch {
    /* already closed after restore */
  }
  await rm(root, { recursive: true, force: true }).catch(() => undefined)
}

/** Seed a user folder (inbox/trash already exist via ensureSystemFolders). */
export function seedUserFolder(ctx: AppContext, name = 'Materials'): number {
  const now = Date.now()
  return Number(
    ctx.db
      .prepare(
        `INSERT INTO folder(kind, name, created_at, modified_at) VALUES ('user', ?, ?, ?)`,
      )
      .run(name, now, now).lastInsertRowid,
  )
}

export function seedVendor(ctx: AppContext, name = 'Home Depot'): number {
  const now = Date.now()
  return Number(
    ctx.db
      .prepare(
        `INSERT INTO vendor(name, normalized_name, created_at) VALUES (?, ?, ?)`,
      )
      .run(name, name.toLowerCase(), now).lastInsertRowid,
  )
}

export async function putImage(
  ctx: AppContext,
  bytes: Buffer,
  ext = 'jpg',
): Promise<{ rel: LibraryRelPath; hash: string }> {
  const r = await ctx.fileStore.put(bytes, ext)
  return { rel: r.rel, hash: r.hash }
}

export function insertReceipt(
  ctx: AppContext,
  opts: {
    folderId: number
    totalMinor: number
    txnDate: string
    vendorId?: number | null
    currency?: string
    taxMinor?: number | null
    fileRel?: string
    contentHash?: string
    splitGroupId?: number | null
    splitRole?: string | null
    supersededAt?: number | null
    trashedAt?: number | null
  },
): { itemId: number; pageId: number | null } {
  const now = Date.now()
  const itemId = Number(
    ctx.db
      .prepare(
        `INSERT INTO item(folder_id, type, split_group_id, split_role, superseded_at, trashed_at, created_at, modified_at)
         VALUES (?, 'receipt', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        opts.folderId,
        opts.splitGroupId ?? null,
        opts.splitRole ?? null,
        opts.supersededAt ?? null,
        opts.trashedAt ?? null,
        now,
        now,
      ).lastInsertRowid,
  )
  ctx.db
    .prepare(
      `INSERT INTO receipt_data(item_id, txn_date, vendor_id, total_minor, currency, tax_total_minor)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      itemId,
      opts.txnDate,
      opts.vendorId ?? null,
      opts.totalMinor,
      opts.currency ?? 'USD',
      opts.taxMinor ?? null,
    )

  let pageId: number | null = null
  if (opts.fileRel) {
    pageId = Number(
      ctx.db
        .prepare(
          `INSERT INTO page(item_id, seq, file_relpath, content_hash, ocr_status, created_at)
           VALUES (?, 1, ?, ?, 'done', ?)`,
        )
        .run(itemId, opts.fileRel, opts.contentHash ?? null, now).lastInsertRowid,
    )
  }
  return { itemId, pageId }
}

/** 3-way split of $100 sharing one page image. */
export async function seedSplitGroup(
  ctx: AppContext,
  folderId: number,
  imageBytes = Buffer.from('shared-split-receipt-image-bytes'),
): Promise<{
  originId: number
  childIds: number[]
  splitGroupId: number
  pageId: number
  fileRel: string
  contentHash: string
}> {
  const { rel, hash } = await putImage(ctx, imageBytes, 'jpg')
  const { itemId: originId, pageId } = insertReceipt(ctx, {
    folderId,
    totalMinor: 10000,
    taxMinor: 825,
    txnDate: '2026-07-12',
    fileRel: rel,
    contentHash: hash,
  })
  if (pageId == null) throw new Error('expected page')

  const now = Date.now()
  const parts = allocate(asMinor(10000), 3)
  const taxParts = allocate(asMinor(825), 3)
  const sg = Number(
    ctx.db
      .prepare(
        `INSERT INTO split_group(origin_item_id, origin_page_id, origin_total_minor, origin_tax_minor, currency, created_at)
         VALUES (?, ?, 10000, 825, 'USD', ?)`,
      )
      .run(originId, pageId, now).lastInsertRowid,
  )
  ctx.db
    .prepare(
      `UPDATE item SET split_group_id = ?, split_role = 'origin', superseded_at = ? WHERE id = ?`,
    )
    .run(sg, now, originId)

  const childIds = parts.map((p, i) => {
    const { itemId } = insertReceipt(ctx, {
      folderId,
      totalMinor: p,
      taxMinor: taxParts[i],
      txnDate: '2026-07-12',
      splitGroupId: sg,
      splitRole: 'child',
    })
    return itemId
  })

  return {
    originId,
    childIds,
    splitGroupId: sg,
    pageId,
    fileRel: rel,
    contentHash: hash,
  }
}

export { asRelPath, createContext }
