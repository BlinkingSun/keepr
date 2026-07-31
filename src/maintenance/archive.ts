/**
 * Archive items older than a civil-date cutoff into a compressed .tar.gz,
 * then remove them from the active library.
 *
 * Never archive a split child without its whole group: if any member of a
 * split group is selected, the entire group (origin + all children) is archived.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { asCivilDate, asRelPath, type CivilDate } from '../shared/types.ts'
import { listTarGz, readTarGz, writeTarGz } from './fsutil.ts'
import type { MaintenanceContext } from './types.ts'

export interface ArchiveResult {
  path: string
  itemsMoved: number
}

export interface ArchiveListEntry {
  itemId: number
  type: string
  txnDate: string | null
  totalMinor: number | null
  splitRole: string | null
  splitGroupId: number | null
}

interface ArchivePayload {
  format: 'keepr-archive-v1'
  cutoffDate: string
  createdAt: number
  items: Array<Record<string, unknown>>
  receiptData: Array<Record<string, unknown>>
  documentData: Array<Record<string, unknown>>
  contactData: Array<Record<string, unknown>>
  taxLines: Array<Record<string, unknown>>
  pages: Array<Record<string, unknown>>
  splitGroups: Array<Record<string, unknown>>
  files: Array<{ rel: string; sha256: string; base64: string }>
}

function defaultArchivePath(libraryRoot: string, cutoff: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  return path.join(libraryRoot, 'archives', `archive-before-${cutoff}-${stamp}.tar.gz`)
}

/**
 * Select items whose business date is strictly older than cutoff.
 * Receipts use txn_date; documents use doc_date; contacts / undated fall back
 * to the item's created_at civil day (UTC).
 */
function selectCandidates(ctx: MaintenanceContext, cutoff: string): number[] {
  const rows = ctx.db
    .prepare(
      `
      SELECT i.id AS id,
             i.type AS type,
             i.trashed_at AS trashed_at,
             i.split_group_id AS split_group_id,
             i.split_role AS split_role,
             r.txn_date AS txn_date,
             d.doc_date AS doc_date,
             i.created_at AS created_at
        FROM item i
        LEFT JOIN receipt_data r ON r.item_id = i.id
        LEFT JOIN document_data d ON d.item_id = i.id
       WHERE i.trashed_at IS NULL
      `,
    )
    .all() as Array<{
    id: number
    type: string
    trashed_at: number | null
    split_group_id: number | null
    split_role: string | null
    txn_date: string | null
    doc_date: string | null
    created_at: number
  }>

  const ids: number[] = []
  for (const row of rows) {
    let civil: string | null = null
    if (row.type === 'receipt') civil = row.txn_date
    else if (row.type === 'document') civil = row.doc_date
    if (!civil) {
      const d = new Date(row.created_at)
      civil = d.toISOString().slice(0, 10)
    }
    if (civil < cutoff) ids.push(row.id)
  }
  return ids
}

/**
 * Expand selection so no split group is archived partially.
 * If any member is selected, every member of that split_group is included.
 */
function expandSplitGroups(ctx: MaintenanceContext, itemIds: number[]): number[] {
  const set = new Set(itemIds)
  const groups = ctx.db
    .prepare(
      `SELECT DISTINCT split_group_id AS g FROM item
        WHERE id IN (${itemIds.map(() => '?').join(',') || 'NULL'})
          AND split_group_id IS NOT NULL`,
    )
    .all(...itemIds) as Array<{ g: number }>

  for (const { g } of groups) {
    const members = ctx.db
      .prepare(`SELECT id FROM item WHERE split_group_id = ?`)
      .all(g) as Array<{ id: number }>
    for (const m of members) set.add(m.id)
  }
  return [...set]
}

/**
 * Archive items older than cutoff into a .tar.gz, remove them from the live
 * library (children-before-origin), release files by reference count.
 */
