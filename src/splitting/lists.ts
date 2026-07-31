/**
 * Resolve lookup-list names to ids for split child field overrides.
 * Inserts on miss so a typed-new category lands the same way as grid auto-add.
 */

import type { Database } from './db.ts'

export function resolveCategoryId(db: Database, name: string | null | undefined): number | null {
  if (name === null || name === undefined) return null
  const trimmed = name.trim()
  if (!trimmed) return null
  return upsertNamed(db, 'category', trimmed)
}

export function resolveTaxCategoryId(
  db: Database,
  name: string | null | undefined,
): number | null {
  if (name === null || name === undefined) return null
  const trimmed = name.trim()
  if (!trimmed) return null
  return upsertNamed(db, 'tax_category', trimmed)
}

export function resolveProjectId(db: Database, name: string | null | undefined): number | null {
  if (name === null || name === undefined) return null
  const trimmed = name.trim()
  if (!trimmed) return null
  return upsertNamed(db, 'project', trimmed)
}

function upsertNamed(
  db: Database,
  table: 'category' | 'tax_category' | 'project',
  name: string,
): number {
  const existing = db
    .prepare(`SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE LIMIT 1`)
    .get(name) as { id: number } | undefined
  if (existing) return existing.id

  const now = Date.now()
  try {
    const result = db
      .prepare(`INSERT INTO ${table}(name, is_seed, created_at) VALUES (?, 0, ?)`)
      .run(name, now)
    return Number(result.lastInsertRowid)
  } catch {
    const again = db
      .prepare(`SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE LIMIT 1`)
      .get(name) as { id: number } | undefined
    if (again) return again.id
    throw new Error(`KeepR: failed to resolve ${table} name: ${name}`)
  }
}
