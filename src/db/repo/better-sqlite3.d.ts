/**
 * Minimal ambient types for better-sqlite3 (not shipped with the package;
 * @types/better-sqlite3 is not a project dependency). Scoped under repo for tsc.
 */
declare module 'better-sqlite3' {
  interface RunResult {
    changes: number
    lastInsertRowid: number | bigint
  }

  interface Statement {
    run(...params: unknown[]): RunResult
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
    iterate(...params: unknown[]): IterableIterator<unknown>
  }

  interface Database {
    prepare(sql: string): Statement
    exec(sql: string): this
    pragma(source: string, options?: { simple?: boolean }): unknown
    transaction<T extends (...args: never[]) => unknown>(fn: T): T
    close(): void
  }

  interface DatabaseConstructor {
    new (filename: string, options?: { readonly?: boolean; fileMustExist?: boolean }): Database
    (filename: string, options?: { readonly?: boolean; fileMustExist?: boolean }): Database
  }

  const Database: DatabaseConstructor
  export default Database
}
