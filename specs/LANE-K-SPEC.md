# Lane K — Backup, restore, archive, trash

**Executor:** grok · **Wave:** 4 · **Depends on:** Lane 0, A

## You own
```
src/maintenance/**
```
**Read** `src/main/db.ts` (`checkIntegrity`, the migration runner's backup step),
`src/store/fileStore.ts` (`verify`, `releaseWithResult`), the STATE-TRANSITION
GUARDS section of `src/db/schema/001_initial.sql`.

**Do NOT touch** anything outside `src/maintenance/**`. No new dependencies —
use `node:zlib` and `node:fs` for archives, not an npm tar library.

## Non-negotiable
1. **Checkpoint the WAL before copying the database.** `wal_checkpoint(TRUNCATE)`
   first. Copying a live WAL database can capture a file missing its newest
   commits — a backup that looks fine and silently isn't.
2. **Verify by graph integrity, not by bytes.** "Byte-identical" was explicitly
   rejected as a criterion: identical bytes are neither necessary nor sufficient
   for a correct library. Run `checkIntegrity` plus assert every `page.file_relpath`
   resolves and its `content_hash` still matches (`FileStore.verify`).
3. **Empty-trash has a MANDATORY ORDER: split children before their origin.**
   Origin-first is refused by trigger with a readable message. Implement the
   correct order; do not work around the trigger.
4. **Release files by reference count.** Use `FileStore.releaseWithResult`. Images
   are content-addressed and shared, so unlinking on first release would blank the
   image for a split receipt's remaining siblings.
5. Backups record a manifest so a restore can report exactly what it restored.

## Deliverables
- `backup(ctx, destPath?)` → `{ path, dbSha256, fileCount, bytes }`. Checkpoint,
  copy the db, copy the images tree, write a manifest, log to `backup_log`.
- `restore(ctx, srcPath)` → `RestoreVerification` with a named check list.
- `archive(ctx, cutoffCivilDate, destPath?)` — move items older than the cutoff into
  a compressed archive and remove them from the active library, logging to
  `archive_log`. Never archive a split child without its whole group.
- `emptyTrash(ctx)` → `{ itemsPurged, filesReleased }`, in the required order.
- `restoreItem(ctx, itemId)` — clear `trashed_at`.

## Tests — `src/maintenance/__tests__/`
1. Backup then restore into a fresh root: all items, folders and pages present, and
   `checkIntegrity` reports every check ok.
2. Restore verification FAILS loudly when an image file is deleted from the backup.
3. Restore verification FAILS when an image is corrupted but still present — this
   is why the check is a hash and not an existence test.
4. Backup after a WAL write captures the newest row — write, backup without an
   explicit checkpoint of your own, restore, and assert the row is there.
5. Empty-trash purges a split group in the correct order and succeeds.
6. Empty-trash attempted origin-first surfaces the trigger's message rather than an
   opaque error.
7. A page image shared by 3 split children is NOT unlinked while any child remains.
8. Archive moves an old item out and leaves a newer one; the archive can be listed.
9. Archiving a split origin takes its children with it, never half a group.
10. Trash then restore round-trips with fields intact.

## Report
`DONE | OPEN | BLOCKED` / FILES / TESTS / DECISIONS / BLOCKERS.
