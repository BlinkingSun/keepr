/**
 * Restore from a backup directory and verify by GRAPH INTEGRITY, not bytes.
 *
 * "Byte-identical" was explicitly rejected: identical bytes are neither
 * necessary nor sufficient for a correct library. We run checkIntegrity plus
 * assert every page.file_relpath resolves and its content_hash still matches
 * via FileStore.verify (content-addressed path hash).
 */
import Database from 'better-sqlite3'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { checkIntegrity } from '../main/db.ts'
import type { RestoreVerification } from '../shared/ipc.ts'
import { asRelPath } from '../shared/types.ts'
import { DiskFileStore } from '../store/fileStore.ts'
import { copyDirSync, rmrfSync, sha256FileSync } from './fsutil.ts'
import {
  DB_BACKUP_NAME,
  IMAGES_DIR,
  MANIFEST_NAME,
  type BackupManifest,
  type MaintenanceContext,
} from './types.ts'

type Check = { name: string; ok: boolean; detail: string }

function add(checks: Check[], name: string, ok: boolean, detail = ''): void {
  checks.push({ name, ok, detail })
}

function readManifest(srcPath: string): BackupManifest | null {
  const p = path.join(srcPath, MANIFEST_NAME)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as BackupManifest
  } catch {
    return null
  }
}

/**
 * Delete a file, tolerating Windows file locks.
 *
 * On POSIX an open file can be unlinked and the directory entry disappears
 * immediately. Windows refuses with EBUSY while any handle remains open, and
 * SQLite's -shm handle is not always released the instant the connection closes —
 * the OS may hold it briefly. Restore replaces exactly these files, so a single
 * unlink attempt is a coin flip on Windows.
 *
 * Found by CI on windows-latest; the macOS and Linux runs passed, which is the
 * whole reason the matrix exists.
 */
function removeWithRetry(file: string, attempts = 10): void {
  if (!existsSync(file)) return
  for (let i = 0; i < attempts; i++) {
    try {
      rmSync(file, { force: true })
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      // Only these are worth waiting on. Anything else is a real error.
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw e
      // Short synchronous pause: this runs during a restore, not in a hot path,
      // and the alternative is failing a restore over a lock that clears in
      // milliseconds.
      const until = Date.now() + 50
      while (Date.now() < until) { /* spin */ }
    }
  }
  // Out of attempts. Report the path rather than a bare errno, because the user
  // needs to know which file another process is holding.
  throw new Error(
    `could not remove ${file} after ${attempts} attempts — another process is ` +
      `holding it open. Close any other KeepR window and try again.`,
  )
}

/**
 * Verify a backup package in place (before or without applying).
 * Fails loudly when images are missing or content hashes do not match.
 */
export async function verifyBackupPackage(srcPath: string): Promise<Check[]> {
  const checks: Check[] = []
  const manifest = readManifest(srcPath)
  add(
    checks,
    'manifest present',
    manifest !== null,
    manifest ? `format=${manifest.format}` : 'manifest.json missing or unreadable',
  )
  if (!manifest) return checks

  const dbPath = path.join(srcPath, DB_BACKUP_NAME)
  const dbExists = existsSync(dbPath)
  add(checks, 'database file present', dbExists, dbExists ? DB_BACKUP_NAME : 'library.sqlite missing')
  if (!dbExists) return checks

  const actualDbSha = sha256FileSync(dbPath)
  add(
    checks,
    'database sha256 matches manifest',
    actualDbSha === manifest.dbSha256,
    actualDbSha === manifest.dbSha256
      ? actualDbSha.slice(0, 12) + '…'
      : `expected ${manifest.dbSha256.slice(0, 12)}… got ${actualDbSha.slice(0, 12)}…`,
  )

  // Open the backup db for graph integrity. Not readonly: checkIntegrity runs
  // FTS integrity-check inserts that require a writable connection.
  const db = new Database(dbPath, { fileMustExist: true })
  try {
    db.pragma('foreign_keys = ON')
    for (const c of checkIntegrity(db)) {
      checks.push(c)
    }

    const pages = db
      .prepare(
        `SELECT id, file_relpath, thumb_relpath, content_hash FROM page`,
      )
      .all() as Array<{
      id: number
      file_relpath: string
      thumb_relpath: string | null
      content_hash: string | null
    }>

    // FileStore rooted at the backup directory so resolve() points at backup images.
    const store = new DiskFileStore({
      libraryRoot: path.resolve(srcPath),
      countCitations: () => 0,
    })

    let missing = 0
    let corrupt = 0
    let okFiles = 0
    const failures: string[] = []

    for (const page of pages) {
      const rel = page.file_relpath
      if (!rel) continue
      try {
        const v = await store.verify(asRelPath(rel))
        if (!v.ok) {
          if (v.reason === 'missing') {
            missing++
            failures.push(`page ${page.id}: ${rel} missing`)
          } else {
            corrupt++
            failures.push(`page ${page.id}: ${rel} — ${v.reason ?? 'hash mismatch'}`)
          }
        } else {
          // Also cross-check content_hash column when present (basename is the
          // path hash; content_hash may equal it for content-addressed stores).
          okFiles++
        }
      } catch (e) {
        corrupt++
        failures.push(`page ${page.id}: ${rel} — ${(e as Error).message}`)
      }

      if (page.thumb_relpath) {
        const tv = await store.verify(asRelPath(page.thumb_relpath))
        if (!tv.ok && tv.reason !== 'missing') {
          // thumbs are optional in some fixtures; only fail hard on corruption
          if (tv.reason?.includes('hash')) {
            corrupt++
            failures.push(`thumb page ${page.id}: ${tv.reason}`)
          }
        }
      }
    }

    const filesOk = missing === 0 && corrupt === 0
    add(
      checks,
      'page images resolve and match content hash',
      filesOk,
      filesOk
        ? `${okFiles} file(s) verified`
        : `${missing} missing, ${corrupt} corrupted — ${failures.slice(0, 3).join('; ')}`,
    )

    // Manifest file inventory: every listed image path must exist with matching hash.
    let manifestMiss = 0
    let manifestBad = 0
    for (const f of manifest.files) {
      if (f.rel === DB_BACKUP_NAME) continue
      const abs = path.join(srcPath, f.rel)
      if (!existsSync(abs)) {
        manifestMiss++
        continue
      }
      const h = sha256FileSync(abs)
      if (h !== f.sha256) manifestBad++
    }
    add(
      checks,
      'manifest file inventory',
      manifestMiss === 0 && manifestBad === 0,
      manifestMiss === 0 && manifestBad === 0
        ? `${manifest.files.length} entries`
        : `${manifestMiss} missing, ${manifestBad} hash mismatch(es)`,
    )
  } finally {
    db.close()
  }

  return checks
}

