/**
 * Inbox review helpers — list, mark reviewed, file into a folder, next unreviewed.
 */

import type { GridRow, ListResponse } from '../shared/ipc.ts'
import type { IngestDeps } from './types.ts'

export function listInbox(
  deps: IngestDeps,
  opts: { limit?: number; offset?: number } = {},
): ListResponse {
  const inboxId = resolveInboxId(deps)
  return deps.repos.items.list({
    folderId: inboxId,
    smartFilter: 'inbox',
    limit: opts.limit,
    offset: opts.offset,
    sort: [{ column: 'createdAt', dir: 'asc' }],
  })
}

export function markReviewed(
  deps: IngestDeps,
  itemId: number,
): { ok: boolean } {
  const result = deps.repos.items.patch(itemId, { reviewed: true })
  return { ok: result.ok }
}

/**
 * Move an item out of the Inbox into a user folder and mark it reviewed.
 */
export function fileInto(
  deps: IngestDeps,
  itemId: number,
  folderId: number,
): { ok: boolean; reason?: string } {
  const folder = deps.repos.db
    .prepare(`SELECT id, kind FROM folder WHERE id = ?`)
    .get(folderId) as { id: number; kind: string } | undefined
  if (!folder) return { ok: false, reason: 'folder not found' }
  if (folder.kind === 'trash') {
    return { ok: false, reason: 'cannot file into trash; use item:trash' }
  }

  const result = deps.repos.items.patch(itemId, {
    folderId,
    reviewed: true,
  })
  if (!result.ok) {
    const reason = Object.values(result.errors)[0] ?? 'patch failed'
    return { ok: false, reason }
  }
  return { ok: true }
}

/**
 * Next unreviewed item in the Inbox (lowest id / oldest first).
 */
export function nextUnreviewed(deps: IngestDeps): GridRow | null {
  const inboxId = resolveInboxId(deps)
  const res = deps.repos.items.list({
    folderId: inboxId,
    smartFilter: 'unreviewed',
    limit: 1,
    offset: 0,
    sort: [{ column: 'createdAt', dir: 'asc' }],
  })
  // smartFilter unreviewed alone does not force inbox; combine via folderId.
  // buildWhere ANDs folder + unreviewed — good.
  // But smartFilter: 'unreviewed' does not also set inbox. We pass folderId.
  // Wait: when smartFilter is 'unreviewed', does it still use folderId? Yes.
  return res.rows[0] ?? null
}

export function inboxCount(deps: IngestDeps): number {
  const inboxId = resolveInboxId(deps)
  const row = deps.repos.db
    .prepare(
      `SELECT COUNT(*) AS c FROM item
        WHERE folder_id = ? AND trashed_at IS NULL AND reviewed_at IS NULL`,
    )
    .get(inboxId) as { c: number }
  return row.c
}

function resolveInboxId(deps: IngestDeps): number {
  const row = deps.repos.db
    .prepare(`SELECT id FROM folder WHERE kind = 'inbox' LIMIT 1`)
    .get() as { id: number } | undefined
  if (!row) throw new Error('Inbox folder missing (folder.kind=inbox)')
  return row.id
}
