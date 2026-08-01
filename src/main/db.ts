/**
 * Library open + migration runner — Lane 0, owned by the orchestrator.
 *
 * ONE connection for the whole process. No lane opens a second one: WAL plus two
 * writers in one process produces lock timeouts and, eventually, corruption.
 *
 * Migrations are forward-only and numbered. A receipt library is a system of
 * record — it has to survive every future version of the app, so the runner
 * takes a backup before applying anything to a non-empty database, and records
 * a checksum so a migration that was edited after being applied is detected
 * rather than silently diverging.
 */
import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { applySeed } from '../rules/seed.ts'

export interface OpenOptions {
  /** Library root. Holds library.sqlite and the images/ tree. */
  libraryRoot: string
  /** Directory containing NNN_name.sql migrations. */
  schemaDir: string
  /** Skip the pre-migration backup. Tests only. */
  skipBackup?: boolean
}

export interface OpenResult {
  db: Database.Database
  dbPath: string
  schemaVersion: number
  applied: string[]
  backupPath: string | null
}

interface MigrationFile {
  id: number
  name: string
  sql: string
  checksum: string
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

function loadMigrations(schemaDir: string): MigrationFile[] {
  const files = readdirSync(schemaDir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()
  return files.map((f) => {
    const id = Number(f.split('_')[0])
    if (!Number.isInteger(id) || id < 1) throw new Error(`bad migration filename: ${f}`)
    const sql = readFileSync(path.join(schemaDir, f), 'utf8')
    return { id, name: f, sql, checksum: sha256(sql) }
  })
}

export function openLibrary(opts: OpenOptions): OpenResult {
  mkdirSync(opts.libraryRoot, { recursive: true })
  mkdirSync(path.join(opts.libraryRoot, 'images'), { recursive: true })
  const dbPath = path.join(opts.libraryRoot, 'library.sqlite')
  const isNew = !existsSync(dbPath)

  const db = new Database(dbPath)
  // foreign_keys must be set per connection; the schema file sets it too but a
  // connection opened later would otherwise silently run without it, and the
  // split guards depend on referential integrity.
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')

  const migrations = loadMigrations(opts.schemaDir)
  if (!migrations.length) throw new Error(`no migrations found in ${opts.schemaDir}`)

  const hasTable = db
    .prepare(`SELECT count(*) c FROM sqlite_master WHERE type='table' AND name='schema_migrations'`)
    .get() as { c: number }

  let backupPath: string | null = null
  const pending = (): MigrationFile[] => {
    if (!hasTable.c) return migrations
    const done = new Set(
      (db.prepare(`SELECT name FROM schema_migrations`).all() as { name: string }[]).map((r) => r.name),
    )
    return migrations.filter((m) => !done.has(m.name))
  }

  const toApply = pending()

  // Back up before touching an existing library. A migration that goes wrong on
  // someone's only copy of five years of receipts is unrecoverable otherwise.
  //
  // Guarded on hasTable as well as isNew, because "the file exists" does not mean
  // "there is a schema to protect": a crash during the very first run leaves a
  // created-but-unmigrated database, and reading schema_migrations from it throws.
  // There is nothing worth backing up in that state anyway.
  if (toApply.length && !isNew && hasTable.c && !opts.skipBackup) {
    const dir = path.join(opts.libraryRoot, 'backups')
    mkdirSync(dir, { recursive: true })
    const stamp = String(
      (db.prepare('SELECT COALESCE(MAX(id),0) m FROM schema_migrations').get() as { m: number }).m,
    ).padStart(3, '0')
    backupPath = path.join(dir, `pre-migration-${stamp}.sqlite`)
    // Checkpoint first: copying a live WAL database without one can capture a
    // db file whose newest committed rows are still only in the -wal.
    db.pragma('wal_checkpoint(TRUNCATE)')
    copyFileSync(dbPath, backupPath)
  }

  const applied: string[] = []
  for (const m of toApply) {
    // Each migration is one transaction: a half-applied schema is worse than no
    // migration at all.
    db.exec('BEGIN')
    try {
      db.exec(m.sql)
      db.prepare(
        `INSERT INTO schema_migrations(id, name, checksum, applied_at) VALUES (?,?,?,?)`,
      ).run(m.id, m.name, m.checksum, Date.now())
      db.exec('COMMIT')
      applied.push(m.name)
    } catch (e) {
      db.exec('ROLLBACK')
      throw new Error(`migration ${m.name} failed and was rolled back: ${(e as Error).message}`)
    }
  }

  // Detect a migration whose file changed after it was applied. Not fatal — the
  // schema on disk is already what it is — but it must be loud, because it means
  // two installs claiming the same version may not have the same schema.
  const drift: string[] = []
  for (const row of db.prepare(`SELECT name, checksum FROM schema_migrations`).all() as {
    name: string
    checksum: string
  }[]) {
    const m = migrations.find((x) => x.name === row.name)
    if (m && m.checksum !== row.checksum) drift.push(row.name)
  }
  if (drift.length) {
    console.warn(
      `[keepr] WARNING: these migrations were modified after being applied: ${drift.join(', ')}. ` +
        `Two installs reporting the same schema version may not actually match.`,
    )
  }

  const schemaVersion = (
    db.prepare('SELECT COALESCE(MAX(id),0) v FROM schema_migrations').get() as { v: number }
  ).v
  db.pragma(`user_version = ${schemaVersion}`)

  return { db, dbPath, schemaVersion, applied, backupPath }
}

/**
 * Seeds the folders and lookup lists every library needs. Idempotent.
 *
 * The list seed was written by Lane A and then never called from anywhere — 87
 * vendors with default categories, 24 categories, 27 tax categories and 15 payment
 * types sitting as dead code. The visible consequence: no imported receipt ever
 * got a category, because the vendor to category rule needs a seeded vendor with a
 * default to match against, so every single receipt came in flagged as incomplete.
 * A seed that is never applied is indistinguishable from no seed at all.
 */
export function ensureSystemFolders(
  db: Database.Database,
  opts: { seed?: boolean } = {},
): { inboxId: number; trashId: number } {
  const now = Date.now()
  const get = (kind: string) =>
    (db.prepare(`SELECT id FROM folder WHERE kind = ?`).get(kind) as { id: number } | undefined)?.id
  const mk = (kind: string, name: string) =>
    db
      .prepare(`INSERT INTO folder(kind, name, created_at, modified_at) VALUES (?,?,?,?)`)
      .run(kind, name, now, now).lastInsertRowid as number

  const inboxId = get('inbox') ?? mk('inbox', 'Inbox')
  const trashId = get('trash') ?? mk('trash', 'Trash')

  // Only seed a genuinely empty library: re-running it over a library where the
  // user has curated their own lists would resurrect entries they deleted.
  const vendorCount = (db.prepare('SELECT count(*) c FROM vendor').get() as { c: number }).c
  const categoryCount = (db.prepare('SELECT count(*) c FROM category').get() as { c: number }).c
  if (opts.seed !== false && vendorCount === 0 && categoryCount === 0) {
    const counts = applySeed(db, now)
    console.log(
      `[keepr] seeded lists: ${counts.vendors} vendors, ${counts.categories} categories, ` +
        `${counts.taxCategories} tax categories, ${counts.paymentTypes} payment types`,
    )
  }

  if (!(db.prepare('SELECT count(*) c FROM cabinet').get() as { c: number }).c) {
    db.prepare(
      `INSERT INTO cabinet(id, display_name, base_currency, created_at, modified_at)
       VALUES (1, ?, 'USD', ?, ?)`,
    ).run('My Cabinet', now, now)
  }
  return { inboxId, trashId }
}

/**
 * Graph-integrity check. Backup verification asserts THIS, not a byte
 * comparison: identical bytes are neither necessary nor sufficient for a correct
 * library, and the audit was right to reject "byte-identical" as a criterion.
 */
export function checkIntegrity(db: Database.Database): Array<{ name: string; ok: boolean; detail: string }> {
  const out: Array<{ name: string; ok: boolean; detail: string }> = []
  const add = (name: string, ok: boolean, detail = '') => out.push({ name, ok, detail })

  const fk = db.pragma('foreign_key_check') as unknown[]
  add('foreign keys', fk.length === 0, fk.length ? `${fk.length} violation(s)` : 'clean')

  const quick = db.pragma('quick_check', { simple: true }) as unknown as string
  add('sqlite quick_check', quick === 'ok', String(quick))

  const drift = db
    .prepare(`SELECT count(*) c FROM v_split_reconciliation WHERE child_count > 0 AND drift_minor <> 0`)
    .get() as { c: number }
  add('split totals reconcile', drift.c === 0, drift.c ? `${drift.c} split group(s) drift` : 'no drift')

  const taxDrift = db
    .prepare(`SELECT count(*) c FROM v_split_reconciliation WHERE child_count > 0 AND tax_drift_minor <> 0`)
    .get() as { c: number }
  add('split tax reconciles', taxDrift.c === 0, taxDrift.c ? `${taxDrift.c} group(s) tax drift` : 'no drift')

  const curMix = db
    .prepare(`SELECT count(*) c FROM v_split_reconciliation WHERE currency_mismatch_count > 0`)
    .get() as { c: number }
  add('split currencies consistent', curMix.c === 0, curMix.c ? `${curMix.c} group(s) mismatched` : 'consistent')

  const absPaths = db
    .prepare(`SELECT count(*) c FROM page WHERE file_relpath LIKE '/%' OR file_relpath LIKE '_:%'`)
    .get() as { c: number }
  add('media paths are relative', absPaths.c === 0, absPaths.c ? `${absPaths.c} absolute path(s)` : 'all relative')

  for (const t of ['page_fts', 'item_fts']) {
    try {
      db.prepare(`INSERT INTO ${t}(${t}) VALUES('integrity-check')`).run()
      add(`${t} index`, true, 'ok')
    } catch (e) {
      add(`${t} index`, false, (e as Error).message)
    }
  }
  return out
}
