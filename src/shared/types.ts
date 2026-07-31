/**
 * KeepR shared domain types — Lane 0, owned by the orchestrator.
 *
 * Every lane compiles against this file. Do not edit it in a feature lane; if
 * you need a change here, raise it with the orchestrator, because a change here
 * ripples into every other lane simultaneously.
 *
 * The branded primitives below are deliberate friction. They exist so that the
 * mistakes this application cannot afford become type errors rather than
 * runtime surprises: money mixed with plain numbers, a civil date confused with
 * a timestamp, an unvalidated string used as a file path.
 */

/* ===========================================================================
 * Branded primitives
 * ======================================================================== */

declare const brand: unique symbol
type Brand<T, B> = T & { readonly [brand]: B }

/**
 * Money, in integer minor units of its currency. 84.37 USD is 8437.
 * There is no floating-point money in KeepR. A float total in an expense report
 * is a wrong number that looks right, and the user would file it.
 */
export type MinorUnits = Brand<number, 'MinorUnits'>

/** ISO-4217, uppercase. 'USD', 'CAD', 'EUR'. */
export type CurrencyCode = Brand<string, 'CurrencyCode'>

/**
 * A business date with no timezone: 'YYYY-MM-DD'. A receipt dated 2026-07-30 is
 * that date everywhere on earth, and must never shift because of a UTC offset.
 */
export type CivilDate = Brand<string, 'CivilDate'>

/** A moment in time: unix epoch milliseconds, UTC. */
export type InstantMs = Brand<number, 'InstantMs'>

/** Lowercase hex sha256. */
export type Sha256 = Brand<string, 'Sha256'>

/** A path relative to the library root. Absolute paths are never persisted. */
export type LibraryRelPath = Brand<string, 'LibraryRelPath'>

export const asMinor = (n: number): MinorUnits => {
  if (!Number.isInteger(n)) throw new RangeError(`money must be integer minor units, got ${n}`)
  return n as MinorUnits
}
export const asCurrency = (s: string): CurrencyCode => {
  if (!/^[A-Z]{3}$/.test(s)) throw new RangeError(`not an ISO-4217 code: ${s}`)
  return s as CurrencyCode
}
export const asCivilDate = (s: string): CivilDate => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new RangeError(`not a civil date: ${s}`)
  return s as CivilDate
}
export const asRelPath = (s: string): LibraryRelPath => {
  if (s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s) || s.includes('..')) {
    throw new RangeError(`path must be library-relative and contain no traversal: ${s}`)
  }
  return s as LibraryRelPath
}

/* ===========================================================================
 * Money helpers — the split algorithm lives here, once
 * ======================================================================== */

/**
 * Divide an amount into `n` parts that sum EXACTLY to the original.
 * Remainder minor units go to the earliest parts (largest-remainder).
 *   allocate(10000, 3) -> [3334, 3333, 3333]
 *
 * Lane I must use this rather than rounding each share independently, which is
 * how a three-way split of $100.00 silently becomes $99.99.
 */
export function allocate(total: MinorUnits, n: number): MinorUnits[] {
  if (n < 1 || !Number.isInteger(n)) throw new RangeError(`n must be a positive integer, got ${n}`)
  const sign = total < 0 ? -1 : 1
  const abs = Math.abs(total)
  const base = Math.floor(abs / n)
  const rem = abs - base * n
  return Array.from({ length: n }, (_, i) => asMinor(sign * (base + (i < rem ? 1 : 0))))
}

/**
 * Split into explicit weights (e.g. 60/40 between two projects), still summing
 * exactly to the total.
 */
export function allocateByWeight(total: MinorUnits, weights: number[]): MinorUnits[] {
  if (!weights.length) throw new RangeError('weights must not be empty')
  if (weights.some((w) => w < 0)) throw new RangeError('weights must be non-negative')
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum <= 0) throw new RangeError('weights must sum to more than zero')
  const raw = weights.map((w) => (Math.abs(total) * w) / sum)
  const floors = raw.map(Math.floor)
  let rem = Math.abs(total) - floors.reduce((a, b) => a + b, 0)
  // Hand the leftover minor units to the largest fractional parts first.
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)
  const out = [...floors]
  for (const { i } of order) {
    if (rem <= 0) break
    out[i] = (out[i] ?? 0) + 1
    rem -= 1
  }
  const sign = total < 0 ? -1 : 1
  return out.map((v) => asMinor(sign * v))
}

/* ===========================================================================
 * Enumerations — mirror the CHECK constraints in 001_initial.sql exactly
 * ======================================================================== */

