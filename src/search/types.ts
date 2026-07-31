/**
 * Local DB surface for search. Matches better-sqlite3; we do not open
 * connections here — main / tests pass an already-open Database.
 */
export type SqlParam = string | number | bigint | Buffer | null | undefined

export interface Statement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

export interface Database {
  prepare(sql: string): Statement
  exec(sql: string): unknown
}

export interface MissingKeyDataRow {
  itemId: number
  folderId: number
  missingVendor: boolean
  missingDate: boolean
  missingTotal: boolean
  missingCategory: boolean
  missingTaxCategory: boolean
}
