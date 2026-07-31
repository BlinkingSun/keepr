/**
 * Export-lane local types. ExportRequest lives in shared/ipc (Lane 0).
 */
import type { ExportRequest } from '../shared/ipc.ts'
import type { FileStore, JobQueue } from '../shared/types.ts'
import type Database from 'better-sqlite3'

export type { ExportRequest }
export type KeeprDatabase = Database.Database

/** Optional runtime deps. Progress is best-effort when jobQueue is omitted. */
export interface ExportContext {
  jobQueue?: JobQueue
  fileStore?: FileStore
  /**
   * Absolute library root used when fileStore is absent but page files still
   * need resolving (tests may write images under a temp root).
   */
  libraryRoot?: string
}

export type ExportColumn =
  | 'item_id'
  | 'txn_date'
  | 'vendor'
  | 'category'
  | 'tax_category'
  | 'description'
  | 'total'
  | 'currency'
  | 'tax'
  | 'payment_type'
  | 'project'
  | 'external_ref'
  | 'folder_id'

export const DEFAULT_COLUMNS: ExportColumn[] = [
  'txn_date',
  'vendor',
  'category',
  'description',
  'total',
  'currency',
  'tax',
  'payment_type',
  'project',
  'external_ref',
  'item_id',
]

/** One export row; money fields are still integer minor units. */
export interface ExportReceiptRow {
  itemId: number
  folderId: number
  txnDate: string | null
  vendorName: string | null
  categoryName: string | null
  taxCategoryName: string | null
  description: string | null
  totalMinor: number | null
  currency: string
  taxTotalMinor: number | null
  paymentTypeName: string | null
  projectName: string | null
  externalRef: string | null
}

export interface CabinetProfile {
  name?: string
  business?: string
  address?: string
  taxId?: string
  taxIds?: string[]
  [key: string]: unknown
}