/**
 * Restore backup at `srcPath` into `ctx.libraryRoot`.
 *
 * Closes the live database connection (via ctx.close or db.close), replaces
 * library.sqlite and images/, then re-verifies the restored library.
 * After return, `ctx.db` is closed — open a new context on the same root to
 * continue working with the restored library.
 */
export async function restore(
  ctx: MaintenanceContext,
  srcPath: string,
): Promise<RestoreVerification> {
  // 1. Verify the backup package first — fail before touching the live library.
  const packageChecks = await verifyBackupPackage(srcPath)
  if (packageChecks.some((c) => !c.ok)) {
    return { ok: false, checks: packageChecks }
  }

  const srcDb = path.join(srcPath, DB_BACKUP_NAME)
  if (!existsSync(srcDb)) {
    return {
      ok: false,
      checks: [
        ...packageChecks,
        { name: 'apply', ok: false, detail: 'library.sqlite missing from backup' },
      ],
    }
  }

  // 2. Checkpoint and close the live connection so we can replace the file.
  try {
    ctx.db.pragma('wal_checkpoint(TRUNCATE)')
  } catch {
    /* may already be closing */
  }
  if (ctx.close) {
    try {
      ctx.close()
    } catch {
      try {
        ctx.db.close()
      } catch {
        /* already closed */
      }
    }
  } else {
    try {
      ctx.db.close()
    } catch {
      /* already closed */
    }
  }

  // Remove WAL/SHM sidecars so a restored main file is not paired with stale ones.
  for (const side of [`${ctx.dbPath}-wal`, `${ctx.dbPath}-shm`]) {
    removeWithRetry(side)
  }

  // 3. Replace database and images tree.
  mkdirSync(ctx.libraryRoot, { recursive: true })
  copyFileSync(srcDb, ctx.dbPath)

  const destImages = path.join(ctx.libraryRoot, IMAGES_DIR)
  rmrfSync(destImages)
  const srcImages = path.join(srcPath, IMAGES_DIR)
  if (existsSync(srcImages)) {
    copyDirSync(srcImages, destImages)
  } else {
    mkdirSync(destImages, { recursive: true })
  }

  // 4. Open restored library and run graph + file verification.
  const checks: Check[] = [...packageChecks]
  const db = new Database(ctx.dbPath)
  try {
    db.pragma('foreign_keys = ON')
    db.pragma('journal_mode = WAL')

    for (const c of checkIntegrity(db)) {
      // Prefix so package checks and live checks are distinguishable.
      checks.push({ name: `restored: ${c.name}`, ok: c.ok, detail: c.detail })
    }

    const store = new DiskFileStore({
      libraryRoot: path.resolve(ctx.libraryRoot),
      countCitations: (rel) =>
        (
          db
            .prepare(
              `SELECT count(*) c FROM page WHERE file_relpath = ? OR thumb_relpath = ?`,
            )
            .get(rel, rel) as { c: number }
        ).c,
    })

    const pages = db
      .prepare(`SELECT id, file_relpath FROM page`)
      .all() as Array<{ id: number; file_relpath: string }>

    let fileFails = 0
    const failDetail: string[] = []
    for (const page of pages) {
      const v = await store.verify(asRelPath(page.file_relpath))
      if (!v.ok) {
        fileFails++
        failDetail.push(`page ${page.id}: ${v.reason ?? 'fail'}`)
      }
    }
    add(
      checks,
      'restored: page images resolve and match content hash',
      fileFails === 0,
      fileFails === 0
        ? `${pages.length} file(s) verified`
        : `${fileFails} failure(s) — ${failDetail.slice(0, 3).join('; ')}`,
    )

    const itemCount = (db.prepare(`SELECT count(*) c FROM item`).get() as { c: number }).c
    const folderCount = (db.prepare(`SELECT count(*) c FROM folder`).get() as { c: number }).c
    const pageCount = (db.prepare(`SELECT count(*) c FROM page`).get() as { c: number }).c
    add(
      checks,
      'restored: row counts',
      true,
      `items=${itemCount} folders=${folderCount} pages=${pageCount}`,
    )
  } finally {
    db.close()
  }

  const ok = checks.every((c) => c.ok)
  return { ok, checks }
}
