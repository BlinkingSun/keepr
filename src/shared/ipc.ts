/**
 * KeepR IPC contract — Lane 0, owned by the orchestrator.
 *
 * This is the single definition of what the renderer may ask main to do. It is a
 * contract, not a suggestion: the preload bridge, the main-side handler map, and
 * the renderer client are all derived from `IpcMap`, so a channel that is not
 * declared here cannot be called, and a handler whose types drift from the
 * declaration fails to compile.
 *
 * Why it matters: the audit's finding was that with IPC unowned, six parallel
 * lanes would each invent their own channels and payload shapes, and the mismatch
 * would only surface at integration. Declaring the surface once removes that
 * class of failure entirely.
 *
 * Rules for feature lanes:
 *   - The renderer NEVER touches fs, sqlite, or ipcRenderer directly. It calls
 *     the typed client, which only exposes what is declared here.
 *   - Handlers live in main and are registered from this map, so an unhandled
 *     channel is a startup error rather than a silent runtime rejection.
 *   - Anything long-running returns a Job and streams progress on an event
 *     channel. Do not block an IPC call on OCR.
 */

import type {
  CivilDate, ContactData, CustomFieldType, DocumentData, Folder, Item, ItemType,
  Job, JobProgressEvent, LibraryRelPath, MinorUnits, OcrStatus, Page,
  ReceiptData, ReceiptTaxLine, ResolvedPage, Rotation, RuleSource, SearchQuery,
  SearchResult, Sha256, SplitGroup,
} from './types.ts'

/* ===========================================================================
 * Composite read models
 * ======================================================================== */

/** Everything the details pane needs for one item, in a single round trip. */
export interface ItemDetail {
  item: Item
  receipt: ReceiptData | null
  document: DocumentData | null
  contact: ContactData | null
  taxLines: ReceiptTaxLine[]
  /** Resolved through v_item_pages, so a split child yields its origin's pages. */
  pages: ResolvedPage[]
  splitGroup: SplitGroup | null
  /** Sibling item ids when this item is part of a split. Excludes itself. */
  splitSiblings: number[]
  customFields: Record<string, string | null>
}

/** One row of the grid. Deliberately flat and denormalized — the grid renders
 *  10k of these and must not chase relations per row. */
export interface GridRow {
  itemId: number
  type: ItemType
  folderId: number
  txnDate: CivilDate | null
  vendorName: string | null
  categoryName: string | null
  paymentTypeName: string | null
  taxTotalMinor: MinorUnits | null
  totalMinor: MinorUnits | null
  currency: string
  reviewed: boolean
  hasImages: boolean
  isSplitChild: boolean
  /**
   * Worst OCR outcome across this item's pages.
   *
   *   'none'    no images (a manually created item)
   *   'pending' queued or running
   *   'done'    read successfully
   *   'failed'  OCR errored on at least one page
   *
   * Distinct from missingFields on purpose. "OCR could not read this receipt" and
   * "this receipt genuinely has no total printed on it" look identical in a list
   * of empty fields, and they call for different actions: the first needs manual
   * entry from the image, the second needs nothing at all.
   */
  ocrStatus: 'none' | 'pending' | 'done' | 'failed'
  /**
   * Lowest page confidence, 0..1, or null when there is nothing to report.
   * A very low value means the text was read but is not trustworthy — the faded,
   * skewed case, where every extracted field is suspect rather than absent.
   */
  ocrConfidence: number | null
  /**
   * True when this item cannot be trusted from OCR alone and wants a human: OCR
   * failed, or confidence is so low the read is meaningless, or a receipt has
   * images but yielded no usable total.
   */
  needsManualEntry: boolean
  /** Fields whose extraction confidence is below the display threshold. */
  lowConfidenceFields: string[]
  /** Key fields that are empty — drives the row's missing-data marker. */
  missingFields: string[]
}

/** Totals for the current filter. Grouped by currency because sums never cross
 *  currencies — a single number would be a lie in a mixed-currency folder. */
