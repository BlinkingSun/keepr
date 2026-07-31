/**
 * Structural Database type for better-sqlite3 — mirrors the repo lane's approach.
 * Lane I does not open connections; callers pass an already-open handle.
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
}

export type Database = import('better-sqlite3').Database

export function nowMs(): number {
  return Date.now()
}

export function asErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}
