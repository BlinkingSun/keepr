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

/**
 * The real better-sqlite3 instance type, from @types/better-sqlite3.
 *
 * This was a hand-rolled structural interface while package.json was frozen
 * during wave 2. The execution audit flagged the risk: a thin shim types future
 * calls green that are wrong at runtime, and it had already drifted — it declared
 * `transaction<T>(fn: T): T` where the real signature returns a `Transaction<T>`
 * carrying .deferred / .immediate / .exclusive. Now that integration owns
 * package.json again, use the genuine types so the compiler checks against
 * reality rather than against our summary of it.
 */
export type Database = import('better-sqlite3').Database

export type { FileStore } from '../../shared/types.ts'
