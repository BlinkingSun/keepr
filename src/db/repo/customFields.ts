import type { CustomFieldType } from '../../shared/types.ts'
import type { Database } from './types.ts'

export interface CustomFieldDef {
  id: number
  scope: string
  key: string
  label: string
  datatype: CustomFieldType
  listName: string | null
  required: boolean
  sortOrder: number
}

interface DefRow {
  id: number
  scope: string
  key: string
  label: string
  datatype: string
  list_name: string | null
  required: number
  sort_order: number
}

function mapDef(r: DefRow): CustomFieldDef {
  return {
    id: r.id,
    scope: r.scope,
    key: r.key,
    label: r.label,
    datatype: r.datatype as CustomFieldType,
    listName: r.list_name,
    required: r.required === 1,
    sortOrder: r.sort_order,
  }
}

export class CustomFieldsRepo {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  listDefs(): CustomFieldDef[] {
    const rows = this.db
      .prepare(
        `SELECT id, scope, key, label, datatype, list_name, required, sort_order
           FROM custom_field_def
          ORDER BY sort_order, id`,
      )
      .all() as DefRow[]
    return rows.map(mapDef)
  }

  upsertDef(input: {
    id?: number
    scope: string
    key: string
    label: string
    datatype: CustomFieldType
    required?: boolean
    listName?: string | null
    sortOrder?: number
  }): { id: number } {
    if (input.id !== undefined) {
      this.db
        .prepare(
          `UPDATE custom_field_def
              SET scope = ?, key = ?, label = ?, datatype = ?,
                  list_name = ?, required = ?, sort_order = ?
            WHERE id = ?`,
        )
        .run(
          input.scope,
          input.key,
          input.label,
          input.datatype,
          input.listName ?? null,
          input.required ? 1 : 0,
          input.sortOrder ?? 0,
          input.id,
        )
      return { id: input.id }
    }
    const result = this.db
      .prepare(
        `INSERT INTO custom_field_def(scope, key, label, datatype, list_name, required, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.scope,
        input.key,
        input.label,
        input.datatype,
        input.listName ?? null,
        input.required ? 1 : 0,
        input.sortOrder ?? 0,
      )
    return { id: Number(result.lastInsertRowid) }
  }

  deleteDef(id: number): { ok: boolean } {
    this.db.prepare(`DELETE FROM custom_field_def WHERE id = ?`).run(id)
    return { ok: true }
  }

  getValues(itemId: number): Record<string, string | null> {
    const rows = this.db
      .prepare(
        `SELECT d.key AS key, v.value AS value
           FROM custom_field_value v
           JOIN custom_field_def d ON d.id = v.def_id
          WHERE v.item_id = ?`,
      )
      .all(itemId) as Array<{ key: string; value: string | null }>
    const out: Record<string, string | null> = {}
    for (const r of rows) out[r.key] = r.value
    return out
  }

  setValue(itemId: number, defId: number, value: string | null): void {
    this.db
      .prepare(
        `INSERT INTO custom_field_value(item_id, def_id, value)
         VALUES (?, ?, ?)
         ON CONFLICT(item_id, def_id) DO UPDATE SET value = excluded.value`,
      )
      .run(itemId, defId, value)
  }

  setValueByKey(itemId: number, key: string, value: string | null): { ok: boolean; reason?: string } {
    const def = this.db
      .prepare(`SELECT id FROM custom_field_def WHERE key = ?`)
      .get(key) as { id: number } | undefined
    if (!def) return { ok: false, reason: `unknown custom field key: ${key}` }
    this.setValue(itemId, def.id, value)
    return { ok: true }
  }
}