export interface FilterTotals {
  byCurrency: Array<{
    currency: string
    itemCount: number
    totalMinor: MinorUnits
    taxMinor: MinorUnits
  }>
  unreviewedCount: number
  /** True if any receipt in scope has no total at all, so the sum is incomplete. */
  hasIncompleteAmounts: boolean
  /** Items OCR could not read, or read too poorly to trust. Highest severity. */
  needsManualEntryCount: number
  /** Items with at least one field extracted below the confidence threshold. */
  lowConfidenceCount: number
  /** Items missing a key field (vendor, date, amount, category). */
  missingDataCount: number
  /** Union of the three above — the badge number for the Needs Review filter. */
  needsReviewCount: number
}

export interface ListRequest {
  folderId?: number
  includeSubfolders?: boolean
  type?: ItemType
  /**
   * 'needsReview' collects everything the app is not confident it got right:
   * failed or unusable OCR, a receipt with an image but no amount, a
   * low-confidence field, or missing key data. It exists so the answer to "did
   * anything come in wrong?" is one click, not a scan down a long list.
   */
  smartFilter?: 'all' | 'recent' | 'unreviewed' | 'inbox' | 'trash' | 'needsReview'
  /**
   * Include superseded split origins. Default false, and it should stay false
   * for any grid the user reads totals from: an origin listed beside its own
   * children makes the visible amounts add to double the real money. Set true
   * only for a deliberate split-history view reached from a child's badge.
   */
  includeSuperseded?: boolean
  sort?: Array<{ column: string; dir: 'asc' | 'desc' }>
  limit?: number
  offset?: number
}

export interface ListResponse {
  rows: GridRow[]
  total: number
  totals: FilterTotals
}

/** A field patch. Values arrive as strings from the grid and are parsed and
 *  validated in main — the renderer is not trusted to construct MinorUnits. */
export type ItemPatch = Partial<{
  folderId: number
  txnDate: string | null
  vendorName: string | null
  totalText: string | null
  currency: string
  paymentTypeName: string | null
  taxTotalText: string | null
  categoryName: string | null
  taxCategoryName: string | null
  projectName: string | null
  externalRef: string | null
  description: string | null
  title: string | null
  docDate: string | null
  notes: string | null
  reviewed: boolean
}>

export interface PatchResult {
  ok: boolean
  /** Per-field validation failures, keyed by patch key. */
  errors: Record<string, string>
  /** Fresh row so the grid does not need a second call to refresh. */
  row: GridRow | null
  /** Lists that gained a value because the user typed a new one (§1 auto-add). */
  createdListValues: Array<{ list: string; name: string }>
}

/** One part of a split. Either an explicit amount or a weight, never both. */
export type SplitPart = {
  amountText?: string
  weight?: number
  categoryName?: string | null
  taxCategoryName?: string | null
  projectName?: string | null
  description?: string | null
}

export interface SplitResult {
  splitGroupId: number
  originItemId: number
  originTotalMinor: MinorUnits
  children: Array<{ itemId: number; totalMinor: MinorUnits }>
  /** Must equal originTotalMinor. Returned so callers can assert, not assume. */
  sumMinor: MinorUnits
  /** Shared citation proof — identical for every child (acceptance #7). */
  imageSha256: Sha256 | null
}

export interface ImportRequest {
  paths: string[]
  targetFolderId?: number
  /** Default true: land in the Inbox for review rather than filing blindly. */
  toInbox?: boolean
}

export interface ImportResult {
  jobId: string
  itemIds: number[]
  /** Files that could not be read at all, with the reason. */
  rejected: Array<{ path: string; reason: string }>
}

export interface ExportRequest {
  format: 'csv' | 'xlsx' | 'pdf'
  itemIds?: number[]
  query?: SearchQuery
  destPath: string
  options?: {
    includeImages?: boolean
    coverPage?: boolean
    columns?: string[]
    imagesPerPage?: number
  }
}

export interface BackupResult {
  path: string
  dbSha256: Sha256
  fileCount: number
  bytes: number
}

