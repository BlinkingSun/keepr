import type { Folder } from '../../shared/types.ts'
import { asCivilDate } from '../../shared/types.ts'
import type { Database } from './types.ts'

interface FolderRow {
  id: number
  parent_id: number | null
  kind: string
  name: string
  template: string | null
  period_end: string | null
  comments: string | null
  labels_json: string | null
  sort_order: number
  created_at: number
  modified_at: number
}

function mapFolder(r: FolderRow): Folder {
  let labels: string[] = []
  if (r.labels_json) {
    try {
      const parsed: unknown = JSON.parse(r.labels_json)
      if (Array.isArray(parsed)) labels = parsed.map(String)
    } catch {
      labels = []
    }
  }
  return {
    id: r.id,
    parentId: r.parent_id,
    kind: r.kind as Folder['kind'],
    name: r.name,
    template: r.template,
    periodEnd: r.period_end ? asCivilDate(r.period_end) : null,
    comments: r.comments,
    labels,
    sortOrder: r.sort_order,
    createdAt: r.created_at as Folder['createdAt'],
    modifiedAt: r.modified_at as Folder['modifiedAt'],
  }
}

export class FoldersRepo {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  /** Tree-ordered: depth-first, siblings by sort_order then name. */
  list(): Folder[] {
    const rows = this.db
      .prepare(
        `SELECT id, parent_id, kind, name, template, period_end, comments,
                labels_json, sort_order, created_at, modified_at
           FROM folder`,
      )
      .all() as FolderRow[]

    const byParent = new Map<number | null, FolderRow[]>()
    for (const r of rows) {
      const key = r.parent_id
      const list = byParent.get(key) ?? []
      list.push(r)
      byParent.set(key, list)
    }
    for (const list of byParent.values()) {
      list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name) || a.id - b.id)
    }

    const out: Folder[] = []
    const walk = (parentId: number | null) => {
      const kids = byParent.get(parentId) ?? []
      for (const k of kids) {
        out.push(mapFolder(k))
        walk(k.id)
      }
    }
    walk(null)
    return out
  }

  create(input: { parentId: number | null; name: string; kind?: Folder['kind'] }): Folder {
    const now = Date.now()
    const kind = input.kind ?? 'user'
    const result = this.db
      .prepare(
        `INSERT INTO folder(parent_id, kind, name, sort_order, created_at, modified_at)
         VALUES (?, ?, ?, 0, ?, ?)`,
      )
      .run(input.parentId, kind, input.name.trim(), now, now)
    const id = Number(result.lastInsertRowid)
    const row = this.getRow(id)
    if (!row) throw new Error(`folder ${id} missing after insert`)
    return mapFolder(row)
  }

  update(
    id: number,
    patch: Partial<Pick<Folder, 'name' | 'parentId' | 'periodEnd' | 'comments' | 'template' | 'sortOrder'>>,
  ): Folder {
    const existing = this.getRow(id)
    if (!existing) throw new Error(`folder not found: ${id}`)

    const name = patch.name !== undefined ? patch.name.trim() : existing.name
    const parentId = patch.parentId !== undefined ? patch.parentId : existing.parent_id
    const periodEnd =
      patch.periodEnd !== undefined
        ? patch.periodEnd
        : existing.period_end
    const comments = patch.comments !== undefined ? patch.comments : existing.comments
    const template = patch.template !== undefined ? patch.template : existing.template
    const sortOrder = patch.sortOrder !== undefined ? patch.sortOrder : existing.sort_order
    const now = Date.now()

    this.db
      .prepare(
        `UPDATE folder
            SET parent_id = ?, name = ?, period_end = ?, comments = ?,
                template = ?, sort_order = ?, modified_at = ?
          WHERE id = ?`,
      )
      .run(parentId, name, periodEnd, comments, template, sortOrder, now, id)

    const row = this.getRow(id)
    if (!row) throw new Error(`folder ${id} missing after update`)
    return mapFolder(row)
  }

  /**
   * RESTRICT delete when the folder has children or items.
   * Returns a reason instead of throwing a raw SQLite error.
   */
  delete(id: number): { ok: boolean; reason?: string } {
    const existing = this.getRow(id)
    if (!existing) return { ok: false, reason: 'folder not found' }
    if (existing.kind === 'inbox' || existing.kind === 'trash') {
      return { ok: false, reason: `cannot delete system folder kind=${existing.kind}` }
    }

    const childFolders = this.db
      .prepare(`SELECT COUNT(*) AS c FROM folder WHERE parent_id = ?`)
      .get(id) as { c: number }
    if (childFolders.c > 0) {
      return { ok: false, reason: 'folder has child folders' }
    }

    const items = this.db
      .prepare(`SELECT COUNT(*) AS c FROM item WHERE folder_id = ?`)
      .get(id) as { c: number }
    if (items.c > 0) {
      return { ok: false, reason: 'folder is not empty' }
    }

    this.db.prepare(`DELETE FROM folder WHERE id = ?`).run(id)
    return { ok: true }
  }

  /** Breadcrumb path from root to this folder (inclusive). */
  pathOf(id: number): Folder[] {
    const path: Folder[] = []
    let current: number | null = id
    const seen = new Set<number>()
    while (current !== null) {
      if (seen.has(current)) break
      seen.add(current)
      const row = this.getRow(current)
      if (!row) break
      path.unshift(mapFolder(row))
      current = row.parent_id
    }
    return path
  }

  /** Self + all descendants — for includeSubfolders queries. */
  descendantIds(id: number): number[] {
    const rows = this.db
      .prepare(
        `WITH RECURSIVE tree(id) AS (
           SELECT id FROM folder WHERE id = ?
           UNION ALL
           SELECT f.id FROM folder f JOIN tree t ON f.parent_id = t.id
         )
         SELECT id FROM tree`,
      )
      .all(id) as Array<{ id: number }>
    return rows.map((r) => r.id)
  }

  private getRow(id: number): FolderRow | undefined {
    return this.db
      .prepare(
        `SELECT id, parent_id, kind, name, template, period_end, comments,
                labels_json, sort_order, created_at, modified_at
           FROM folder WHERE id = ?`,
      )
      .get(id) as FolderRow | undefined
  }
}
