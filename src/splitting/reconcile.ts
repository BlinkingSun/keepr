/**
 * Assert v_split_reconciliation is clean for a group.
 * Must be called INSIDE the transaction, before commit.
 */

import type { Database } from './db.ts'

export interface ReconRow {
  split_group_id: number
  drift_minor: number
  tax_drift_minor: number
  currency_mismatch_count: number | null
  child_count: number
  children_total_minor: number
  origin_total_minor: number
}

export function assertSplitReconciliation(db: Database, splitGroupId: number): ReconRow {
  const row = db
    .prepare(
      `SELECT split_group_id, drift_minor, tax_drift_minor,
              currency_mismatch_count, child_count,
              children_total_minor, origin_total_minor
       FROM v_split_reconciliation
       WHERE split_group_id = ?`,
    )
    .get(splitGroupId) as ReconRow | undefined

  if (!row) {
    throw new Error(`KeepR: split group ${splitGroupId} missing from v_split_reconciliation`)
  }
  if (row.drift_minor !== 0) {
    throw new Error(
      `KeepR: split drift_minor=${row.drift_minor} (children ${row.children_total_minor} vs origin ${row.origin_total_minor})`,
    )
  }
  if (row.tax_drift_minor !== 0) {
    throw new Error(`KeepR: split tax_drift_minor=${row.tax_drift_minor}`)
  }
  if ((row.currency_mismatch_count ?? 0) > 0) {
    throw new Error(
      `KeepR: split currency_mismatch_count=${row.currency_mismatch_count}`,
    )
  }
  return row
}