export interface RestoreVerification {
  ok: boolean
  /** Graph-integrity checks, not a byte comparison (acceptance #9). */
  checks: Array<{ name: string; ok: boolean; detail: string }>
}

export interface HealthInfo {
  version: string
  schemaVersion: number
  migrationsApplied: number
  libraryRoot: string
  dbPath: string
  ocrEngine: string
  workerPool: { sharpPdf: number; ocrScheduler: number }
  /** False when a required native module or tessdata file is missing, so the UI
   *  can say what is broken instead of failing on first import. */
  nativeOk: boolean
  nativeDetail: string[]
}

/* ===========================================================================
 * The channel map
 * ======================================================================== */

export interface IpcMap {
  'app:health': { req: void; res: HealthInfo }

  'folder:list': { req: void; res: Folder[] }
  'folder:create': { req: { parentId: number | null; name: string }; res: Folder }
  'folder:update': { req: { id: number; patch: Partial<Pick<Folder, 'name' | 'parentId' | 'periodEnd' | 'comments' | 'template' | 'sortOrder'>> }; res: Folder }
  'folder:delete': { req: { id: number }; res: { ok: boolean; reason?: string } }

  'item:list': { req: ListRequest; res: ListResponse }
  'item:detail': { req: { id: number }; res: ItemDetail }
  'item:create': { req: { folderId: number; type: ItemType }; res: { itemId: number } }
  'item:patch': { req: { id: number; patch: ItemPatch }; res: PatchResult }
  'item:bulk': {
    req: { op: 'move' | 'delete' | 'restore' | 'reviewed' | 'clear'; ids: number[]; targetFolderId?: number }
    res: { affected: number; errors: Array<{ itemId: number; reason: string }> }
  }
  'item:trash': { req: { id: number }; res: { ok: boolean } }
  'item:restore': { req: { id: number }; res: { ok: boolean } }

  'item:split': { req: { id: number; parts: SplitPart[] }; res: SplitResult }
  'item:combine': { req: { ids: number[] }; res: { itemId: number; mergeGroupId: number } }
  'item:separate': { req: { id: number }; res: { itemIds: number[] } }

  'page:rotate': { req: { pageId: number; rotation: Rotation }; res: { ok: boolean } }
  'page:crop': { req: { pageId: number; x: number; y: number; w: number; h: number }; res: { ok: boolean; ocrInvalidated: true } }
  'page:reorder': { req: { itemId: number; pageIdsInOrder: number[] }; res: { ok: boolean } }
  'page:delete': { req: { pageId: number }; res: { ok: boolean } }
  'page:import': { req: { itemId: number; paths: string[] }; res: { pageIds: number[]; jobId: string } }
  'page:exportImage': { req: { pageId: number; destPath: string }; res: { path: string } }
  /** Assigns a user-drawn region's text to a field. Coordinates are in
   *  stored-master pixel space, matching Word.bbox. */
  'page:assignRegion': { req: { pageId: number; field: string; x: number; y: number; w: number; h: number }; res: PatchResult }

  'ingest:import': { req: ImportRequest; res: ImportResult }
  'ingest:inboxCount': { req: void; res: { count: number } }

  'ocr:requeue': { req: { pageIds: number[]; force?: boolean }; res: { jobId: string } }
  'ocr:status': { req: { pageIds: number[] }; res: Array<{ pageId: number; status: OcrStatus; confidence: number | null }> }

  'search:query': { req: SearchQuery; res: SearchResult }
  'search:missingKeyData': { req: { folderId?: number }; res: { rows: GridRow[]; total: number } }

  'export:run': { req: ExportRequest; res: { jobId: string; path: string } }

  'job:get': { req: { id: string }; res: Job | null }
  'job:cancel': { req: { id: string }; res: { ok: boolean } }

  'list:values': { req: { list: 'vendor' | 'category' | 'taxCategory' | 'paymentType' | 'project' }; res: Array<{ id: number; name: string }> }
  'list:upsert': { req: { list: string; name: string }; res: { id: number; created: boolean } }

