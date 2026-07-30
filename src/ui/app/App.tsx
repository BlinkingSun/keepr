/**
 * App shell — Lane 0, owned by the orchestrator.
 *
 * Composes the three-pane frame the user approved at the UI gate. Lanes E, F and
 * G fill the panes; this file owns the frame and the shared state, and it is the
 * ONE place that composes them. That single-writer rule is why three UI lanes can
 * be built in parallel without fighting over a layout file.
 *
 * Panels receive data and callbacks as props. They do not call the bridge
 * directly, so a panel stays testable without Electron.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Folder } from '../../shared/types.ts'
import type { FilterTotals, GridRow, ListRequest } from '../../shared/ipc.ts'
import { hasBridge, invoke } from '../bridge.ts'

type ViewMode = 'grid' | 'thumbnail' | 'details'
type SmartFilter = NonNullable<ListRequest['smartFilter']>

interface Health {
  version: string
  schemaVersion: number
  libraryRoot: string
  nativeOk: boolean
  nativeDetail: string[]
}

/** Money for display. Minor units in, never a float anywhere in the path. */
function fmtMoney(minor: number | null | undefined, currency = 'USD'): string {
  if (minor == null) return '—'
  const neg = minor < 0
  const abs = Math.abs(minor)
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
  const withSep = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : ''
  return `${neg ? '-' : ''}${sym}${withSep}`
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [rows, setRows] = useState<GridRow[]>([])
  const [totals, setTotals] = useState<FilterTotals | null>(null)
  const [selectedFolder, setSelectedFolder] = useState<number | null>(null)
  const [smartFilter, setSmartFilter] = useState<SmartFilter>('all')
  const [view, setView] = useState<ViewMode>('grid')
  const [inboxCount, setInboxCount] = useState(0)
  const [selectedItem, setSelectedItem] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const offline = !hasBridge()

  const refresh = useCallback(async () => {
    if (offline) return
    try {
      const req: ListRequest = { smartFilter }
      if (selectedFolder != null) {
        req.folderId = selectedFolder
        req.includeSubfolders = true
      }
      const [res, inbox] = await Promise.all([
        invoke('item:list', req),
        invoke('ingest:inboxCount', undefined),
      ])
      setRows(res.rows)
      setTotals(res.totals)
      setInboxCount(inbox.count)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [offline, selectedFolder, smartFilter])

  useEffect(() => {
    if (offline) return
    void (async () => {
      try {
        const [h, f] = await Promise.all([invoke('app:health', undefined), invoke('folder:list', undefined)])
        setHealth(h as Health)
        setFolders(f)
      } catch (e) {
        setError((e as Error).message)
      }
    })()
  }, [offline])

  useEffect(() => { void refresh() }, [refresh])

  const inbox = folders.find((f) => f.kind === 'inbox')
  const userFolders = useMemo(() => folders.filter((f) => f.kind === 'user'), [folders])
  const tree = useMemo(() => {
    // Depth-first so nesting reads correctly in the nav pane.
    const byParent = new Map<number | null, Folder[]>()
    for (const f of userFolders) {
      const k = f.parentId ?? null
      if (!byParent.has(k)) byParent.set(k, [])
      byParent.get(k)!.push(f)
    }
    const out: Array<{ folder: Folder; depth: number }> = []
    const walk = (parent: number | null, depth: number) => {
      for (const f of byParent.get(parent) ?? []) {
        out.push({ folder: f, depth })
        walk(f.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [userFolders])

  const primaryTotals = totals?.byCurrency[0]

  return (
    <div className="app">
      <header className="titlebar">
        <span className="brand">KeepR</span>
        <span className="titlebar-sub">
          {health ? `library ${health.libraryRoot}` : offline ? 'renderer preview — no bridge' : 'connecting'}
        </span>
        <div className="seg" role="tablist" aria-label="View">
          {(['grid', 'thumbnail', 'details'] as ViewMode[]).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              className={view === v ? 'seg-item seg-active' : 'seg-item'}
              onClick={() => setView(v)}
            >
              {v === 'grid' ? 'Grid' : v === 'thumbnail' ? 'Thumbnail' : 'Details'}
            </button>
          ))}
        </div>
      </header>

      <div className="body">
        {/* Lane E fills this pane. */}
        <nav className="nav" aria-label="Library">
          <button
            className={smartFilter === 'inbox' ? 'nav-row nav-selected' : 'nav-row'}
            onClick={() => { setSmartFilter('inbox'); setSelectedFolder(null) }}
          >
            <span>Inbox</span>
            {inboxCount > 0 && <span className="badge">{inboxCount}</span>}
          </button>

          <div className="nav-head">Cabinet</div>
          {tree.length === 0 && <div className="nav-empty">No folders yet</div>}
          {tree.map(({ folder, depth }) => (
            <button
              key={folder.id}
              className={selectedFolder === folder.id ? 'nav-row nav-selected' : 'nav-row'}
              style={{ paddingLeft: `calc(var(--sp-4) + ${depth * 12}px)` }}
              onClick={() => { setSelectedFolder(folder.id); setSmartFilter('all') }}
            >
              {folder.name}
            </button>
          ))}

          <div className="nav-head">Smart Filters</div>
          {([['all', 'View All'], ['recent', 'Recently Added'], ['unreviewed', 'Unreviewed']] as const).map(
            ([key, label]) => (
              <button
                key={key}
                className={smartFilter === key && selectedFolder == null ? 'nav-row nav-selected' : 'nav-row'}
                onClick={() => { setSmartFilter(key); setSelectedFolder(null) }}
              >
                {label}
              </button>
            ),
          )}

          <div className="nav-spacer" />
          <button
            className={smartFilter === 'trash' ? 'nav-row nav-selected' : 'nav-row'}
            onClick={() => { setSmartFilter('trash'); setSelectedFolder(null) }}
          >
            Trash
          </button>
        </nav>

        {/* Lane F fills this pane. */}
        <main className="content">
          {error && <div className="banner banner-danger">{error}</div>}
          {offline && (
            <div className="banner banner-warn">
              Renderer preview: no preload bridge, so no library is attached.
            </div>
          )}
          <div className="grid">
            <div className="grid-head">
              <span className="c-num">#</span>
              <span className="c-date">Date</span>
              <span className="c-vendor">Vendor</span>
              <span className="c-cat">Category</span>
              <span className="c-pay">Payment</span>
              <span className="c-tax num">Tax</span>
              <span className="c-total num">Total</span>
            </div>
            <div className="grid-body">
              {rows.length === 0 && (
                <div className="grid-empty">
                  <p>No items in this view.</p>
                  <p className="muted">
                    Import arrives with Lane C. The library, schema and totals path are live.
                  </p>
                </div>
              )}
              {rows.map((r, i) => (
                <div
                  key={r.itemId}
                  className={selectedItem === r.itemId ? 'row row-selected' : 'row'}
                  onClick={() => setSelectedItem(r.itemId)}
                >
                  <span className="c-num muted">{i + 1}</span>
                  <span className="c-date">{r.txnDate ?? '—'}</span>
                  <span className="c-vendor">
                    {r.vendorName ?? <span className="warn-mark">missing</span>}
                  </span>
                  <span className="c-cat">{r.categoryName ?? '—'}</span>
                  <span className="c-pay">{r.paymentTypeName ?? '—'}</span>
                  <span className="c-tax num">{fmtMoney(r.taxTotalMinor, r.currency)}</span>
                  <span className="c-total num">{fmtMoney(r.totalMinor, r.currency)}</span>
                </div>
              ))}
            </div>
          </div>
        </main>

        {/* Lane G fills this pane. */}
        <aside className="inspector" aria-label="Item details">
          <div className="pane-head">Receipt Details</div>
          {selectedItem == null ? (
            <div className="inspector-empty muted">Select an item</div>
          ) : (
            <div className="inspector-body muted">Details pane arrives with Lane G.</div>
          )}
        </aside>
      </div>

      <footer className="statusbar">
        <span>
          {rows.length} item{rows.length === 1 ? '' : 's'}
          {selectedFolder != null && folders.find((f) => f.id === selectedFolder)
            ? ` · ${folders.find((f) => f.id === selectedFolder)!.name}`
            : ''}
        </span>
        <span className="status-right">
          {/*
            Totals are rendered per-currency. There is deliberately no single
            blended figure: summing USD and EUR into one number would be a lie
            with a currency symbol in front of it.
          */}
          {totals && totals.byCurrency.length > 1 ? (
            totals.byCurrency.map((c) => (
              <span key={c.currency} className="stat">
                {c.currency} <strong className="num">{fmtMoney(c.totalMinor, c.currency)}</strong>
              </span>
            ))
          ) : (
            <>
              <span className="stat">
                Sum <strong className="num">{fmtMoney(primaryTotals?.totalMinor ?? 0, primaryTotals?.currency)}</strong>
              </span>
              <span className="stat">
                Tax <strong className="num">{fmtMoney(primaryTotals?.taxMinor ?? 0, primaryTotals?.currency)}</strong>
              </span>
            </>
          )}
          {totals && totals.unreviewedCount > 0 && (
            /* text-secondary, not warn: a queue depth is not a problem. */
            <span className="stat stat-quiet">{totals.unreviewedCount} unreviewed</span>
          )}
          {health && <span className="stat stat-quiet">schema v{health.schemaVersion}</span>}
        </span>
      </footer>
    </div>
  )
}
