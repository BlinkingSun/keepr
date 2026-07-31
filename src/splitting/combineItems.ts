/**
 * combineItems — merge N items into one multi-page result.
 *
 * Model:
 *   - First id in itemIds is the live result.
 *   - Pages from every input are reassigned onto the result in input order,
 *     renumbered seq = 1..N.
 *   - Every input is snapshotted (including the result) so separate can restore
 *     original field values.
 *   - Absorbed items (all but the first) are soft-trashed.
 *   - merge_group + merge_group_member journal the reverse map.
 *
 * Mutually exclusive with split (schema triggers enforce both directions).
 */

import type { Database } from './db.ts'
import { nowMs } from './db.ts'
import { captureItemSnapshot } from './snapshot.ts'

interface ItemRow {
  id: number
  folder_id: number
  type: string
  split_group_id: number | null
  split_role: string | null
  trashed_at: number | null
}

interface PageRow {
  id: number
  item_id: number
  seq: number
}

export function combineItems(
  db: Database,
  itemIds: number[],
): { itemId: number; mergeGroupId: number } {
  if (itemIds.length < 2) {
    throw new Error('KeepR: combine requires at least 2 items')
  }
  const unique = new Set(itemIds)
  if (unique.size !== itemIds.length) {
    throw new Error('KeepR: combine item ids must be unique')
  }

  const run = db.transaction((): { itemId: number; mergeGroupId: number } => {
    const items: ItemRow[] = []
    for (const id of itemIds) {
      const row = db
        .prepare(
          `SELECT id, folder_id, type, split_group_id, split_role, trashed_at
           FROM item WHERE id = ?`,
        )
        .get(id) as ItemRow | undefined
      if (!row) throw new Error(`KeepR: item ${id} not found`)
      if (row.trashed_at != null) throw new Error(`KeepR: cannot combine trashed item ${id}`)
      if (row.split_group_id != null) {
        // Mirror the merge_no_combine_of_split message so callers and tests
        // see the same refusal surface whether we pre-check or hit the trigger.
        throw new Error('KeepR: cannot combine into an item that is part of a split')
      }
      // Also refuse if this item is already a merge result (re-combine of a
      // combined item without separating first would orphan the prior journal).
      const priorMerge = db
        .prepare(`SELECT id FROM merge_group WHERE result_item_id = ? LIMIT 1`)
        .get(id) as { id: number } | undefined
      if (priorMerge) {
        throw new Error(
          `KeepR: item ${id} is already a combine result — separate it first`,
        )
      }
      items.push(row)
    }

    const resultId = itemIds[0]
    if (resultId === undefined) throw new Error('KeepR: combine result id missing')

    // Snapshot every absorbed item (and the result) before mutating pages.
    // One snapshot per item — stored on every page member for that item so
    // separate can restore fields once per pre_merge_item_id.
    const snapshots = new Map<number, string>()
    for (const id of itemIds) {
      snapshots.set(id, JSON.stringify(captureItemSnapshot(db, id)))
    }

    // Collect pages in itemIds order, then seq within each item.
    const pagesInOrder: Array<PageRow & { pre_merge_item_id: number; pre_merge_seq: number; pre_merge_type: string }> =
      []
    for (const id of itemIds) {
      const item = items.find((i) => i.id === id)
      if (!item) throw new Error(`KeepR: item ${id} lost during combine`)
      const pages = db
        .prepare(
          `SELECT id, item_id, seq FROM page WHERE item_id = ? ORDER BY seq`,
        )
        .all(id) as PageRow[]
      for (const p of pages) {
        pagesInOrder.push({
          ...p,
          pre_merge_item_id: id,
          pre_merge_seq: p.seq,
          pre_merge_type: item.type,
        })
      }
    }

    if (pagesInOrder.length === 0) {
      throw new Error('KeepR: combine requires at least one page across the items')
    }

    const ts = nowMs()

    // Create the merge journal first (trigger checks result is not split).
    const mgResult = db
      .prepare(`INSERT INTO merge_group(result_item_id, created_at) VALUES (?, ?)`)
      .run(resultId, ts)
    const mergeGroupId = Number(mgResult.lastInsertRowid)

    // Reassign pages onto the result. UNIQUE(item_id, seq) requires a two-phase
    // move when pages already live on the result: first park at temporary high
    // seq values, then write the final dense sequence.
    const parkBase = 1_000_000
    const updatePage = db.prepare(
      `UPDATE page SET item_id = ?, seq = ? WHERE id = ?`,
    )

    // Phase 1: park every page at a unique high seq under the result item.
    for (let i = 0; i < pagesInOrder.length; i++) {
      const p = pagesInOrder[i]
      if (!p) continue
      updatePage.run(resultId, parkBase + i, p.id)
    }
    // Phase 2: dense seq 1..N.
    for (let i = 0; i < pagesInOrder.length; i++) {
      const p = pagesInOrder[i]
      if (!p) continue
      updatePage.run(resultId, i + 1, p.id)
    }

    // Journal members with snapshots.
    const insMember = db.prepare(
      `INSERT INTO merge_group_member(
         merge_group_id, page_id, pre_merge_item_id, pre_merge_seq, pre_merge_type, snapshot_json
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    for (const p of pagesInOrder) {
      const snap = snapshots.get(p.pre_merge_item_id)
      if (!snap) throw new Error(`KeepR: missing snapshot for item ${p.pre_merge_item_id}`)
      insMember.run(
        mergeGroupId,
        p.id,
        p.pre_merge_item_id,
        p.pre_merge_seq,
        p.pre_merge_type,
        snap,
      )
    }

    // Soft-trash absorbed items (not the result).
    const trash = db.prepare(
      `UPDATE item SET trashed_at = ?, modified_at = ? WHERE id = ?`,
    )
    for (let i = 1; i < itemIds.length; i++) {
      const id = itemIds[i]
      if (id === undefined) continue
      trash.run(ts, ts, id)
    }

    db.prepare(`UPDATE item SET modified_at = ? WHERE id = ?`).run(ts, resultId)

    return { itemId: resultId, mergeGroupId }
  })

  return run()
}