  'rule:list': { req: void; res: Array<{ id: number; kind: string; match: unknown; action: unknown; priority: number; source: RuleSource; hitCount: number; enabled: boolean }> }
  'rule:upsert': { req: { id?: number; kind: string; match: unknown; action: unknown; priority?: number; enabled?: boolean }; res: { id: number } }

  'customField:list': { req: void; res: Array<{ id: number; scope: string; key: string; label: string; datatype: CustomFieldType; required: boolean }> }
  'customField:upsert': { req: { id?: number; scope: string; key: string; label: string; datatype: CustomFieldType; required?: boolean }; res: { id: number } }

  'maint:backup': { req: { destPath?: string }; res: BackupResult }
  'maint:restore': { req: { srcPath: string }; res: RestoreVerification }
  'maint:archive': { req: { cutoff: CivilDate; destPath?: string }; res: { path: string; itemsMoved: number } }
  'maint:emptyTrash': { req: void; res: { itemsPurged: number; filesReleased: number } }

  'shell:revealFile': { req: { rel: LibraryRelPath }; res: { ok: boolean } }
}

export type IpcChannel = keyof IpcMap
export type IpcReq<C extends IpcChannel> = IpcMap[C]['req']
export type IpcRes<C extends IpcChannel> = IpcMap[C]['res']

/** Push channels: main → renderer. Not invokable. */
export interface IpcEvents {
  'job:progress': JobProgressEvent
  'item:changed': { itemIds: number[]; reason: 'ocr' | 'edit' | 'import' | 'split' | 'trash' | 'restore' }
  'folder:changed': { folderIds: number[] }
  'ocr:pageDone': { pageId: number; itemId: number; status: OcrStatus; confidence: number | null }
  'library:opened': { libraryRoot: string }
}
export type IpcEventName = keyof IpcEvents

/**
 * The renderer-facing shape exposed by preload. Nothing else crosses the bridge:
 * no fs, no child_process, no raw ipcRenderer, no db handle.
 */
export interface KeeprBridge {
  invoke<C extends IpcChannel>(channel: C, req: IpcReq<C>): Promise<IpcRes<C>>
  on<E extends IpcEventName>(event: E, fn: (payload: IpcEvents[E]) => void): () => void
}

/** Every channel that must have a registered handler at startup. Main asserts
 *  this list is fully covered and refuses to boot otherwise, so a missing
 *  handler is a loud startup failure rather than a rejected promise in week
 *  three. Keep in sync with IpcMap — the type test in Lane 0 enforces it. */
export const IPC_CHANNELS = [
  'app:health',
  'folder:list', 'folder:create', 'folder:update', 'folder:delete',
  'item:list', 'item:detail', 'item:create', 'item:patch', 'item:bulk', 'item:trash', 'item:restore',
  'item:split', 'item:combine', 'item:separate',
  'page:rotate', 'page:crop', 'page:reorder', 'page:delete', 'page:import', 'page:exportImage', 'page:assignRegion',
  'ingest:import', 'ingest:inboxCount',
  'ocr:requeue', 'ocr:status',
  'search:query', 'search:missingKeyData',
  'export:run',
  'job:get', 'job:cancel',
  'list:values', 'list:upsert',
  'rule:list', 'rule:upsert',
  'customField:list', 'customField:upsert',
  'maint:backup', 'maint:restore', 'maint:archive', 'maint:emptyTrash',
  'shell:revealFile',
] as const satisfies readonly IpcChannel[]

/* Compile-time completeness check: if a channel is added to IpcMap but not to
 * IPC_CHANNELS, this fails to typecheck. Cheap insurance against the exact
 * drift this file exists to prevent. */
type MissingFromList = Exclude<IpcChannel, (typeof IPC_CHANNELS)[number]>
const _assertNoMissingChannels: MissingFromList extends never ? true : ['channels missing from IPC_CHANNELS:', MissingFromList] = true
void _assertNoMissingChannels
