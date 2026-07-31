/**
 * Full-row snapshots for merge_group_member.snapshot_json.
 * Combine is reversible only because separate restores from these.
 */

import type { Database } from './db.ts'

export interface ItemSnapshot {
  item: {
    folder_id: number
    type: string
    reviewed_at: number | null
    // split flags are never snapshotted for restore into a split — combine
    // refuses split items, so these should always be null at snapshot time.
    split_group_id: number | null
    split_role: string | null
    superseded_at: number | null
  }
  receipt_data: Record<string, unknown> | null
  document_data: Record<string, unknown> | null
  contact_data: Record<string, unknown> | null
  tax_lines: Array<Record<string, unknown>>
  custom_fields: Array<{ def_id: number; value: string | null }>
}

export function captureItemSnapshot(db: Database, itemId: number): ItemSnapshot {
  const item = db
    .prepare(
      `SELECT folder_id, type, reviewed_at, split_group_id, split_role, superseded_at
       FROM item WHERE id = ?`,
    )
    .get(itemId) as ItemSnapshot['item'] | undefined
  if (!item) throw new Error(`KeepR: cannot snapshot missing item ${itemId}`)

  const receipt_data =
    (db.prepare(`SELECT * FROM receipt_data WHERE item_id = ?`).get(itemId) as
      | Record<string, unknown>
      | undefined) ?? null

  const document_data =
    (db.prepare(`SELECT * FROM document_data WHERE item_id = ?`).get(itemId) as
      | Record<string, unknown>
      | undefined) ?? null

  const contact_data =
    (db.prepare(`SELECT * FROM contact_data WHERE item_id = ?`).get(itemId) as
      | Record<string, unknown>
      | undefined) ?? null

  const tax_lines = db
    .prepare(
      `SELECT label, rate_bp, amount_minor, tax_category_id
       FROM receipt_tax_line WHERE item_id = ? ORDER BY id`,
    )
    .all(itemId) as Array<Record<string, unknown>>

  const custom_fields = db
    .prepare(`SELECT def_id, value FROM custom_field_value WHERE item_id = ?`)
    .all(itemId) as Array<{ def_id: number; value: string | null }>

  return {
    item: {
      folder_id: item.folder_id,
      type: item.type,
      reviewed_at: item.reviewed_at,
      split_group_id: item.split_group_id,
      split_role: item.split_role,
      superseded_at: item.superseded_at,
    },
    receipt_data,
    document_data,
    contact_data,
    tax_lines,
    custom_fields,
  }
}

/**
 * Restore side-table field values onto an existing item (which may be soft-trashed).
 * Does not touch pages — caller re-homes those from merge_group_member.
 */
export function restoreItemFromSnapshot(
  db: Database,
  itemId: number,
  snap: ItemSnapshot,
  ts: number,
): void {
  db.prepare(
    `UPDATE item
     SET folder_id = ?, type = ?, reviewed_at = ?,
         trashed_at = NULL, modified_at = ?,
         split_group_id = NULL, split_role = NULL, superseded_at = NULL
     WHERE id = ?`,
  ).run(snap.item.folder_id, snap.item.type, snap.item.reviewed_at, ts, itemId)

  // Replace side tables from snapshot.
  db.prepare(`DELETE FROM receipt_data WHERE item_id = ?`).run(itemId)
  db.prepare(`DELETE FROM document_data WHERE item_id = ?`).run(itemId)
  db.prepare(`DELETE FROM contact_data WHERE item_id = ?`).run(itemId)
  db.prepare(`DELETE FROM receipt_tax_line WHERE item_id = ?`).run(itemId)
  db.prepare(`DELETE FROM custom_field_value WHERE item_id = ?`).run(itemId)

  if (snap.receipt_data) {
    const r = snap.receipt_data
    db.prepare(
      `INSERT INTO receipt_data(
         item_id, txn_date, vendor_id, total_minor, currency, payment_type_id,
         tax_total_minor, category_id, tax_category_id, project_id,
         external_ref, description, extraction_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      itemId,
      r['txn_date'] ?? null,
      r['vendor_id'] ?? null,
      r['total_minor'] ?? null,
      r['currency'] ?? 'USD',
      r['payment_type_id'] ?? null,
      r['tax_total_minor'] ?? null,
      r['category_id'] ?? null,
      r['tax_category_id'] ?? null,
      r['project_id'] ?? null,
      r['external_ref'] ?? null,
      r['description'] ?? null,
      r['extraction_json'] ?? null,
    )
  }

  if (snap.document_data) {
    const d = snap.document_data
    db.prepare(
      `INSERT INTO document_data(item_id, title, doc_date, doc_type, notes)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      itemId,
      d['title'] ?? null,
      d['doc_date'] ?? null,
      d['doc_type'] ?? null,
      d['notes'] ?? null,
    )
  }

  if (snap.contact_data) {
    const c = snap.contact_data
    db.prepare(
      `INSERT INTO contact_data(
         item_id, first_name, last_name, org, title,
         emails_json, phones_json, addresses_json, url, notes
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      itemId,
      c['first_name'] ?? null,
      c['last_name'] ?? null,
      c['org'] ?? null,
      c['title'] ?? null,
      c['emails_json'] ?? null,
      c['phones_json'] ?? null,
      c['addresses_json'] ?? null,
      c['url'] ?? null,
      c['notes'] ?? null,
    )
  }

  const insTax = db.prepare(
    `INSERT INTO receipt_tax_line(item_id, label, rate_bp, amount_minor, tax_category_id)
     VALUES (?, ?, ?, ?, ?)`,
  )
  for (const line of snap.tax_lines) {
    insTax.run(
      itemId,
      line['label'],
      line['rate_bp'] ?? null,
      line['amount_minor'],
      line['tax_category_id'] ?? null,
    )
  }

  const insCf = db.prepare(
    `INSERT INTO custom_field_value(item_id, def_id, value) VALUES (?, ?, ?)`,
  )
  for (const cf of snap.custom_fields) {
    insCf.run(itemId, cf.def_id, cf.value)
  }
}

export function parseSnapshot(json: string): ItemSnapshot {
  const parsed = JSON.parse(json) as ItemSnapshot
  if (!parsed || typeof parsed !== 'object' || !parsed.item) {
    throw new Error('KeepR: corrupt merge snapshot_json')
  }
  return parsed
}
