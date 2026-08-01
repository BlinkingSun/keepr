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
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { createRepositories, type Repositories } from '../db/repo/index.ts'
import type { IngestDeps } from '../ingest/types.ts'
import type { MaintenanceContext } from '../maintenance/types.ts'
import { createOcrProvider } from '../ocr/provider.ts'
import { createImagePool } from '../workers/imagePool.ts'
import { DiskFileStore } from '../store/fileStore.ts'
import type { LibraryRelPath } from '../shared/types.ts'
import { checkIntegrity, ensureSystemFolders, openLibrary } from './db.ts'
import { SqliteJobQueue } from './jobQueue.ts'
import { createNewReceiptsWatcher } from '../ingest/watchFolders.ts'

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
  /** User-facing drop zone: files here are auto-ingested then archived to Old. */
  newReceiptsDir: string
  /** Human-browsable archive of ingested originals; scans are born here. */
  oldReceiptsDir: string
  /** Live watched-folder state from the running watcher. */
  watcherStatus(): {
    watching: boolean; newDir: string; oldDir: string
    pendingCount: number; failed: Array<{ name: string; reason: string }>
  }
  /** Start auto-ingesting New Receipts. Idempotent; called once main is ready. */
  startWatcher(onActivity?: (e: { ingested: number; duplicates: number; failed: number }) => void): void
  /**
   * Ingest dependencies, created on FIRST USE rather than at startup.
   *
   * The OCR scheduler spawns worker threads and loads a 5 MB language model; the
   * image pool holds libvips workers. Paying that on every launch would slow the
   * window down for a user who only wants to look at last month's totals. The
   * first import absorbs it instead.
   */
  ingest(): IngestDeps
  /** Context shape the maintenance lane expects. */
  maintenance(): MaintenanceContext
  close(): void
}

export interface CreateContextOptions {
  libraryRoot: string
  schemaDir?: string
  skipBackup?: boolean
  /**
   * Skip seeding the lookup lists. Tests only.
   *
   * A real library wants the 87 seeded vendors and their default categories — that
   * is what makes an imported receipt arrive already categorised. A test fixture
   * that inserts its own 'Materials' category wants an empty slate, and would
   * otherwise collide on the unique name.
   */
  skipSeed?: boolean
}

/**
 * Locate the migrations directory across every way this code runs, rather than
 * assuming one layout:
 *   - bundled Electron (CJS): dist/main/index.js, schema copied to dist/schema
 *   - packaged app: same, inside the app resources
 *   - dev via node --experimental-strip-types: src/main/*.ts next to src/db/schema
 *
 * The first attempt resolved against `import.meta.dirname`, which is undefined in
 * the CJS bundle — so it silently fell back to the process working directory and
 * looked for the schema one level above the project. Failing loudly with the list
 * of paths tried beats guessing.
 */
function resolveSchemaDir(explicit?: string): string {
  if (explicit) return explicit
  const here =
    typeof __dirname !== 'undefined'
      ? __dirname
      : path.dirname(new URL(import.meta.url).pathname)

  const candidates = [
    path.resolve(here, '..', 'schema'), // dist/main -> dist/schema (bundled)
    path.resolve(here, '..', 'db', 'schema'), // src/main -> src/db/schema (dev)
    path.resolve(here, '..', '..', 'src', 'db', 'schema'),
    path.resolve(process.cwd(), 'src', 'db', 'schema'),
  ]
  for (const c of candidates) {
    if (existsSync(path.join(c, '001_initial.sql'))) return c
  }
  throw new Error(
    `cannot locate the migrations directory. Tried:\n  ${candidates.join('\n  ')}`,
  )
}

export function createContext(opts: CreateContextOptions): AppContext {
  const schemaDir = resolveSchemaDir(opts.schemaDir)

  const { db, dbPath, schemaVersion } = openLibrary({
    libraryRoot: opts.libraryRoot,
    schemaDir,
    ...(opts.skipBackup === undefined ? {} : { skipBackup: opts.skipBackup }),
  })

  const { inboxId, trashId } = ensureSystemFolders(db, { seed: opts.skipSeed !== true })

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

  // The filesystem-visible workflow the user asked for: "so we can tell what has
  // and hasn't been scanned in". New Receipts is the drop zone; Old Receipts is
  // where originals land only after their content is confirmed in the library.
  const newReceiptsDir = path.join(opts.libraryRoot, 'New Receipts')
  const oldReceiptsDir = path.join(opts.libraryRoot, 'Old Receipts')
  mkdirSync(newReceiptsDir, { recursive: true })
  mkdirSync(oldReceiptsDir, { recursive: true })

  const fileStore = new DiskFileStore({ libraryRoot: opts.libraryRoot, countCitations })
  const jobs = new SqliteJobQueue(db)

  // A job left 'running' by a crash would have the UI reporting work that
  // nothing is doing.
  const reaped = jobs.reapOrphans()
  if (reaped) console.warn(`[keepr] reaped ${reaped} interrupted job(s) from a previous run`)

  const repos = createRepositories({ db, fileStore })

  // Lazily constructed and then reused. Building these twice would create a
  // second OCR scheduler and a second image pool, which is exactly the nested
  // worker-pool problem the plan forbids.
  let ingestDeps: IngestDeps | null = null
  let watcher: ReturnType<typeof createNewReceiptsWatcher> | null = null
  const ingest = (): IngestDeps => {
    if (!ingestDeps) {
      ingestDeps = {
        repos,
        fileStore,
        jobs,
        ocr: createOcrProvider(),
        imagePool: createImagePool(),
        // Deliberately small: tesseract.js runs its own threads underneath, so a
        // high number here multiplies WASM heaps rather than throughput.
        ocrConcurrency: 2,
      }
    }
    return ingestDeps
  }

  const maintenance = (): MaintenanceContext => ({
    db, dbPath, libraryRoot: opts.libraryRoot, fileStore,
    close: () => { try { db.pragma('wal_checkpoint(TRUNCATE)') } catch { /* ignore */ } db.close() },
  })

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
    newReceiptsDir,
    oldReceiptsDir,
    watcherStatus: () =>
      watcher
        ? { ...watcher.status(), newDir: newReceiptsDir, oldDir: oldReceiptsDir }
        : {
            watching: false, newDir: newReceiptsDir, oldDir: oldReceiptsDir,
            pendingCount: 0, failed: [],
          },
    startWatcher(onActivity) {
      if (watcher) return
      // Watcher deps come from ingest(): construction is cheap (the OCR
      // scheduler only spins up when a file is actually processed), so a quiet
      // watcher costs nothing at boot.
      watcher = createNewReceiptsWatcher(ingest(), {
        newDir: newReceiptsDir,
        oldDir: oldReceiptsDir,
      })
      if (onActivity) watcher.onActivity(onActivity)
      watcher.start()
    },
    ingest,
    maintenance,
    close() {
      watcher?.stop()
      watcher = null
      // Dispose OCR workers first: they are separate threads and would otherwise
      // keep the process alive after the window closes.
      if (ingestDeps) {
        try { void ingestDeps.ocr.dispose() } catch { /* shutting down anyway */ }
      }
      try { db.pragma('wal_checkpoint(TRUNCATE)') } catch { /* closing anyway */ }
      db.close()
    },
  }
}

export { checkIntegrity }