export type ItemType = 'receipt' | 'document' | 'contact'
export type FolderKind = 'user' | 'inbox' | 'trash'
export type SplitRole = 'origin' | 'child'
export type Rotation = 0 | 90 | 180 | 270
export type OcrStatus = 'pending' | 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
export type JobKind = 'import' | 'ocr' | 'export' | 'backup' | 'restore' | 'archive'
/** 'partial' is real: a 10-page PDF where page 7 fails is neither done nor failed. */
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'partial'
export type RuleSource = 'seed' | 'user' | 'learned'
export type CustomFieldType = 'text' | 'number' | 'money' | 'date' | 'bool' | 'list'

/* ===========================================================================
 * Entities
 * ======================================================================== */

export interface Folder {
  id: number
  parentId: number | null
  kind: FolderKind
  name: string
  template: string | null
  /** §6 "find folders missing period-end dates" targets this. */
  periodEnd: CivilDate | null
  comments: string | null
  labels: string[]
  sortOrder: number
  createdAt: InstantMs
  modifiedAt: InstantMs
}

export interface Item {
  id: number
  folderId: number
  type: ItemType
  splitGroupId: number | null
  splitRole: SplitRole | null
  /** Set when this item was superseded by a split. Excluded from all sums. */
  supersededAt: InstantMs | null
  reviewedAt: InstantMs | null
  trashedAt: InstantMs | null
  createdAt: InstantMs
  modifiedAt: InstantMs
}

export interface ReceiptData {
  itemId: number
  txnDate: CivilDate | null
  vendorId: number | null
  totalMinor: MinorUnits | null
  currency: CurrencyCode
  paymentTypeId: number | null
  taxTotalMinor: MinorUnits | null
  categoryId: number | null
  taxCategoryId: number | null
  projectId: number | null
  /** Whatever reference the merchant printed. Surfaced in the UI as "Transaction ID". */
  externalRef: string | null
  description: string | null
  extraction: ExtractionRecord | null
}

export interface ReceiptTaxLine {
  id: number
  itemId: number
  label: string
  /** Basis points. 8.25% is 825. Integer, so no float tax rates. */
  rateBp: number | null
  amountMinor: MinorUnits
  taxCategoryId: number | null
}

export interface DocumentData {
  itemId: number
  title: string | null
  docDate: CivilDate | null
  docType: string | null
  notes: string | null
}

export interface ContactData {
  itemId: number
  firstName: string | null
  lastName: string | null
  org: string | null
  title: string | null
  emails: string[]
  phones: string[]
  addresses: string[]
  url: string | null
  notes: string | null
}

export interface Page {
  id: number
  itemId: number
  seq: number
  fileRelPath: LibraryRelPath
  thumbRelPath: LibraryRelPath | null
  contentHash: Sha256 | null
  width: number | null
  height: number | null
  /** Metadata-only. Never also baked into the file — see the geometry invariant. */
  rotation: Rotation
  ocrStatus: OcrStatus
  ocrText: string | null
  /** Mean word confidence, 0..1. Not money; a plain float is correct here. */
  ocrConf: number | null
  ocrEngine: string | null
  ocrWords: Word[] | null
  /** Bumped whenever the master image changes. Stale results are discarded. */
  ocrGeneration: number
  createdAt: InstantMs
}

/** A page image resolved through v_item_pages, which follows split citations. */
export interface ResolvedPage {
  itemId: number
  pageId: number
  seq: number
  fileRelPath: LibraryRelPath
  thumbRelPath: LibraryRelPath | null
  rotation: Rotation
  contentHash: Sha256 | null
  /** True when this item is a split child citing its origin's image. */
  viaSplit: boolean
}

export interface SplitGroup {
  id: number
  originItemId: number
  originPageId: number | null
  originTotalMinor: MinorUnits
  originTaxMinor: MinorUnits | null
  currency: CurrencyCode
  createdAt: InstantMs
}

/* ===========================================================================
 * OCR
 * ======================================================================== */

/**
 * Bounding box in STORED-MASTER pixel space: the pixels of the file as it sits
 * on disk, before display rotation is applied. Every consumer — the searchable
 * PDF text layer, region-to-field assignment, confidence markers — must use the
 * same space, or they drift out of alignment while still looking plausible.
 */
export interface BBox {
  x: number
  y: number
  w: number
  h: number
}

export interface Word {
  text: string
  bbox: BBox
  /** 0..1 */
  confidence: number
}

export interface OcrResult {
  text: string
  words: Word[]
  /** 0..1 mean confidence across words. */
  confidence: number
  engine: string
  /** Echoed back so main can discard results for a page that has since changed. */
  generation: number
  msElapsed: number
}

export interface OcrOptions {
  languages?: string[]
  signal?: AbortSignal
}

