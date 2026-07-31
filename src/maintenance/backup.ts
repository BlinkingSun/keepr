/**
 * Library backup — checkpoint WAL, copy db + images, write manifest, log.
 *
 * Non-negotiable: wal_checkpoint(TRUNCATE) BEFORE the copy. A live-WAL copy can
 * capture a database file whose newest commits are still only in the -wal file
 * — a backup that looks fine and silently is not.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { BackupResult } from '../shared/ipc.ts'
import type { Sha256 } from '../shared/types.ts'
import {
  copyDirSync,
  fileSizeSync,
  sha256FileSync,
  walkRelSync,
} from './fsutil.ts'
import {
  DB_BACKUP_NAME,
  IMAGES_DIR,
  MANIFEST_NAME,
  type BackupManifest,
  type MaintenanceContext,
} from './types.ts'

function defaultBackupDir(libraryRoot: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  return path.join(libraryRoot, 'backups', `backup-${stamp}`)
}

/**
 * Checkpoint, copy the library into `destPath` (or a stamped folder under
 * libraryRoot/backups/), write manifest.json, insert backup_log.
 */
export function backup(ctx: MaintenanceContext, destPath?: string): BackupResult {
  const dest = destPath ?? defaultBackupDir(ctx.libraryRoot)
  mkdirSync(dest, { recursive: true })

  // 1. Checkpoint WAL so the main db file contains every committed row.
  ctx.db.pragma('wal_checkpoint(TRUNCATE)')

  // 2. Copy the database file (not the -wal / -shm sidecars — they should be
  // empty/truncated after the checkpoint, and the restored library opens clean).
  const destDb = path.join(dest, DB_BACKUP_NAME)
  if (!existsSync(ctx.dbPath)) {
    throw new Error(`KeepR backup: database file missing at ${ctx.dbPath}`)
  }
  copyFileSync(ctx.dbPath, destDb)
  const dbSha256 = sha256FileSync(destDb)

  // 3. Copy the images tree.
  const srcImages = path.join(ctx.libraryRoot, IMAGES_DIR)
  const destImages = path.join(dest, IMAGES_DIR)
  copyDirSync(srcImages, destImages)

  // 4. Build manifest with every included file's hash.
  const files: BackupManifest['files'] = []
  let totalBytes = 0

  const dbBytes = fileSizeSync(destDb)
  totalBytes += dbBytes
  files.push({ rel: DB_BACKUP_NAME, sha256: dbSha256, bytes: dbBytes })

  for (const rel of walkRelSync(destImages)) {
    const abs = path.join(destImages, rel)
    const bytes = fileSizeSync(abs)
    totalBytes += bytes
    files.push({
      rel: `${IMAGES_DIR}/${rel}`.replace(/\\/g, '/'),
      sha256: sha256FileSync(abs),
      bytes,
    })
  }

  const counts = {
    items: (ctx.db.prepare(`SELECT count(*) c FROM item`).get() as { c: number }).c,
    folders: (ctx.db.prepare(`SELECT count(*) c FROM folder`).get() as { c: number }).c,
    pages: (ctx.db.prepare(`SELECT count(*) c FROM page`).get() as { c: number }).c,
  }

  const manifest: BackupManifest = {
    version: 1,
    format: 'keepr-backup-v1',
    createdAt: Date.now(),
    dbFile: DB_BACKUP_NAME,
    dbSha256,
    fileCount: files.length,
    bytes: totalBytes,
    counts,
    files,
  }

  writeFileSync(path.join(dest, MANIFEST_NAME), JSON.stringify(manifest, null, 2), 'utf8')

  // 5. Log to backup_log so restore can report exactly what was produced.
  ctx.db
    .prepare(
      `INSERT INTO backup_log(kind, path, db_sha256, manifest_json, size_bytes, created_at)
       VALUES ('manual', ?, ?, ?, ?, ?)`,
    )
    .run(dest, dbSha256, JSON.stringify(manifest), totalBytes, Date.now())

  return {
    path: dest,
    dbSha256: dbSha256 as Sha256,
    fileCount: files.length,
    bytes: totalBytes,
  }
}
