/**
 * ThumbPanel — Lane T centre pane (thumbnail view).
 * Pure presentation over props. No IPC, no fs, no src/main imports.
 * Row-windowed via computeWindow; selection helpers and formatMoney from grid.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import type { GridRow } from '../../shared/ipc.ts'
import { formatMoney } from '../grid/money.ts'
import {
  applyClick,
  selectAll,
  toggleSelection,
} from '../grid/selection.ts'
import { flagKind } from './flagKind.ts'
import { idAtIndex, navigate2d, type Nav2dAction } from './nav2d.ts'
import { needsPlaceholder, placeholderLabel } from './placeholder.ts'
import { itemRangeForRows, MIN_CARD, thumbWindow } from './thumbLayout.ts'
import './thumbs.css'

export interface ThumbPanelProps {
  rows: GridRow[]
  selectedIds: Set<number>
  onSelectionChange(ids: Set<number>): void
  onOpenItem(id: number): void
  /** Resolver injected by the orchestrator; null → placeholder. */
  thumbSrc(row: GridRow): string | null
  loading: boolean
}

export function ThumbPanel(props: ThumbPanelProps): ReactNode {
  const {
    rows,
    selectedIds,
    onSelectionChange,
    onOpenItem,
    thumbSrc,
    loading,
  } = props

  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(400)
  const [contentWidth, setContentWidth] = useState(900)
  const [focusIndex, setFocusIndex] = useState(0)
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null)

  const orderedIds = useMemo(() => rows.map((r) => r.itemId), [rows])

  // Measure scroll container: width (minus padding) + viewport height.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const measure = () => {
      const style = getComputedStyle(el)
      const padX =
        (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
      const padY =
        (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
      setContentWidth(Math.max(0, el.clientWidth - padX))
      setViewportHeight(Math.max(0, el.clientHeight - padY))
    }

    measure()
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const layout = useMemo(
    () =>
      thumbWindow({
        width: contentWidth,
        viewportHeight,
        scrollTop,
        itemCount: rows.length,
      }),
    [contentWidth, viewportHeight, scrollTop, rows.length],
  )

  const { cols, rowHeight, cardHeight, window: win } = layout

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (el) setScrollTop(el.scrollTop)
  }, [])

  const ensureVisible = useCallback(
    (index: number) => {
      const el = scrollRef.current
      if (!el || cols <= 0 || rowHeight <= 0) return
      const row = Math.floor(index / cols)
      const top = row * rowHeight
      const bottom = top + rowHeight
      if (top < el.scrollTop) el.scrollTop = top
      else if (bottom > el.scrollTop + el.clientHeight) {
        el.scrollTop = bottom - el.clientHeight
      }
    },
    [cols, rowHeight],
  )

  // Clamp focus when the list shrinks.
  useEffect(() => {
    if (rows.length === 0) {
      setFocusIndex(0)
      return
    }
    setFocusIndex((i) => Math.max(0, Math.min(rows.length - 1, i)))
  }, [rows.length])

  const handleCardClick = useCallback(
    (e: ReactMouseEvent, index: number) => {
      const result = applyClick(orderedIds, selectedIds, index, {
        shift: e.shiftKey,
        meta: e.metaKey || e.ctrlKey,
        anchorIndex,
      })
      onSelectionChange(result.selected)
      setAnchorIndex(result.anchorIndex)
      setFocusIndex(index)
    },
    [orderedIds, selectedIds, anchorIndex, onSelectionChange],
  )

  const handleCardDoubleClick = useCallback(
    (index: number) => {
      const id = idAtIndex(orderedIds, index)
      if (id != null) onOpenItem(id)
    },
    [orderedIds, onOpenItem],
  )

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (rows.length === 0) return

      const navKeys: Record<string, Nav2dAction> = {
        ArrowLeft: 'ArrowLeft',
        ArrowRight: 'ArrowRight',
        ArrowUp: 'ArrowUp',
        ArrowDown: 'ArrowDown',
        Home: 'Home',
        End: 'End',
      }

      const nav = navKeys[e.key]
      if (nav) {
        e.preventDefault()
        const next = navigate2d(focusIndex, nav, rows.length, cols)
        setFocusIndex(next)
        ensureVisible(next)
        if (e.shiftKey) {
          const anchor = anchorIndex ?? focusIndex
          const result = applyClick(orderedIds, selectedIds, next, {
            shift: true,
            meta: false,
            anchorIndex: anchor,
          })
          onSelectionChange(result.selected)
          setAnchorIndex(result.anchorIndex)
        } else if (!e.metaKey && !e.ctrlKey) {
          // Plain arrow moves focus; also single-select the focused card
          // so keyboard and mouse selection stay consistent with the grid.
          const id = idAtIndex(orderedIds, next)
          if (id != null) {
            onSelectionChange(new Set([id]))
            setAnchorIndex(next)
          }
        }
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        const id = idAtIndex(orderedIds, focusIndex)
        if (id != null) onOpenItem(id)
        return
      }

      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault()
        const id = idAtIndex(orderedIds, focusIndex)
        if (id == null) return
        onSelectionChange(toggleSelection(selectedIds, id))
        setAnchorIndex(focusIndex)
        return
      }

      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        onSelectionChange(selectAll(orderedIds))
      }
    },
    [
      rows.length,
      focusIndex,
      cols,
      ensureVisible,
      anchorIndex,
      orderedIds,
      selectedIds,
      onSelectionChange,
      onOpenItem,
    ],
  )

  const itemRange = itemRangeForRows(win.start, win.end, cols, rows.length)
  const mountedRows: number[] = []
  for (let r = win.start; r < win.end; r++) mountedRows.push(r)

  const gridTemplate = `repeat(${cols}, minmax(0, 1fr))`

  return (
    <div
      className="keepr-thumbs"
      ref={rootRef}
      tabIndex={0}
      role="grid"
      aria-rowcount={layout.rowCount}
      aria-colcount={cols}
      data-min-card={MIN_CARD}
      onKeyDown={handleKeyDown}
    >
      <div
        className="keepr-thumbs-scroll"
        ref={scrollRef}
        onScroll={onScroll}
        role="presentation"
      >
        {rows.length === 0 && !loading ? (
          <div className="keepr-thumbs-empty">
            <h2>No receipts here yet</h2>
            <p>
              Import scans or PDFs into the Inbox, then file them into a folder.
              This view will show a thumbnail for every item in the current
              filter.
            </p>
            <p className="keepr-thumbs-hint">
              Tip: use the Inbox smart filter for new imports that still need a
              date, vendor, or total.
            </p>
          </div>
        ) : (
          <div
            className="keepr-thumbs-spacer"
            style={{ height: layout.totalHeight }}
          >
            <div
              className="keepr-thumbs-window"
              style={{ transform: `translateY(${win.offsetY}px)` }}
            >
              {mountedRows.map((rowIdx) => {
                const rowStyle: CSSProperties = {
                  height: rowHeight,
                  gridTemplateColumns: gridTemplate,
                }
                const cells: ReactNode[] = []
                for (let c = 0; c < cols; c++) {
                  const index = rowIdx * cols + c
                  if (index >= rows.length) break
                  const row = rows[index]
                  if (!row) break
                  cells.push(
                    <ThumbCard
                      key={row.itemId}
                      row={row}
                      index={index}
                      selected={selectedIds.has(row.itemId)}
                      focused={focusIndex === index}
                      cardHeight={cardHeight}
                      src={thumbSrc(row)}
                      onClick={handleCardClick}
                      onDoubleClick={handleCardDoubleClick}
                    />,
                  )
                }
                return (
                  <div
                    key={rowIdx}
                    className="keepr-thumbs-row"
                    role="row"
                    aria-rowindex={rowIdx + 1}
                    style={rowStyle}
                  >
                    {cells}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {loading && <div className="keepr-thumbs-loading">Loading…</div>}

      {/* itemRange kept for future a11y live-region / debug; silence unused. */}
      <span hidden data-mounted-start={itemRange.start} data-mounted-end={itemRange.end} />
    </div>
  )
}

/* ---- card subcomponent ------------------------------------------------ */

interface ThumbCardProps {
  row: GridRow
  index: number
  selected: boolean
  focused: boolean
  cardHeight: number
  src: string | null
  onClick(e: ReactMouseEvent, index: number): void
  onDoubleClick(index: number): void
}

function ThumbCard(props: ThumbCardProps): ReactNode {
  const { row, index, selected, focused, cardHeight, src, onClick, onDoubleClick } =
    props
  const flag = flagKind(row)
  const showPlaceholder = needsPlaceholder(src)
  const vendor = row.vendorName?.trim() ? row.vendorName : '—'
  const total = formatMoney(row.totalMinor, row.currency)
  const date = row.txnDate ?? '—'

  return (
    <div
      className="keepr-thumb-card"
      role="gridcell"
      tabIndex={-1}
      aria-selected={selected}
      aria-label={vendor === '—' ? `Item ${row.itemId}` : vendor}
      data-selected={selected ? 'true' : 'false'}
      data-focused={focused ? 'true' : 'false'}
      data-unreviewed={row.reviewed ? 'false' : 'true'}
      style={{ height: cardHeight, maxHeight: cardHeight }}
      onClick={(e) => onClick(e, index)}
      onDoubleClick={() => onDoubleClick(index)}
    >
      <div className="keepr-thumb-media">
        {showPlaceholder ? (
          <div className="keepr-thumb-placeholder">
            <span className="keepr-thumb-placeholder-label">
              {placeholderLabel(row.type)}
            </span>
          </div>
        ) : (
          <img src={src!} alt="" draggable={false} />
        )}
        {row.isSplitChild && (
          <span className="keepr-thumb-split" title="Split child">
            split
          </span>
        )}
        {flag && (
          <span
            className={`keepr-thumb-flag keepr-thumb-flag-${flag.kind}`}
            title={flag.title}
            aria-label={flag.title}
          >
            {flag.mark}
          </span>
        )}
      </div>
      <div className="keepr-thumb-cap">
        <span
          className="keepr-thumb-vendor"
          data-empty={vendor === '—' ? 'true' : 'false'}
        >
          {vendor}
        </span>
        <span className="keepr-thumb-total num">{total}</span>
        <span className="keepr-thumb-date">{date}</span>
      </div>
    </div>
  )
}
