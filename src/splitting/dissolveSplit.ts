/**
 * dissolveSplit — reverse a split.
 *
 * Order is load-bearing (schema triggers enforce it):
 *   1. hard-delete every child
 *   2. unwind the origin (clear split_group_id / split_role / superseded_at)
 *   3. remove the split_group journal row
 *
 * Detaching a child in place is refused by trigger and correctly so.
 */

import type { Database } from './db.ts'
import { nowMs } from './db.ts'

interface SplitGroupRow {
  id: number
  origin_item_id: number
}

export function dissolveSplit(db: Database, splitGroupId: number): void {
  const run = db.transaction(() => {
    const sg = db
      .prepare(`SELECT id, origin_item_id FROM split_group WHERE id = ?`)
      .get(splitGroupId) as SplitGroupRow | undefined

    if (!sg) {
      throw new Error(`KeepR: split group ${splitGroupId} not found`)
    }

    const children = db
      .prepare(
        `SELECT id FROM item
         WHERE split_group_id = ? AND split_role = 'child'
         ORDER BY id`,
      )
      .all(splitGroupId) as Array<{ id: number }>

    // Step 1: hard-delete children first. CASCADE clears receipt_data + tax lines.
    const delItem = db.prepare(`DELETE FROM item WHERE id = ?`)
    for (const c of children) {
      delItem.run(c.id)
    }

    // Step 2: unwind the origin so it re-enters v_summable_receipts.
    const ts = nowMs()
    db.prepare(
      `UPDATE item
       SET split_group_id = NULL, split_role = NULL, superseded_at = NULL, modified_at = ?
       WHERE id = ?`,
    ).run(ts, sg.origin_item_id)

    // Step 3: drop the journal. Origin no longer references it.
    db.prepare(`DELETE FROM split_group WHERE id = ?`).run(splitGroupId)
  })

  run()
}
