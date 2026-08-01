/**
 * Lane K tests — backup, restore, archive, empty-trash.
 * Run: node --experimental-strip-types --test src/maintenance/__tests__/*.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkIntegrity } from '../../main/db.ts'
import {
  backup,
  restore,
  verifyBackupPackage,
  archive,
  listArchive,
  emptyTrash,
  restoreItem,
  hardDeleteItem,
} from '../index.ts'
import {
  dispose,
  openLibraryRoot,
  seedUserFolder,
  seedVendor,
  putImage,
  insertReceipt,
  seedSplitGroup,
  createContext,
  SCHEMA_DIR,
} from './harness.ts'

describe('Lane K — backup / restore / archive / trash', () => {
  // -----------------------------------------------------------------------
  // 1. Backup then restore into a fresh root
  // -----------------------------------------------------------------------
  it('1. backup then restore into a fresh root: items/folders/pages + integrity ok', async () => {
    const { root, ctx } = await openLibraryRoot()
    try {
      const folderId = seedUserFolder(ctx)
      const vendorId = seedVendor(ctx)
      const { rel, hash } = await putImage(ctx, Buffer.from('receipt-image-one'), 'jpg')
      const { itemId } = insertReceipt(ctx, {
        folderId,
        totalMinor: 4200,
        txnDate: '2026-06-01',
        vendorId,
        fileRel: rel,
        contentHash: hash,
      })

      const bakDir = path.join(root, 'backups', 'roundtrip')
      const result = backup(ctx, bakDir)
      assert.ok(result.path)
      assert.ok(result.dbSha256.length === 64)
      assert.ok(result.fileCount >= 2) // db + at least one image
      assert.ok(result.bytes > 0)
      assert.ok(existsSync(path.join(bakDir, 'manifest.json')))
      assert.ok(existsSync(path.join(bakDir, 'library.sqlite')))

      // Log row written
      const log = ctx.db.prepare(`SELECT path, db_sha256 FROM backup_log ORDER BY id DESC LIMIT 1`).get() as {
        path: string
        db_sha256: string
      }
      assert.equal(log.db_sha256, result.dbSha256)

      ctx.close()

      // Fresh root
      const freshRoot = await mkdtemp(path.join(tmpdir(), 'keepr-restore-'))
      try {
        const fresh = createContext({
          libraryRoot: freshRoot,
          schemaDir: SCHEMA_DIR,
          skipBackup: true,
      skipSeed: true,
    })
        const ver = await restore(fresh, bakDir)
        assert.equal(ver.ok, true, ver.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('; '))
        assert.ok(ver.checks.every((c) => c.ok))
        // ctx.db closed by restore — reopen
        const reopened = createContext({
          libraryRoot: freshRoot,
          schemaDir: SCHEMA_DIR,
          skipBackup: true,
      skipSeed: true,
    })
        try {
          const items = reopened.db.prepare(`SELECT count(*) c FROM item`).get() as { c: number }
          const folders = reopened.db.prepare(`SELECT count(*) c FROM folder`).get() as { c: number }
          const pages = reopened.db.prepare(`SELECT count(*) c FROM page`).get() as { c: number }
          assert.ok(items.c >= 1, `expected items, got ${items.c}`)
          assert.ok(folders.c >= 3, `expected system+user folders, got ${folders.c}`)
          assert.ok(pages.c >= 1, `expected pages, got ${pages.c}`)

          const row = reopened.db
            .prepare(`SELECT total_minor FROM receipt_data WHERE item_id = ?`)
            .get(itemId) as { total_minor: number } | undefined
          assert.equal(row?.total_minor, 4200)

          const integrity = checkIntegrity(reopened.db)
          assert.ok(
            integrity.every((c) => c.ok),
            integrity.filter((c) => !c.ok).map((c) => c.name).join(', '),
          )
        } finally {
          reopened.close()
        }
      } finally {
        await rm(freshRoot, { recursive: true, force: true })
      }
    } finally {
      await dispose(ctx, root)
    }
  })

  // -----------------------------------------------------------------------
  // 2. Missing image fails verification
  // -----------------------------------------------------------------------
  it('2. restore verification FAILS when an image is deleted from the backup', async () => {
    const { root, ctx } = await openLibraryRoot()
    try {
      const folderId = seedUserFolder(ctx)
      const { rel, hash } = await putImage(ctx, Buffer.from('will-be-deleted'), 'jpg')
      insertReceipt(ctx, {
        folderId,
        totalMinor: 1000,
        txnDate: '2026-05-01',
        fileRel: rel,
        contentHash: hash,
      })
      const bakDir = path.join(root, 'backups', 'missing-img')
      backup(ctx, bakDir)

      // Delete the image from the backup package
      const imgInBackup = path.join(bakDir, rel)
      assert.ok(existsSync(imgInBackup))
      unlinkSync(imgInBackup)

      const checks = await verifyBackupPackage(bakDir)
      const fileCheck = checks.find((c) => c.name.includes('page images') || c.name.includes('manifest file'))
      assert.ok(fileCheck, 'expected a page/manifest file check')
      assert.equal(
        checks.some((c) => !c.ok),
        true,
        'verification must fail when an image is missing',
      )

      // Full restore must also refuse (ok: false)
      ctx.close()
      const freshRoot = await mkdtemp(path.join(tmpdir(), 'keepr-restore-miss-'))
      try {
        const fresh = createContext({
          libraryRoot: freshRoot,
          schemaDir: SCHEMA_DIR,
          skipBackup: true,
      skipSeed: true,
    })
        const ver = await restore(fresh, bakDir)
        assert.equal(ver.ok, false, 'restore must fail loudly when backup image is missing')
        assert.ok(ver.checks.some((c) => !c.ok && (c.detail.includes('missing') || c.name.includes('page') || c.name.includes('manifest'))))
      } finally {
        await rm(freshRoot, { recursive: true, force: true })
      }
    } finally {
      try {
        ctx.close()
      } catch {
        /* may already be closed */
      }
      await rm(root, { recursive: true, force: true })
    }
  })

  // -----------------------------------------------------------------------
  // 3. Corrupted image fails (hash, not existence)
  // -----------------------------------------------------------------------
  it('3. restore verification FAILS when an image is corrupted but still present', async () => {
    const { root, ctx } = await openLibraryRoot()
    try {
      const folderId = seedUserFolder(ctx)
      const { rel, hash } = await putImage(ctx, Buffer.from('original-bytes-for-hash'), 'jpg')
      insertReceipt(ctx, {
        folderId,
        totalMinor: 2000,
        txnDate: '2026-05-02',
        fileRel: rel,
        contentHash: hash,
      })
      const bakDir = path.join(root, 'backups', 'corrupt-img')
      backup(ctx, bakDir)

      const imgInBackup = path.join(bakDir, rel)
      assert.ok(existsSync(imgInBackup), 'image must exist before corruption')
      writeFileSync(imgInBackup, 'tampered-content-not-matching-hash')

      const checks = await verifyBackupPackage(bakDir)
      assert.equal(
        checks.some((c) => !c.ok),
        true,
        'verification must fail on hash mismatch even though file exists',
      )
      const detail = checks
        .filter((c) => !c.ok)
        .map((c) => `${c.name}: ${c.detail}`)
        .join(' | ')
      assert.match(detail, /hash|mismatch|corrupt/i, detail)
    } finally {
      await dispose(ctx, root)
    }
  })

  // -----------------------------------------------------------------------
  // 4. WAL write captured by backup's internal checkpoint
  // -----------------------------------------------------------------------
  it('4. backup after a WAL write captures the newest row (internal checkpoint)', async () => {
    const { root, ctx } = await openLibraryRoot()
    try {
      const folderId = seedUserFolder(ctx)
      // Ensure WAL mode (openLibrary already sets it)
      const mode = ctx.db.pragma('journal_mode', { simple: true }) as string
      assert.equal(String(mode).toLowerCase(), 'wal')

      // Write a row — leave it in WAL (do NOT checkpoint ourselves)
      const now = Date.now()
      const newestId = Number(
        ctx.db
          .prepare(
            `INSERT INTO item(folder_id, type, created_at, modified_at) VALUES (?, 'document', ?, ?)`,
          )
          .run(folderId, now, now).lastInsertRowid,
      )
      ctx.db
        .prepare(`INSERT INTO document_data(item_id, title, notes) VALUES (?, ?, ?)`)
        .run(newestId, 'WAL-newest-row', 'must-survive-backup')

      // Confirm it is queryable through this connection
      const live = ctx.db
        .prepare(`SELECT title FROM document_data WHERE item_id = ?`)
        .get(newestId) as { title: string }
      assert.equal(live.title, 'WAL-newest-row')

      const bakDir = path.join(root, 'backups', 'wal-capture')
      // backup() must checkpoint internally — we deliberately do not
      backup(ctx, bakDir)
      ctx.close()

      const freshRoot = await mkdtemp(path.join(tmpdir(), 'keepr-wal-'))
      try {
        const fresh = createContext({
          libraryRoot: freshRoot,
          schemaDir: SCHEMA_DIR,
          skipBackup: true,
      skipSeed: true,
    })
        const ver = await restore(fresh, bakDir)
        assert.equal(ver.ok, true, ver.checks.filter((c) => !c.ok).map((c) => c.detail).join('; '))

        const reopened = createContext({
          libraryRoot: freshRoot,
          schemaDir: SCHEMA_DIR,
          skipBackup: true,
      skipSeed: true,
    })
        try {
          const row = reopened.db
            .prepare(`SELECT title FROM document_data WHERE item_id = ?`)
            .get(newestId) as { title: string } | undefined
          assert.equal(row?.title, 'WAL-newest-row', 'newest WAL commit must be in the backup')
        } finally {
          reopened.close()
        }
      } finally {
        await rm(freshRoot, { recursive: true, force: true })
      }
    } finally {
      try {
        ctx.close()
      } catch {
        /* */
      }
      await rm(root, { recursive: true, force: true })
    }
  })

  // -----------------------------------------------------------------------
  // 5. Empty-trash purges split group in correct order
  // -----------------------------------------------------------------------
  it('5. empty-trash purges a split group in the correct order and succeeds', async () => {
    const { root, ctx } = await openLibraryRoot()
    try {
      const folderId = seedUserFolder(ctx)
      const { originId, childIds } = await seedSplitGroup(ctx, folderId)
      const now = Date.now()
      // Soft-trash the whole group
      for (const id of [originId, ...childIds]) {
        ctx.db.prepare(`UPDATE item SET trashed_at = ? WHERE id = ?`).run(now, id)
      }

      const result = await emptyTrash(ctx)
      assert.equal(result.itemsPurged, 4) // origin + 3 children
      const remaining = ctx.db
        .prepare(`SELECT count(*) c FROM item WHERE id IN (?,?,?,?)`)
        .get(originId, childIds[0], childIds[1], childIds[2]) as { c: number }
      assert.equal(remaining.c, 0)
    } finally {
      await dispose(ctx, root)
    }
  })

  // -----------------------------------------------------------------------
  // 6. Origin-first surfaces trigger message
  // -----------------------------------------------------------------------
  it('6. empty-trash attempted origin-first surfaces the trigger message', async () => {
    const { root, ctx } = await openLibraryRoot()
    try {
      const folderId = seedUserFolder(ctx)
      const { originId, childIds } = await seedSplitGroup(ctx, folderId)
      const now = Date.now()
      for (const id of [originId, ...childIds]) {
        ctx.db.prepare(`UPDATE item SET trashed_at = ? WHERE id = ?`).run(now, id)
      }

      // Intentionally origin-first — must surface the readable trigger message
      let msg = ''
      try {
        hardDeleteItem(ctx, originId)
        assert.fail('origin-first delete must be refused')
      } catch (e) {
        msg = e instanceof Error ? e.message : String(e)
      }
      assert.match(msg, /split children first|unit of deletion/i, msg)
      assert.match(msg, /KeepR:/, msg)
    } finally {
      await dispose(ctx, root)
    }
  })

  // -----------------------------------------------------------------------
  // 7. Shared image not unlinked while any child remains
  // -----------------------------------------------------------------------
  it('7. page image shared by 3 split children is NOT unlinked while any child remains', async () => {
    const { root, ctx } = await openLibraryRoot()
    try {
      const folderId = seedUserFolder(ctx)
      const { originId, childIds, fileRel } = await seedSplitGroup(ctx, folderId)
      assert.ok(existsSync(path.join(root, fileRel)))

      const now = Date.now()
      // Trash and purge only the first child
      ctx.db.prepare(`UPDATE item SET trashed_at = ? WHERE id = ?`).run(now, childIds[0])
      const r1 = await emptyTrash(ctx)
      assert.equal(r1.itemsPurged, 1)
      assert.equal(r1.filesReleased, 0, 'must not release shared origin image')
      assert.ok(existsSync(path.join(root, fileRel)), 'image must still exist after purging one child')

      // Purge second child
      ctx.db.prepare(`UPDATE item SET trashed_at = ? WHERE id = ?`).run(now, childIds[1])
      await emptyTrash(ctx)
      assert.ok(existsSync(path.join(root, fileRel)), 'image must still exist after purging two children')

      // Purge third child + origin — now image may go
      ctx.db
        .prepare(`UPDATE item SET trashed_at = ? WHERE id IN (?, ?)`)
        .run(now, childIds[2], originId)
      const rFinal = await emptyTrash(ctx)
      assert.equal(rFinal.itemsPurged, 2)
      assert.ok(rFinal.filesReleased >= 1, 'image should unlink after origin pages are gone')
      assert.equal(existsSync(path.join(root, fileRel)), false, 'image unlinked when no citations remain')
    } finally {
      await dispose(ctx, root)
    }
  })

  // -----------------------------------------------------------------------
  // 8. Archive old item, leave newer; archive listable
  // -----------------------------------------------------------------------
  it('8. archive moves an old item out and leaves a newer one; archive can be listed', async () => {
    const { root, ctx } = await openLibraryRoot()
    try {
      const folderId = seedUserFolder(ctx)
      const { rel: relOld, hash: hashOld } = await putImage(ctx, Buffer.from('old-receipt'), 'jpg')
      const { itemId: oldId } = insertReceipt(ctx, {
        folderId,
        totalMinor: 1500,
        txnDate: '2020-01-15',
        fileRel: relOld,
        contentHash: hashOld,
      })
      const { rel: relNew, hash: hashNew } = await putImage(ctx, Buffer.from('new-receipt'), 'jpg')
      const { itemId: newId } = insertReceipt(ctx, {
        folderId,
        totalMinor: 2500,
        txnDate: '2026-07-01',
        fileRel: relNew,
        contentHash: hashNew,
      })

      const dest = path.join(root, 'archives', 'cutoff-2024.tar.gz')
      const result = await archive(ctx, '2024-01-01', dest)
      assert.equal(result.itemsMoved, 1)
      assert.ok(existsSync(result.path))

      const still = ctx.db.prepare(`SELECT id FROM item WHERE id IN (?, ?)`).all(oldId, newId) as Array<{
        id: number
      }>
      assert.deepEqual(
        still.map((r) => r.id).sort(),
        [newId],
        'only the newer item remains',
      )

      const listed = await listArchive(result.path)
      assert.equal(listed.length, 1)
      assert.equal(listed[0]!.itemId, oldId)
      assert.equal(listed[0]!.txnDate, '2020-01-15')

      const log = ctx.db.prepare(`SELECT items_moved, cutoff_date FROM archive_log ORDER BY id DESC LIMIT 1`).get() as {
        items_moved: number
        cutoff_date: string
      }
      assert.equal(log.items_moved, 1)
      assert.equal(log.cutoff_date, '2024-01-01')
    } finally {
      await dispose(ctx, root)
    }
  })

  // -----------------------------------------------------------------------
  // 9. Archiving split origin takes children
  // -----------------------------------------------------------------------
  it('9. archiving a split origin takes its children with it, never half a group', async () => {
    const { root, ctx } = await openLibraryRoot()
    try {
      const folderId = seedUserFolder(ctx)
      // Origin dated old; if selection only looked at origin date it might miss children
      // but expandSplitGroups must pull the whole group.
      const { originId, childIds, splitGroupId } = await seedSplitGroup(ctx, folderId)
      // Force origin txn_date old (children share same date in seed — still whole group)
      ctx.db
        .prepare(`UPDATE receipt_data SET txn_date = '2019-03-01' WHERE item_id = ?`)
        .run(originId)
      // Make children appear NEW so a naive per-row filter would skip them
      for (const c of childIds) {
        ctx.db.prepare(`UPDATE receipt_data SET txn_date = '2026-07-20' WHERE item_id = ?`).run(c)
      }

      const dest = path.join(root, 'archives', 'split-group.tar.gz')
      // Cutoff after origin date but before children dates — only origin is a
      // "candidate", but expansion must pull children too.
      const result = await archive(ctx, '2020-01-01', dest)
      assert.equal(result.itemsMoved, 4, 'origin + 3 children')

      const remaining = ctx.db
        .prepare(`SELECT count(*) c FROM item WHERE split_group_id = ?`)
        .get(splitGroupId) as { c: number }
      assert.equal(remaining.c, 0, 'no half-group left in the library')

      const listed = await listArchive(result.path)
      const ids = new Set(listed.map((e) => e.itemId))
      assert.ok(ids.has(originId))
      for (const c of childIds) assert.ok(ids.has(c), `child ${c} must be in archive`)
    } finally {
      await dispose(ctx, root)
    }
  })

  // -----------------------------------------------------------------------
  // 10. Trash then restoreItem round-trip
  // -----------------------------------------------------------------------
  it('10. trash then restoreItem round-trips with fields intact', async () => {
    const { root, ctx } = await openLibraryRoot()
    try {
      const folderId = seedUserFolder(ctx)
      const vendorId = seedVendor(ctx, 'Ace Hardware')
      const { rel, hash } = await putImage(ctx, Buffer.from('roundtrip-img'), 'png')
      const { itemId } = insertReceipt(ctx, {
        folderId,
        totalMinor: 9999,
        taxMinor: 800,
        txnDate: '2026-04-15',
        vendorId,
        fileRel: rel,
        contentHash: hash,
      })
      ctx.db
        .prepare(`UPDATE receipt_data SET description = ? WHERE item_id = ?`)
        .run('garden supplies', itemId)

      const before = ctx.db
        .prepare(
          `SELECT i.folder_id, i.type, r.total_minor, r.txn_date, r.description, r.vendor_id, r.currency
             FROM item i JOIN receipt_data r ON r.item_id = i.id WHERE i.id = ?`,
        )
        .get(itemId) as Record<string, unknown>

      // Soft-trash
      const now = Date.now()
      ctx.db.prepare(`UPDATE item SET trashed_at = ?, modified_at = ? WHERE id = ?`).run(now, now, itemId)
      const trashed = ctx.db.prepare(`SELECT trashed_at FROM item WHERE id = ?`).get(itemId) as {
        trashed_at: number | null
      }
      assert.ok(trashed.trashed_at != null)

      // restoreItem clears trashed_at
      const r = restoreItem(ctx, itemId)
      assert.equal(r.ok, true)
      const afterTrash = ctx.db.prepare(`SELECT trashed_at FROM item WHERE id = ?`).get(itemId) as {
        trashed_at: number | null
      }
      assert.equal(afterTrash.trashed_at, null)

      const after = ctx.db
        .prepare(
          `SELECT i.folder_id, i.type, r.total_minor, r.txn_date, r.description, r.vendor_id, r.currency
             FROM item i JOIN receipt_data r ON r.item_id = i.id WHERE i.id = ?`,
        )
        .get(itemId) as Record<string, unknown>

      assert.deepEqual(after, before)
      assert.equal(after.total_minor, 9999)
      assert.equal(after.description, 'garden supplies')
      assert.equal(after.txn_date, '2026-04-15')
    } finally {
      await dispose(ctx, root)
    }
  })
})
