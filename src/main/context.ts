/**
 * Application context — Lane 0, owned by the orchestrator.
 *
 * Assembles the one database connection, the file store, the job queue and the
 * repositories, and hands them to whoever is driving: the Electron window, or
 * the headless `--serve` mode the test API runs in. Both paths get the SAME
 * context, so a feature that passes headlessly is the same code the UI calls
 * rather than a parallel implementation that can drift.
 */
import type Database from 'better-sqlite3'
import path from 'node:path'
import { createRepositories, type Repositories } from '../db/repo/index.ts'
import { DiskFileStore } from '../store/fileStore.ts'
import type { LibraryRelPath } from '../shared/types.ts'
import { checkIntegrity, ensureSystemFolders, openLibrary } from './db.ts'
import { SqliteJobQueue } from './jobQueue.ts'

export interface AppContext {
  db: Database.Database
  repos: Repositories
  fileStore: DiskFileStore
  jobs: SqliteJobQueue
  libraryRoot: string
  dbPath: string
  schemaVersion: number
  inboxId: number
  trashId: number
  close(): void
}

export interface CreateContextOptions {
  libraryRoot: string
  schemaDir?: string
  skipBackup?: boolean
}

export function createContext(opts: CreateContextOptions): AppContext {
  const schemaDir =
    opts.schemaDir ?? path.resolve(import.meta.dirname ?? '.', '..', 'db', 'schema')

  const { db, dbPath, schemaVersion } = openLibrary({
    libraryRoot: opts.libraryRoot,
    schemaDir,
    ...(opts.skipBackup === undefined ? {} : { skipBackup: opts.skipBackup }),
  })

  const { inboxId, trashId } = ensureSystemFolders(db)

  // Citation counting lives here rather than inside the file store so the store
  // has no database dependency. A path is still cited while ANY page row
  // references it, including pages belonging to soft-trashed items — those are
  // recoverable, and unlinking their bytes would make restore return an item
  // pointing at nothing.
  const countCitations = (rel: LibraryRelPath): number =>
    (
      db
        .prepare(
          `SELECT count(*) c FROM page WHERE file_relpath = ? OR thumb_relpath = ?`,
        )
        .get(rel, rel) as { c: number }
    ).c

  const fileStore = new DiskFileStore({ libraryRoot: opts.libraryRoot, countCitations })
  const jobs = new SqliteJobQueue(db)

  // A job left 'running' by a crash would have the UI reporting work that
  // nothing is doing.
  const reaped = jobs.reapOrphans()
  if (reaped) console.warn(`[keepr] reaped ${reaped} interrupted job(s) from a previous run`)

  const repos = createRepositories({ db, fileStore })

  return {
    db,
    repos,
    fileStore,
    jobs,
    libraryRoot: opts.libraryRoot,
    dbPath,
    schemaVersion,
    inboxId,
    trashId,
    close() {
      try { db.pragma('wal_checkpoint(TRUNCATE)') } catch { /* closing anyway */ }
      db.close()
    },
  }
}

export { checkIntegrity }
