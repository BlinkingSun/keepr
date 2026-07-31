/**
 * separateItem — reverse a combine from merge_group_member snapshots.
 *
 * Restores every pre-merge item's field values, re-homes pages to their
 * original owners/seq, un-trashes absorbed items, and deletes the merge group.
 */

import type { Database } from './db.ts'
import { nowMs } from './db.ts'
import { parseSnapshot, restoreItemFromSnapshot } from './snapshot.ts'

interface MergeGroupRow {
  id: number
  result_item_id: number
}

interface MemberRow {
  id: number
  page_id: number
  pre_merge_item_id: number
  pre_merge_seq: number
  pre_merge_type: string
  snapshot_json: string
}

export function separateItem(db: Database, itemId: number): { itemIds: number[] } {
  const run = db.transaction((): { itemIds: number[] } => {
    const mg = db
      .prepare(`SELECT id, result_item_id FROM merge_group WHERE result_item_id = ?`)
      .get(itemId) as MergeGroupRow | undefined

    if (!mg) {
      throw new Error(`KeepR: item ${itemId} is not a combine result`)
    }

    // Trigger merge_no_separate_after_split refuses DELETE when the result is
    // part of a split — we still surface a clear pre-check.
    const resultItem = db
      .prepare(`SELECT split_group_id FROM item WHERE id = ?`)
      .get(itemId) as { split_group_id: number | null } | undefined
    if (resultItem?.split_group_id != null) {
      throw new Error(
        'KeepR: cannot separate a combined item that has since been split',
      )
    }

    const members = db
      .prepare(
        `SELECT id, page_id, pre_merge_item_id, pre_merge_seq, pre_merge_type, snapshot_json
         FROM merge_group_member
         WHERE merge_group_id = ?
         ORDER BY id`,
      )
      .all(mg.id) as MemberRow[]

    if (members.length === 0) {
      throw new Error(`KeepR: merge group ${mg.id} has no members`)
    }

    // Unique pre-merge items in first-seen order.
    const orderedIds: number[] = []
    const snapshotByItem = new Map<number, string>()
    for (const m of members) {
      if (!snapshotByItem.has(m.pre_merge_item_id)) {
        orderedIds.push(m.pre_merge_item_id)
        snapshotByItem.set(m.pre_merge_item_id, m.snapshot_json)
      }
    }

    const ts = nowMs()

    // Restore field values for every pre-merge item (create if hard-deleted).
    const restoredIds: number[] = []
    for (const preId of orderedIds) {
      const snapJson = snapshotByItem.get(preId)
      if (!snapJson) throw new Error(`KeepR: missing snapshot for ${preId}`)
      const snap = parseSnapshot(snapJson)

      const existing = db
        .prepare(`SELECT id FROM item WHERE id = ?`)
        .get(preId) as { id: number } | undefined

      let liveId: number
      if (existing) {
        restoreItemFromSnapshot(db, preId, snap, ts)
        liveId = preId
      } else {
        // Recreate with the original primary key so page re-home ids match.
        db.prepare(
          `INSERT INTO item(
             id, folder_id, type, split_group_id, split_role, superseded_at,
             reviewed_at, trashed_at, created_at, modified_at
           ) VALUES (?, ?, ?, NULL, NULL, NULL, ?, NULL, ?, ?)`,
        ).run(
          preId,
          snap.item.folder_id,
          snap.item.type,
          snap.item.reviewed_at,
          ts,
          ts,
        )
        restoreItemFromSnapshot(db, preId, snap, ts)
        liveId = preId
      }
      restoredIds.push(liveId)
    }

    // Re-home pages. Two-phase seq to avoid UNIQUE(item_id, seq) collisions
    // while pages still sit on the result.
    const parkBase = 2_000_000
    const updatePage = db.prepare(
      `UPDATE page SET item_id = ?, seq = ? WHERE id = ?`,
    )

    for (let i = 0; i < members.length; i++) {
      const m = members[i]
      if (!m) continue
      // Park under a temporary owner (the pre-merge item) at high seq.
      updatePage.run(m.pre_merge_item_id, parkBase + i, m.page_id)
    }
    for (const m of members) {
      updatePage.run(m.pre_merge_item_id, m.pre_merge_seq, m.page_id)
    }

    // Drop the merge journal (CASCADE members). Trigger may still fire if
    // result became split between our check and here.
    db.prepare(`DELETE FROM merge_group WHERE id = ?`).run(mg.id)

    return { itemIds: restoredIds }
  })

  return run()
}
