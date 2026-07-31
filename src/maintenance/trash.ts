/**
 * Empty-trash and soft-restore.
 *
 * MANDATORY ORDER: split children before their origin.
 * Origin-first is refused by trigger `item_split_origin_purge_guard` with a
 * readable message — that trigger is correct; we implement the right order
 * rather than working around it.
 *
 * Files are released by reference count via FileStore.releaseWithResult.
 * Images are content-addressed and shared; unlinking on first release would
 * blank the image for a split receipt's remaining siblings.
 */
import type { LibraryRelPath } from '../shared/types.ts'
import { asRelPath } from '../shared/types.ts'
import type { MaintenanceContext } from './types.ts'

export interface EmptyTrashResult {
  itemsPurged: number
  filesReleased: number
}

type TrashedRow = {
  id: number
  split_role: string | null
  split_group_id: number | null
}

/**
 * Hard-delete every soft-trashed item, children first, then origins / others.
 * Releases page image files only when no remaining page row cites them.
 */
export async function emptyTrash(ctx: MaintenanceContext): Promise<EmptyTrashResult> {
  const trashed = ctx.db
    .prepare(
      `SELECT id, split_role, split_group_id FROM item WHERE trashed_at IS NOT NULL`,
    )
    .all() as TrashedRow[]

  // Children first, then origins, then unsplit items. Stable by id within each bucket.
  const rank = (r: TrashedRow): number => {
    if (r.split_role === 'child') return 0
    if (r.split_role === 'origin') return 1
    return 2
  }
  trashed.sort((a, b) => {
    const d = rank(a) - rank(b)
    return d !== 0 ? d : a.id - b.id
  })

  let itemsPurged = 0
  let filesReleased = 0

  const pageStmt = ctx.db.prepare(
    `SELECT file_relpath, thumb_relpath FROM page WHERE item_id = ?`,
  )
  const delStmt = ctx.db.prepare(`DELETE FROM item WHERE id = ?`)

  // Collect unique relpaths to release after each delete (when citation count
  // may have dropped). Pages CASCADE-delete with the item.
  for (const row of trashed) {
    const pages = pageStmt.all(row.id) as Array<{
      file_relpath: string
      thumb_relpath: string | null
    }>
    const rels = new Set<string>()
    for (const p of pages) {
      if (p.file_relpath) rels.add(p.file_relpath)
      if (p.thumb_relpath) rels.add(p.thumb_relpath)
    }

    try {
      delStmt.run(row.id)
    } catch (e) {
      // Surface the trigger message rather than an opaque wrapper.
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(msg)
    }
    itemsPurged++

    for (const rel of rels) {
      const result = await ctx.fileStore.releaseWithResult(asRelPath(rel) as LibraryRelPath)
      if (result.unlinked) filesReleased++
    }
  }

  return { itemsPurged, filesReleased }
}

/**
 * Clear trashed_at on a single item (soft-restore from trash).
 * Does not move folders — trash membership is solely trashed_at.
 */
export function restoreItem(ctx: MaintenanceContext, itemId: number): { ok: boolean } {
  const now = Date.now()
  const r = ctx.db
    .prepare(
      `UPDATE item SET trashed_at = NULL, modified_at = ? WHERE id = ? AND trashed_at IS NOT NULL`,
    )
    .run(now, itemId)
  return { ok: r.changes > 0 }
}

/**
 * Attempt to hard-delete a single item. Used by tests to assert that
 * origin-first purge surfaces the trigger's readable message.
 */
export function hardDeleteItem(ctx: MaintenanceContext, itemId: number): void {
  ctx.db.prepare(`DELETE FROM item WHERE id = ?`).run(itemId)
}
