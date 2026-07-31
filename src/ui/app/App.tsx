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
import type { Folder, ResolvedPage, Rotation } from '../../shared/types.ts'
import type {
  FilterTotals, GridRow, ItemDetail, ItemPatch, ListRequest, PatchResult,
} from '../../shared/ipc.ts'
import { hasBridge, invoke, on } from '../bridge.ts'
import { NavPanel } from '../nav/index.ts'
import { GridPanel, DEFAULT_COLUMNS, formatMoney, type ColumnState, type SortSpec } from '../grid/index.ts'
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

  const offline = !hasBridge()
  // Guards against a slow response for an abandoned filter overwriting the
  // current one — the same generation problem the OCR path has.
  const reqSeq = useRef(0)

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
    setDetailLoading(true)
    void (async () => {
      try {
        setDetail(await invoke('item:detail', { id: openItemId }))
        setActivePage(0)
      } catch (e) { setError((e as Error).message) }
      finally { setDetailLoading(false) }
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
    <div className="app">
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
          onSelectFolder={(id) => { setSelectedFolder(id); setSmartFilter('all') }}
          onSelectSmartFilter={(f) => { setSmartFilter(f); setSelectedFolder(null) }}
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
          {showDetails ? (
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
            <div className="pane-head">Receipt Details</div>
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

      <footer className="statusbar">
        <span>
          {rows.length} item{rows.length === 1 ? '' : 's'}
          {selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
          {selectedFolder != null && folders.find((f) => f.id === selectedFolder)
            ? ` · ${folders.find((f) => f.id === selectedFolder)!.name}` : ''}
        </span>
        <span className="status-right">
          {/* Per-currency, always. One blended figure across currencies would be a
              lie with a currency symbol in front of it. */}
          {totals && totals.byCurrency.length > 1 ? (
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