/** Reference to an image to OCR. Paths by default — not multi-MB buffers. */
export type PageImageRef =
  | { kind: 'file'; absPath: string; generation: number }
  | { kind: 'pdfPage'; absPath: string; pageIndex: number; generation: number }

/**
 * The swappable seam. Phase 1 ships a tesseract.js provider; Phase 4 can add a
 * local vision-model provider without anything above this interface changing.
 * Nothing outside src/ocr may assume Tesseract.
 */
export interface OcrProvider {
  readonly id: string
  ocrPage(input: PageImageRef, opts?: OcrOptions): Promise<OcrResult>
  dispose(): Promise<void>
}

/* ===========================================================================
 * Field provenance
 * ======================================================================== */

/**
 * Per-field extraction record. `pinned` means the user corrected this field, so
 * a later re-OCR must not overwrite it — otherwise a slow OCR pass silently
 * undoes the user's correction, which is the kind of bug that destroys trust in
 * the whole application.
 */
export interface FieldProvenance<T = unknown> {
  value: T
  confidence: number
  bbox: BBox | null
  pageId: number | null
  pinned: boolean
}

export type ExtractableField =
  | 'txnDate' | 'vendor' | 'total' | 'paymentType'
  | 'taxTotal' | 'category' | 'taxCategory' | 'externalRef' | 'description'

export type ExtractionRecord = Partial<Record<ExtractableField, FieldProvenance>>

/**
 * Below this confidence, a field is surfaced as uncertain — an amber percentage
 * badge in the viewer, and a row marker in the grid.
 *
 * ONE definition, because two disagreeing thresholds is worse than either value.
 * The repository and the viewer originally picked 0.75 and 0.85 independently, so
 * a field at 0.80 was flagged in the details form and silent in the grid. When a
 * marker appears inconsistently the user stops trusting all of them.
 *
 * 0.85 rather than 0.75 because the approved mockup shows a 78% field flagged,
 * and the mockup is the contract.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.85

/* ===========================================================================
 * Jobs
 * ======================================================================== */

export interface Job {
  id: string
  kind: JobKind
  status: JobStatus
  totalUnits: number
  doneUnits: number
  failedUnits: number
  detail: unknown
  error: string | null
  createdAt: InstantMs
  updatedAt: InstantMs
}

export interface JobProgressEvent {
  jobId: string
  status: JobStatus
  totalUnits: number
  doneUnits: number
  failedUnits: number
  message?: string
}

/* ===========================================================================
 * Ports implemented in main (Lane 0), consumed by feature lanes
 * ======================================================================== */

/**
 * All image bytes go through here. Feature lanes never join paths themselves —
 * that is how absolute paths leak into the database and break portability.
 */
export interface FileStore {
  readonly libraryRoot: string
  resolve(rel: LibraryRelPath): string
  /** Ingests bytes, returns the relative path and content hash it stored. */
  put(bytes: Buffer, ext: string): Promise<{ rel: LibraryRelPath; hash: Sha256 }>
  read(rel: LibraryRelPath): Promise<Buffer>
  exists(rel: LibraryRelPath): Promise<boolean>
  /** Reference-counted: only unlinks when no page row still cites it. */
  release(rel: LibraryRelPath): Promise<void>
}

export interface JobQueue {
  create(kind: JobKind, totalUnits: number, detail?: unknown): Promise<Job>
  update(id: string, patch: Partial<Pick<Job, 'status' | 'doneUnits' | 'failedUnits' | 'error' | 'detail'>>): Promise<Job>
  get(id: string): Promise<Job | null>
  cancel(id: string): Promise<void>
  onProgress(fn: (e: JobProgressEvent) => void): () => void
}

/* ===========================================================================
 * Search
 * ======================================================================== */

export interface SearchQuery {
  /** Free text across OCR body and structured fields. */
  q?: string
  folderId?: number
  includeSubfolders?: boolean
  type?: ItemType
  vendorId?: number
  categoryId?: number
  taxCategoryId?: number
  projectId?: number
  dateFrom?: CivilDate
  dateTo?: CivilDate
  amountMinMinor?: MinorUnits
  amountMaxMinor?: MinorUnits
  /** §6 "Find Missing Key Data". */
  missing?: ExtractableField[]
  reviewed?: boolean
  includeTrashed?: boolean
  limit?: number
  offset?: number
}

export interface SearchHit {
  itemId: number
  type: ItemType
  folderId: number
  score: number
  /** Which index produced the hit. Both may be set for one item. */
  matchedIn: { ocrText: boolean; fields: boolean }
  snippet: string | null
}

export interface SearchResult {
  hits: SearchHit[]
  total: number
  /** True when the result set was capped by `limit`, so callers never present a
   *  truncated list as if it were complete. */
  truncated: boolean
}
