/**
 * App shell — Lane 0, owned by the orchestrator.
 *
 * Composes the three panes the user approved at the UI gate. This is the ONLY
 * file that mounts panels and the only one that talks to the bridge; the panels
 * are pure presentation over props, which is what let lanes E, F and G be built
 * in parallel without fighting over a layout file.
 *
 * State that more than one pane needs lives here: selection, folder, filter,
 * sort, columns. A panel never reaches for another panel's state.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Folder, ResolvedPage, Rotation, ScanCaps, ScanDevice, ScanOptions } from '../../shared/types.ts'
import type {
  FilterTotals, GridRow, ItemDetail, ItemPatch, ListRequest, PatchResult,
} from '../../shared/ipc.ts'
import { getPathForFile, hasBridge, invoke, on } from '../bridge.ts'
import { ThumbPanel } from '../thumbs/index.ts'
import { ScanPanel } from '../scan/index.ts'
import { NavPanel } from '../nav/index.ts'
import { GridPanel, DEFAULT_COLUMNS, formatMoney, pruneToVisible, type ColumnState, type SortSpec } from '../grid/index.ts'
import { ViewerPanel } from '../viewer/index.ts'

type ViewMode = 'grid' | 'thumbnail' | 'details'
type SmartFilter = NonNullable<ListRequest['smartFilter']>

interface Health {
  version: string
  schemaVersion: number
  libraryRoot: string
  nativeOk: boolean
  nativeDetail: string[]
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [rows, setRows] = useState<GridRow[]>([])
  const [totals, setTotals] = useState<FilterTotals | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedFolder, setSelectedFolder] = useState<number | null>(null)
  const [smartFilter, setSmartFilter] = useState<SmartFilter>('all')
  const [view, setView] = useState<ViewMode>('grid')
  const [inboxCount, setInboxCount] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [openItemId, setOpenItemId] = useState<number | null>(null)
  const [detail, setDetail] = useState<ItemDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [activePage, setActivePage] = useState(0)
  const [sort, setSort] = useState<SortSpec[]>([{ column: 'txnDate', dir: 'desc' }])
  const [columns, setColumns] = useState<ColumnState[]>(DEFAULT_COLUMNS)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState<{ total: number; done: number; failed: number } | null>(null)
  const [importMenuOpen, setImportMenuOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [scanDevices, setScanDevices] = useState<ScanDevice[]>([])
  const [scanDiscovering, setScanDiscovering] = useState(false)
  const [scanSelected, setScanSelected] = useState<string | null>(null)
  const [scanCaps, setScanCaps] = useState<ScanCaps | null>(null)
  const [scanCapsLoading, setScanCapsLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanPages, setScanPages] = useState<Array<{ n: number; state: 'scanning' | 'done' | 'failed' }>>([])
  const [scanError, setScanError] = useState<string | null>(null)
  const [watcherNote, setWatcherNote] = useState<string | null>(null)
  /** Job ids started by scans — job:progress for these must not drive the Import
   *  button's indicator. Zero-contract demux: we know the ids because scan:start
   *  returned them. */
  const scanJobIds = useRef<Set<string>>(new Set())
  const activeScanJobId = useRef<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const offline = !hasBridge()
  // Guards against a slow response for an abandoned filter overwriting the
  // current one — the same generation problem the OCR path has.
  const reqSeq = useRef(0)
  // The detail fetch needs its own generation for the same reason the list does:
  // open A, quickly open B, and A's slower response would otherwise land last and
  // show A's fields while B is selected.
  const detailSeq = useRef(0)

  const refresh = useCallback(async () => {
    if (offline) return
    const seq = ++reqSeq.current
    setLoading(true)
    try {
      const req: ListRequest = { smartFilter, sort }
      if (selectedFolder != null) {
        req.folderId = selectedFolder
        req.includeSubfolders = true
      }
      const [res, inbox] = await Promise.all([
        invoke('item:list', req),
        invoke('ingest:inboxCount', undefined),
      ])
      if (seq !== reqSeq.current) return // a newer request already won
      setRows(res.rows)
      setTotals(res.totals)
      setInboxCount(inbox.count)
      setError(null)
    } catch (e) {
      if (seq === reqSeq.current) setError((e as Error).message)
    } finally {
      if (seq === reqSeq.current) setLoading(false)
    }
  }, [offline, selectedFolder, smartFilter, sort])

  const loadFolders = useCallback(async () => {
    if (offline) return
    try { setFolders(await invoke('folder:list', undefined)) }
    catch (e) { setError((e as Error).message) }
  }, [offline])

  useEffect(() => {
    if (offline) return
    void (async () => {
      try { setHealth((await invoke('app:health', undefined)) as Health) }
      catch (e) { setError((e as Error).message) }
    })()
    void loadFolders()
  }, [offline, loadFolders])

  useEffect(() => { void refresh() }, [refresh])

  // Main-process pushes: OCR finishing or an import landing must update the grid
  // without the user having to click something.
  useEffect(() => {
    if (offline) return
    const offItem = on('item:changed', () => { void refresh() })
    const offOcr = on('ocr:pageDone', () => { void refresh() })
    return () => { offItem(); offOcr() }
  }, [offline, refresh])

  useEffect(() => {
    if (offline || openItemId == null) { setDetail(null); return }
    const seq = ++detailSeq.current
    setDetailLoading(true)
    void (async () => {
      try {
        const d = await invoke('item:detail', { id: openItemId })
        if (seq !== detailSeq.current) return // a newer selection already won
        setDetail(d)
        setActivePage(0)
      } catch (e) { if (seq === detailSeq.current) setError((e as Error).message) }
      finally { if (seq === detailSeq.current) setDetailLoading(false) }
    })()
  }, [offline, openItemId])

  const onPatch = useCallback(async (itemId: number, patch: ItemPatch): Promise<PatchResult> => {
    const res = await invoke('item:patch', { id: itemId, patch })
    if (res.ok) {
      // A patch can create a list value, change a total, or alter a folder — all
      // of which move numbers in the status bar, so re-read rather than guess.
      void refresh()
      if (res.createdListValues.length) void loadFolders()
      if (openItemId === itemId) setDetail(await invoke('item:detail', { id: itemId }))
    }
    return res
  }, [refresh, loadFolders, openItemId])

  /**
   * Changing what is on screen invalidates what was selected on it.
   *
   * Without this, selecting three receipts and switching folder left the status bar
   * claiming "3 selected" for rows that are not visible, the inspector showing an
   * item absent from the list, and any bulk operation acting on invisible ids.
   */
  const changeScope = useCallback((apply: () => void) => {
    setSelectedIds(new Set())
    setOpenItemId(null)
    setDetail(null)
    apply()
  }, [])

  /**
   * A selection can also go stale WITHOUT the user changing scope — a background
   * refresh after OCR or an import can drop rows. Prune to what is actually
   * listed, so a bulk action can never reach an id the user cannot see.
   */
  useEffect(() => {
    const live = new Set(rows.map((r) => r.itemId))
    setSelectedIds((prev) => pruneToVisible(prev, live))
    if (openItemId != null && rows.length > 0 && !live.has(openItemId)) {
      setOpenItemId(null)
      setDetail(null)
    }
  }, [rows, openItemId])

  /** Selection totals for the status bar — per currency, from the listed rows. */
  const selectionTotals = useMemo(() => {
    if (selectedIds.size === 0) return null
    const byCur = new Map<string, { totalMinor: number; taxMinor: number; count: number }>()
    for (const r of rows) {
      if (!selectedIds.has(r.itemId)) continue
      const cur = r.currency || 'USD'
      const acc = byCur.get(cur) ?? { totalMinor: 0, taxMinor: 0, count: 0 }
      acc.totalMinor += r.totalMinor ?? 0
      acc.taxMinor += r.taxTotalMinor ?? 0
      acc.count += 1
      byCur.set(cur, acc)
    }
    return [...byCur.entries()].map(([currency, v]) => ({ currency, ...v }))
  }, [rows, selectedIds])

  /**
   * Import paths into the Inbox.
   *
   * Deliberately does NOT await OCR: the job id comes back immediately and OCR
   * continues in the background, so a 40-page batch does not freeze the window.
   * Progress arrives on the job:progress event and the grid refreshes as pages
   * finish.
   */
  const runImport = useCallback(async (paths: string[]) => {
    if (offline || paths.length === 0) return
    setImporting({ total: paths.length, done: 0, failed: 0 })
    try {
      const res = await invoke('ingest:import', { paths, toInbox: true })
      if (res.rejected.length) {
        setError(
          `${res.rejected.length} file(s) could not be read: ` +
            res.rejected.map((r) => `${r.path.split(/[\\/]/).pop()} (${r.reason})`).join('; '),
        )
      }
      // Jump to the Inbox so the imported items are actually in view — importing
      // and then appearing to do nothing is the worst outcome.
      changeScope(() => { setSmartFilter('inbox'); setSelectedFolder(null) })
      await refresh()
    } catch (e) {
      setError((e as Error).message)
      setImporting(null)
    }
  }, [offline, refresh])

  const pickAndImport = useCallback(async () => {
    try {
      const res = await invoke('dialog:pickImportFiles', undefined)
      if (!res.canceled && res.paths.length) await runImport(res.paths)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [runImport])

  // Job progress drives the import indicator and clears it when work finishes.
  useEffect(() => {
    if (offline) return
    return on('job:progress', (e) => {
      // Scan jobs report through scan:* — without this guard the Import button
      // flashes "Importing" during scans and watcher pickups.
      if (scanJobIds.current.has(e.jobId)) return
      if (e.status === 'done' || e.status === 'failed' || e.status === 'cancelled' || e.status === 'partial') {
        setImporting(null)
        void refresh()
      } else {
        setImporting({ total: e.totalUnits, done: e.doneUnits, failed: e.failedUnits })
      }
    })
  }, [offline, refresh])

  // Scan lifecycle events drive the modal's progress list.
  useEffect(() => {
    if (offline) return
    const offP = on('scan:progress', (e) => {
      setScanPages((prev) => {
        const next = prev.filter((p) => p.n !== e.page)
        next.push({ n: e.page, state: e.state })
        return next.sort((a, b) => a.n - b.n)
      })
    })
    const offD = on('scan:done', (e) => {
      if (activeScanJobId.current === e.jobId) activeScanJobId.current = null
      // Keep the id for demux until its terminal job:progress has surely passed,
      // then prune — the set must not grow for the life of the window.
      window.setTimeout(() => scanJobIds.current.delete(e.jobId), 30_000)
      setScanning(false)
      setScanPages((prev) => prev.map((p) => ({ ...p, state: 'done' as const })))
      setScanError(null)
      void refresh()
    })
    const offE = on('scan:error', (e) => {
      if (activeScanJobId.current === e.jobId) activeScanJobId.current = null
      window.setTimeout(() => scanJobIds.current.delete(e.jobId), 30_000)
      setScanning(false)
      setScanError(e.message)
    })
    return () => { offP(); offD(); offE() }
  }, [offline, refresh])

  // Watcher activity: refresh the grid and surface a transient note — files
  // ingested by the New Receipts folder should feel like the app did something,
  // not like rows appeared by magic.
  useEffect(() => {
    if (offline) return
    return on('watcher:activity', (e) => {
      if (e.ingested > 0 || e.duplicates > 0 || e.failed > 0) {
        const bits: string[] = []
        if (e.ingested) bits.push(`${e.ingested} imported`)
        if (e.duplicates) bits.push(`${e.duplicates} duplicate${e.duplicates === 1 ? '' : 's'} archived`)
        if (e.failed) bits.push(`${e.failed} failed`)
        setWatcherNote(`New Receipts: ${bits.join(' · ')}`)
        window.setTimeout(() => setWatcherNote(null), 6000)
        void refresh()
      }
    })
  }, [offline, refresh])

  const openScan = useCallback(async () => {
    setScanOpen(true)
    setScanError(null)
    setScanPages([])
    setScanDiscovering(true)
    try {
      const res = await invoke('scan:discover', { timeoutMs: 3000 })
      setScanDevices(res.devices)
      if (res.devices.length === 1 && res.devices[0]) setScanSelected(res.devices[0].id)
    } catch (e) {
      setScanError((e as Error).message)
    } finally {
      setScanDiscovering(false)
    }
  }, [])

  useEffect(() => {
    if (!scanSelected) { setScanCaps(null); return }
    setScanCapsLoading(true)
    setScanCaps(null)
    void invoke('scan:capabilities', { deviceId: scanSelected })
      .then(setScanCaps)
      .catch((e) => setScanError((e as Error).message))
      .finally(() => setScanCapsLoading(false))
  }, [scanSelected])

  const startScan = useCallback(async (options: ScanOptions) => {
    if (!scanSelected) return
    setScanError(null)
    setScanPages([])
    setScanning(true)
    try {
      const { jobId } = await invoke('scan:start', { deviceId: scanSelected, options })
      scanJobIds.current.add(jobId)
      activeScanJobId.current = jobId
    } catch (e) {
      setScanning(false)
      setScanError((e as Error).message)
    }
  }, [scanSelected])

  const markReviewed = useCallback(async (ids: number[]) => {
    if (!ids.length) return
    await invoke('item:bulk', { op: 'reviewed', ids })
    setSelectedIds(new Set())
    await refresh()
    if (openItemId != null && ids.includes(openItemId)) {
      setDetail(await invoke('item:detail', { id: openItemId }))
    }
  }, [refresh, openItemId])

  const inbox = useMemo(() => folders.find((f) => f.kind === 'inbox') ?? null, [folders])

  const pageSrc = useCallback((page: ResolvedPage): string => {
    const root = health?.libraryRoot ?? ''
    // Electron serves local files through the file protocol; the renderer never
    // joins a path itself beyond this one display concern.
    const sep = root.includes('\\') ? '\\' : '/'
    return `file://${encodeURI(`${root}${sep}${page.fileRelPath}`.replace(/\\/g, '/'))}`
  }, [health])

  const primary = totals?.byCurrency[0]
  const showDetails = view === 'details' && detail != null

  return (
    <div
      className={dragging ? 'app app-dragging' : 'app'}
      onDragOver={(e) => {
        // Only claim the drag when it actually carries files, so an internal
        // row-drag is not intercepted by the window-level handler.
        if (Array.from(e.dataTransfer.types).includes('Files')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => {
        // Ignore leaves fired while moving between child elements.
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={(e) => {
        if (!Array.from(e.dataTransfer.types).includes('Files')) return
        e.preventDefault()
        setDragging(false)
        // getPathForFile, not File.path — the latter was removed in Electron 32
        // and reading it would silently yield undefined for every file.
        const paths = Array.from(e.dataTransfer.files)
          .map((f) => getPathForFile(f))
          .filter((p): p is string => typeof p === 'string' && p.length > 0)
        if (paths.length) void runImport(paths)
      }}
    >
      <header className="titlebar">
        <span className="brand">KeepR</span>
        <span className="titlebar-sub">
          {health ? health.libraryRoot : offline ? 'renderer preview — no bridge' : 'connecting'}
        </span>
        {health && !health.nativeOk && (
          <span className="titlebar-warn" title={health.nativeDetail.join('; ')}>
            native check failed
          </span>
        )}
        <button
          type="button"
          className="btn-primary titlebar-scan"
          onClick={() => void openScan()}
          disabled={offline}
          title="Scan from a network (AirScan/eSCL) scanner into the Inbox"
        >
          Scan
        </button>
        <div className="import-menu-wrap">
          <button
            type="button"
            className="btn-primary titlebar-import"
            onClick={() => setImportMenuOpen((v) => !v)}
            disabled={offline || importing != null}
            aria-haspopup="menu"
            aria-expanded={importMenuOpen}
            title="Import receipt images, PDFs or vCards (or drag files onto the window)"
          >
            {importing ? `Importing ${importing.done}/${importing.total}` : 'Import ▾'}
          </button>
          {importMenuOpen && (
            <>
              {/* Click-away scrim: cheaper and more predictable than global
                  listeners, and it cannot leak. */}
              <div className="menu-scrim" onClick={() => setImportMenuOpen(false)} />
              <div className="app-menu" role="menu">
                <button type="button" role="menuitem" className="app-menu-item"
                  onClick={() => { setImportMenuOpen(false); void pickAndImport() }}>
                  Files…
                </button>
                <button type="button" role="menuitem" className="app-menu-item"
                  onClick={async () => {
                    setImportMenuOpen(false)
                    const res = await invoke('dialog:pickImportFolder', undefined)
                    if (!res.canceled && res.paths.length) await runImport(res.paths)
                  }}>
                  Folder…
                </button>
                <div className="app-menu-divider" />
                <button type="button" role="menuitem" className="app-menu-item"
                  onClick={() => { setImportMenuOpen(false); void invoke('shell:openPath', { target: 'newReceipts' }) }}>
                  Open New Receipts Folder
                </button>
                <button type="button" role="menuitem" className="app-menu-item"
                  onClick={() => { setImportMenuOpen(false); void invoke('shell:openPath', { target: 'oldReceipts' }) }}>
                  Open Old Receipts Folder
                </button>
              </div>
            </>
          )}
        </div>
        <div className="seg" role="tablist" aria-label="View">
          {(['grid', 'thumbnail', 'details'] as ViewMode[]).map((v) => (
            <button key={v} role="tab" aria-selected={view === v}
              className={view === v ? 'seg-item seg-active' : 'seg-item'}
              onClick={() => setView(v)}>
              {v === 'grid' ? 'Grid' : v === 'thumbnail' ? 'Thumbnail' : 'Details'}
            </button>
          ))}
        </div>
      </header>

      <div className="body">
        {/* The navigation pane stays visible in Details view — approved at the gate. */}
        <NavPanel
          folders={folders}
          inboxCount={inboxCount}
          selectedFolderId={selectedFolder}
          smartFilter={smartFilter}
          needsReviewCount={totals?.needsReviewCount ?? 0}
          onSelectFolder={(id) => changeScope(() => { setSelectedFolder(id); setSmartFilter('all') })}
          onSelectSmartFilter={(f) => changeScope(() => { setSmartFilter(f); setSelectedFolder(null) })}
          onCreateFolder={async (parentId, name) => {
            await invoke('folder:create', { parentId, name }); await loadFolders()
          }}
          onRenameFolder={async (id, name) => {
            await invoke('folder:update', { id, patch: { name } }); await loadFolders()
          }}
          onMoveFolder={async (id, newParentId) => {
            await invoke('folder:update', { id, patch: { parentId: newParentId } }); await loadFolders()
          }}
          onDropItems={async (itemIds, folderId) => {
            await invoke('item:bulk', { op: 'move', ids: itemIds, targetFolderId: folderId })
            setSelectedIds(new Set()); await refresh()
          }}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
        />

        <main className="content">
          {error && <div className="banner banner-danger">{error}</div>}
          {offline && (
            <div className="banner banner-warn">
              Renderer preview: no preload bridge, so no library is attached.
            </div>
          )}
          {view === 'details' && detail == null ? (
            /* The Details button previously did NOTHING without a selection —
               one of the user's 'buttons that don't work'. An instructive empty
               state beats a silent no-op. */
            <div className="details-empty">
              <p>No item open.</p>
              <p className="muted">
                Double-click a receipt in the Grid or Thumbnail view, or select
                one and press Enter.
              </p>
            </div>
          ) : showDetails ? (
            <ViewerPanel
              variant="details"
              detail={detail}
              loading={detailLoading}
              activePageIndex={activePage}
              onActivePageChange={setActivePage}
              pageSrc={pageSrc}
              onPatch={onPatch}
              onRotate={async (pageId, rotation: Rotation) => {
                await invoke('page:rotate', { pageId, rotation })
                if (openItemId != null) setDetail(await invoke('item:detail', { id: openItemId }))
              }}
              onReorderPages={async (itemId, order) => {
                await invoke('page:reorder', { itemId, pageIdsInOrder: order })
                setDetail(await invoke('item:detail', { id: itemId }))
              }}
              onDeletePage={async (pageId) => {
                await invoke('page:delete', { pageId })
                if (openItemId != null) setDetail(await invoke('item:detail', { id: openItemId }))
              }}
              onAssignRegion={async (pageId, field, box) =>
                invoke('page:assignRegion', { pageId, field, x: box.x, y: box.y, w: box.w, h: box.h })
              }
            />
          ) : view === 'thumbnail' ? (
            /* The other dead button: this view did not exist at all. */
            <ThumbPanel
              rows={rows}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              onOpenItem={(id) => { setOpenItemId(id); setView('details') }}
              thumbSrc={(row) =>
                row.thumbRelPath
                  ? pageSrc({ fileRelPath: row.thumbRelPath } as ResolvedPage)
                  : null
              }
              loading={loading}
            />
          ) : (
            <GridPanel
              rows={rows}
              totals={totals}
              loading={loading}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              onOpenItem={(id) => { setOpenItemId(id); setView('details') }}
              onPatch={onPatch}
              sort={sort}
              onSortChange={setSort}
              columns={columns}
              onColumnsChange={setColumns}
              density="compact"
            />
          )}
        </main>

        {!showDetails && (
          <aside className="inspector" aria-label="Item details">
            <div className="pane-head">
              Receipt Details
              {openItemId != null && detail && detail.item.reviewedAt == null && (
                <button
                  type="button"
                  className="btn-primary btn-small pane-head-action"
                  onClick={() => void markReviewed([openItemId])}
                  title="Mark this item reviewed (Cmd/Ctrl+Enter in the grid)"
                >
                  Mark Reviewed
                </button>
              )}
              {openItemId != null && detail && detail.item.reviewedAt != null && (
                <span className="pane-head-reviewed">Reviewed</span>
              )}
            </div>
            {openItemId == null ? (
              <div className="inspector-empty muted">Select an item</div>
            ) : (
              <ViewerPanel
                variant="inspector"
                detail={detail}
                loading={detailLoading}
                activePageIndex={activePage}
                onActivePageChange={setActivePage}
                pageSrc={pageSrc}
                onPatch={onPatch}
                onRotate={async (pageId, rotation: Rotation) => {
                  await invoke('page:rotate', { pageId, rotation })
                  if (openItemId != null) setDetail(await invoke('item:detail', { id: openItemId }))
                }}
                onReorderPages={async (itemId, order) => {
                  await invoke('page:reorder', { itemId, pageIdsInOrder: order })
                  setDetail(await invoke('item:detail', { id: itemId }))
                }}
                onDeletePage={async (pageId) => {
                  await invoke('page:delete', { pageId })
                  if (openItemId != null) setDetail(await invoke('item:detail', { id: openItemId }))
                }}
                onAssignRegion={async (pageId, field, box) =>
                  invoke('page:assignRegion', { pageId, field, x: box.x, y: box.y, w: box.w, h: box.h })
                }
              />
            )}
          </aside>
        )}
      </div>

      {scanOpen && (
        <div className="modal-scrim" onClick={() => !scanning && setScanOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <ScanPanel
              devices={scanDevices}
              discovering={scanDiscovering}
              selectedId={scanSelected}
              caps={scanCaps}
              capsLoading={scanCapsLoading}
              scanning={scanning}
              pages={scanPages}
              error={scanError}
              onRefresh={() => void openScan()}
              onSelect={setScanSelected}
              onProbe={(host, port) => {
                void invoke('scan:probe', { host, ...(port === undefined ? {} : { port }) }).then((r) => {
                  if (r.device) {
                    setScanDevices((prev) =>
                      prev.some((d) => d.id === r.device!.id) ? prev : [...prev, r.device!],
                    )
                    setScanSelected(r.device.id)
                  } else if (r.error) setScanError(r.error)
                })
              }}
              onScan={(options) => void startScan(options)}
              onCancel={() => {
                if (activeScanJobId.current) {
                  void invoke('scan:cancel', { jobId: activeScanJobId.current })
                }
              }}
              onClose={() => setScanOpen(false)}
            />
          </div>
        </div>
      )}

      {dragging && (
        <div className="drop-overlay" aria-hidden>
          <div className="drop-overlay-inner">
            <div className="drop-overlay-title">Drop to import</div>
            <div className="drop-overlay-sub">Images, PDFs and vCards land in the Inbox for review</div>
          </div>
        </div>
      )}

      <footer className="statusbar">
        <span>
          {rows.length} item{rows.length === 1 ? '' : 's'}
          {selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
          {selectedFolder != null && folders.find((f) => f.id === selectedFolder)
            ? ` · ${folders.find((f) => f.id === selectedFolder)!.name}` : ''}
        </span>
        <span className="status-right">
          {/* When a selection exists, the status bar reports the SELECTION, because
              multi-selecting to check a partial sum is the reason to select at all.
              Labelled so it is never mistaken for the filter total. Per-currency
              either way: one blended figure across currencies would be a lie with a
              currency symbol in front of it. */}
          {selectionTotals ? (
            selectionTotals.map((c) => (
              <span key={c.currency} className="stat">
                Selected{selectionTotals.length > 1 ? ` ${c.currency}` : ''}{' '}
                <strong className="num">{formatMoney(c.totalMinor, c.currency)}</strong>
              </span>
            ))
          ) : totals && totals.byCurrency.length > 1 ? (
            totals.byCurrency.map((c) => (
              <span key={c.currency} className="stat">
                {c.currency} <strong className="num">{formatMoney(c.totalMinor, c.currency)}</strong>
              </span>
            ))
          ) : (
            <>
              <span className="stat">
                Sum <strong className="num">{formatMoney(primary?.totalMinor ?? 0, primary?.currency)}</strong>
              </span>
              <span className="stat">
                Tax <strong className="num">{formatMoney(primary?.taxMinor ?? 0, primary?.currency)}</strong>
              </span>
            </>
          )}
          {selectedIds.size > 0 && (
            <button
              type="button"
              className="stat stat-flag"
              onClick={() => void markReviewed([...selectedIds])}
              title="Mark every selected item reviewed"
            >
              Mark {selectedIds.size} reviewed
            </button>
          )}
          {watcherNote && <span className="stat stat-watcher">{watcherNote}</span>}
          {/* Flag summary. Clickable, because seeing "3 need review" and then
              having to find the filter yourself is a dead end. */}
          {totals && totals.needsReviewCount > 0 && (
            <button
              type="button"
              className="stat stat-flag"
              onClick={() => changeScope(() => { setSmartFilter('needsReview'); setSelectedFolder(null) })}
              title={
                `${totals.needsManualEntryCount} need manual entry · ` +
                `${totals.missingDataCount} missing key data · ` +
                `${totals.lowConfidenceCount} low confidence`
              }
            >
              {totals.needsManualEntryCount > 0 && (
                <span className="stat-flag-danger">{totals.needsManualEntryCount} need entry</span>
              )}
              {totals.needsManualEntryCount > 0 && totals.needsReviewCount > totals.needsManualEntryCount && ' · '}
              {totals.needsReviewCount > totals.needsManualEntryCount && (
                <span className="stat-flag-warn">
                  {totals.needsReviewCount - totals.needsManualEntryCount} to check
                </span>
              )}
            </button>
          )}
          {totals?.hasIncompleteAmounts && (
            <span className="stat stat-warn" title="Some receipts have no amount, so this sum is incomplete">
              incomplete
            </span>
          )}
          {/* text-secondary, not warn: a queue depth is not a problem. */}
          {totals && totals.unreviewedCount > 0 && (
            <span className="stat stat-quiet">{totals.unreviewedCount} unreviewed</span>
          )}
          {inbox && inboxCount > 0 && <span className="stat stat-quiet">inbox {inboxCount}</span>}
          {health && <span className="stat stat-quiet">schema v{health.schemaVersion}</span>}
        </span>
      </footer>
    </div>
  )
}
