/**
 * Lane K — Backup, restore, archive, trash.
 *
 * Public surface for main/IPC and headless tests.
 */
export { backup } from './backup.ts'
export { restore, verifyBackupPackage } from './restore.ts'
export { archive, listArchive, listArchiveNames } from './archive.ts'
export { emptyTrash, restoreItem, hardDeleteItem } from './trash.ts'
export type { MaintenanceContext, BackupManifest } from './types.ts'
export type { EmptyTrashResult } from './trash.ts'
export type { ArchiveResult, ArchiveListEntry } from './archive.ts'