export async function archive(
  ctx: MaintenanceContext,
  cutoffCivilDate: CivilDate | string,
  destPath?: string,
): Promise<ArchiveResult> {
  const cutoff =
    typeof cutoffCivilDate === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(cutoffCivilDate)
      ? (() => {
          throw new RangeError(`not a civil date: ${cutoffCivilDate}`)
        })()
      : asCivilDate(String(cutoffCivilDate))

  const dest = destPath ?? defaultArchivePath(ctx.libraryRoot, cutoff)
  mkdirSync(path.dirname(dest), { recursive: true })

  let candidates = selectCandidates(ctx, cutoff)
  if (candidates.length === 0) {
    // Still write an empty archive so the path is listable.
    const empty: ArchivePayload = {
      format: 'keepr-archive-v1',
      cutoffDate: cutoff,
      createdAt: Date.now(),
      items: [],
      receiptData: [],
      documentData: [],
      contactData: [],
      taxLines: [],
      pages: [],
      splitGroups: [],
      files: [],
    }
    await writeTarGz(dest, [
      { name: 'archive.json', data: Buffer.from(JSON.stringify(empty, null, 2), 'utf8') },
    ])
    ctx.db
      .prepare(
        `INSERT INTO archive_log(path, cutoff_date, items_moved, created_at) VALUES (?,?,?,?)`,
      )
      .run(dest, cutoff, 0, Date.now())
    return { path: dest, itemsMoved: 0 }
  }

  candidates = expandSplitGroups(ctx, candidates)
  const idList = candidates
  const placeholders = idList.map(() => '?').join(',')

  const items = ctx.db
    .prepare(`SELECT * FROM item WHERE id IN (${placeholders})`)
    .all(...idList) as Array<Record<string, unknown>>
  const receiptData = ctx.db
    .prepare(`SELECT * FROM receipt_data WHERE item_id IN (${placeholders})`)
    .all(...idList) as Array<Record<string, unknown>>
  const documentData = ctx.db
    .prepare(`SELECT * FROM document_data WHERE item_id IN (${placeholders})`)
    .all(...idList) as Array<Record<string, unknown>>
  const contactData = ctx.db
    .prepare(`SELECT * FROM contact_data WHERE item_id IN (${placeholders})`)
    .all(...idList) as Array<Record<string, unknown>>
  const taxLines = ctx.db
    .prepare(`SELECT * FROM receipt_tax_line WHERE item_id IN (${placeholders})`)
    .all(...idList) as Array<Record<string, unknown>>
  const pages = ctx.db
    .prepare(`SELECT * FROM page WHERE item_id IN (${placeholders})`)
    .all(...idList) as Array<Record<string, unknown>>

  const groupIds = [
    ...new Set(
      items
        .map((i) => i.split_group_id as number | null)
        .filter((g): g is number => g != null),
    ),
  ]
  const splitGroups =
    groupIds.length === 0
      ? []
      : (ctx.db
          .prepare(
            `SELECT * FROM split_group WHERE id IN (${groupIds.map(() => '?').join(',')})`,
          )
          .all(...groupIds) as Array<Record<string, unknown>>)

  // Collect image bytes for pages we own (children have none).
  const files: ArchivePayload['files'] = []
  const seenRel = new Set<string>()
  for (const p of pages) {
    for (const key of ['file_relpath', 'thumb_relpath'] as const) {
      const rel = p[key] as string | null
      if (!rel || seenRel.has(rel)) continue
      seenRel.add(rel)
      const abs = ctx.fileStore.resolve(asRelPath(rel))
      if (!existsSync(abs)) continue
      const buf = readFileSync(abs)
      files.push({
        rel,
        sha256: createHash('sha256').update(buf).digest('hex'),
        base64: buf.toString('base64'),
      })
    }
  }

  const payload: ArchivePayload = {
    format: 'keepr-archive-v1',
    cutoffDate: cutoff,
    createdAt: Date.now(),
    items,
    receiptData,
    documentData,
    contactData,
    taxLines,
    pages,
    splitGroups,
    files,
  }

  const entries: Array<{ name: string; data: Buffer }> = [
    { name: 'archive.json', data: Buffer.from(JSON.stringify(payload, null, 2), 'utf8') },
  ]
  for (const f of files) {
    entries.push({
      name: `files/${f.rel}`,
      data: Buffer.from(f.base64, 'base64'),
    })
  }
  await writeTarGz(dest, entries)

  // Remove from active library: children first, then origins / others.
  const ordered = [...items].sort((a, b) => {
    const rank = (role: unknown) =>
      role === 'child' ? 0 : role === 'origin' ? 1 : 2
    const d = rank(a.split_role) - rank(b.split_role)
    return d !== 0 ? d : (a.id as number) - (b.id as number)
  })

  const del = ctx.db.prepare(`DELETE FROM item WHERE id = ?`)
  const pageRels = ctx.db.prepare(
    `SELECT file_relpath, thumb_relpath FROM page WHERE item_id = ?`,
  )

  for (const item of ordered) {
    const id = item.id as number
    const pageRows = pageRels.all(id) as Array<{
      file_relpath: string
      thumb_relpath: string | null
    }>
    const rels = new Set<string>()
    for (const pr of pageRows) {
      if (pr.file_relpath) rels.add(pr.file_relpath)
      if (pr.thumb_relpath) rels.add(pr.thumb_relpath)
    }
    del.run(id)
    for (const rel of rels) {
      await ctx.fileStore.releaseWithResult(asRelPath(rel))
    }
  }

  // Orphan split_group rows whose origin is gone: CASCADE from origin_item_id
  // already handles this when the origin item is deleted.

  ctx.db
    .prepare(
      `INSERT INTO archive_log(path, cutoff_date, items_moved, created_at) VALUES (?,?,?,?)`,
    )
    .run(dest, cutoff, ordered.length, Date.now())

  return { path: dest, itemsMoved: ordered.length }
}

/**
 * List items stored in a KeepR archive .tar.gz (test + UI helper).
 */
export async function listArchive(archivePath: string): Promise<ArchiveListEntry[]> {
  const entries = await readTarGz(archivePath)
  const jsonEntry = entries.find((e) => e.name === 'archive.json')
  if (!jsonEntry) {
    // Fallback: list raw tar names
    return []
  }
  const payload = JSON.parse(jsonEntry.data.toString('utf8')) as ArchivePayload
  const receiptByItem = new Map(
    payload.receiptData.map((r) => [r.item_id as number, r]),
  )
  return payload.items.map((item) => {
    const id = item.id as number
    const rd = receiptByItem.get(id)
    return {
      itemId: id,
      type: String(item.type ?? 'unknown'),
      txnDate: (rd?.txn_date as string | null | undefined) ?? null,
      totalMinor: (rd?.total_minor as number | null | undefined) ?? null,
      splitRole: (item.split_role as string | null) ?? null,
      splitGroupId: (item.split_group_id as number | null) ?? null,
    }
  })
}

/** Entry names inside the archive tarball (includes archive.json and file paths). */
export async function listArchiveNames(archivePath: string): Promise<string[]> {
  return listTarGz(archivePath)
}
