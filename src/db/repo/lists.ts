import { normalizeVendorName } from './normalize.ts'
import type { Database } from './types.ts'

export type ListName = 'vendor' | 'category' | 'tax_category' | 'payment_type' | 'project'

export interface ListValue {
  id: number
  name: string
}

export interface UpsertResult {
  id: number
  created: boolean
}

interface NamedRow {
  id: number
  name: string
}

export class ListsRepo {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  all(list: ListName): ListValue[] {
    switch (list) {
      case 'vendor':
        return (
          this.db.prepare(`SELECT id, name FROM vendor ORDER BY name COLLATE NOCASE`).all() as NamedRow[]
        ).map((r) => ({ id: r.id, name: r.name }))
      case 'category':
        return (
          this.db.prepare(`SELECT id, name FROM category ORDER BY name COLLATE NOCASE`).all() as NamedRow[]
        ).map((r) => ({ id: r.id, name: r.name }))
      case 'tax_category':
        return (
          this.db
            .prepare(`SELECT id, name FROM tax_category ORDER BY name COLLATE NOCASE`)
            .all() as NamedRow[]
        ).map((r) => ({ id: r.id, name: r.name }))
      case 'payment_type':
        return (
          this.db
            .prepare(`SELECT id, name FROM payment_type ORDER BY name COLLATE NOCASE`)
            .all() as NamedRow[]
        ).map((r) => ({ id: r.id, name: r.name }))
      case 'project':
        return (
          this.db.prepare(`SELECT id, name FROM project ORDER BY name COLLATE NOCASE`).all() as NamedRow[]
        ).map((r) => ({ id: r.id, name: r.name }))
      default: {
        const _exhaustive: never = list
        throw new Error(`unknown list: ${_exhaustive}`)
      }
    }
  }

  /**
   * Upsert by display name. Vendors match on normalized_name so near-duplicates
   * collapse to one id.
   */
  upsertByName(list: ListName, name: string): UpsertResult {
    const trimmed = name.trim()
    if (!trimmed) throw new Error(`${list} name is empty`)
    const now = Date.now()

    switch (list) {
      case 'vendor':
        return this.upsertVendor(trimmed, now)
      case 'category':
        return this.upsertSimple('category', trimmed, now)
      case 'tax_category':
        return this.upsertSimple('tax_category', trimmed, now)
      case 'payment_type':
        return this.upsertSimple('payment_type', trimmed, now)
      case 'project':
        return this.upsertSimple('project', trimmed, now)
      default: {
        const _exhaustive: never = list
        throw new Error(`unknown list: ${_exhaustive}`)
      }
    }
  }

  private upsertVendor(name: string, now: number): UpsertResult {
    const norm = normalizeVendorName(name)
    const existing = this.db
      .prepare(`SELECT id FROM vendor WHERE normalized_name = ? LIMIT 1`)
      .get(norm) as { id: number } | undefined
    if (existing) return { id: existing.id, created: false }

    // Also match exact unique name (race-safe path if norm differs but name collides).
    const byName = this.db
      .prepare(`SELECT id FROM vendor WHERE name = ? LIMIT 1`)
      .get(name) as { id: number } | undefined
    if (byName) return { id: byName.id, created: false }

    try {
      const result = this.db
        .prepare(
          `INSERT INTO vendor(name, normalized_name, is_seed, created_at)
           VALUES (?, ?, 0, ?)`,
        )
        .run(name, norm, now)
      return { id: Number(result.lastInsertRowid), created: true }
    } catch (e: unknown) {
      // Unique race: re-select.
      const again =
        (this.db.prepare(`SELECT id FROM vendor WHERE normalized_name = ? LIMIT 1`).get(norm) as
          | { id: number }
          | undefined) ??
        (this.db.prepare(`SELECT id FROM vendor WHERE name = ? LIMIT 1`).get(name) as
          | { id: number }
          | undefined)
      if (again) return { id: again.id, created: false }
      throw e
    }
  }

  private upsertSimple(
    table: 'category' | 'tax_category' | 'payment_type' | 'project',
    name: string,
    now: number,
  ): UpsertResult {
    const existing = this.db
      .prepare(`SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE LIMIT 1`)
      .get(name) as { id: number } | undefined
    if (existing) return { id: existing.id, created: false }

    try {
      const result = this.db
        .prepare(`INSERT INTO ${table}(name, is_seed, created_at) VALUES (?, 0, ?)`)
        .run(name, now)
      return { id: Number(result.lastInsertRowid), created: true }
    } catch (e: unknown) {
      const again = this.db
        .prepare(`SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE LIMIT 1`)
        .get(name) as { id: number } | undefined
      if (again) return { id: again.id, created: false }
      throw e
    }
  }
}
