/**
 * Lane K — maintenance context and shared shapes.
 *
 * The live AppContext is wider than we need. We accept a structural subset so
 * tests can assemble a thin fixture without pulling the whole main process.
 */
import type Database from 'better-sqlite3'
import type { DiskFileStore } from '../store/fileStore.ts'

export interface MaintenanceContext {
  db: Database.Database
  dbPath: string
  libraryRoot: string
  fileStore: DiskFileStore
  /** Optional; restore closes the live connection when applying into libraryRoot. */
  close?: () => void
}

export interface BackupManifest {
  version: 1
  format: 'keepr-backup-v1'
  createdAt: number
  dbFile: 'library.sqlite'
  dbSha256: string
  fileCount: number
  bytes: number
  counts: {
    items: number
    folders: number
    pages: number
  }
  /** Relative paths of every file included (db + images). */
  files: Array<{ rel: string; sha256: string; bytes: number }>
}

export const MANIFEST_NAME = 'manifest.json'
export const DB_BACKUP_NAME = 'library.sqlite'
export const IMAGES_DIR = 'images'
