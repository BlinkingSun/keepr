import type { Database, MissingKeyDataRow } from './types.ts'

/**
 * Receipts missing key data (§6), via the canonical view only.
 * Never reconstructs the missing flags by hand — v_missing_key_data already
 * gates on v_summable_receipts (live, non-superseded receipts).
 */
export function missingKeyData(db: Database, folderId?: number): MissingKeyDataRow[] {
  const sql =
    folderId === undefined
      ? `SELECT item_id, folder_id, missing_vendor, missing_date, missing_total,
                missing_category, missing_tax_category
           FROM v_missing_key_data
          ORDER BY item_id`
      : `SELECT item_id, folder_id, missing_vendor, missing_date, missing_total,
                missing_category, missing_tax_category
           FROM v_missing_key_data
          WHERE folder_id = ?
          ORDER BY item_id`

  const rows =
    folderId === undefined
      ? (db.prepare(sql).all() as Array<Record<string, number>>)
      : (db.prepare(sql).all(folderId) as Array<Record<string, number>>)

  return rows.map((r) => ({
    itemId: r.item_id as number,
    folderId: r.folder_id as number,
    missingVendor: r.missing_vendor === 1,
    missingDate: r.missing_date === 1,
    missingTotal: r.missing_total === 1,
    missingCategory: r.missing_category === 1,
    missingTaxCategory: r.missing_tax_category === 1,
  }))
}
