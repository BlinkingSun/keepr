/**
 * Minimal structural type for the better-sqlite3 Database we receive from main.
 * We do not open connections in this lane — main owns the single connection.
 */

export type SqlParam = string | number | bigint | Buffer | null | undefined

export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

export interface Statement {
  run(...params: unknown[]): RunResult
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
  iterate(...params: unknown[]): IterableIterator<unknown>
}

export interface Database {
  prepare(sql: string): Statement
  exec(sql: string): this
  pragma(source: string, options?: { simple?: boolean }): unknown
  transaction<T extends (...args: never[]) => unknown>(fn: T): T
  close(): void
}

export type { FileStore } from '../../shared/types.ts'
