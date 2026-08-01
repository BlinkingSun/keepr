/**
 * GridPanel — Lane F centre pane.
 * Pure presentation over props. No IPC, no src/main imports.
 * Virtualized: only the visible window + overscan is mounted.
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
import type { GridRow, ItemPatch } from '../../shared/ipc.ts'
import {
  DEFAULT_COLUMNS,
  renameColumn,
  reorderColumns,
  resizeColumn,
  setColumnVisible,
  visibleColumns,
} from './columns.ts'
import {
  cellDisplayValue,
  cellEditValue,
  confidenceLabel,
  isLowConfidenceField,
  isMissingField,
  isMoneyColumn,
} from './cellValue.ts'
import { navigateFocus, nextUnreviewedIndex, type FocusPos, type NavAction } from './keyboard.ts'
import { formatMoney } from './money.ts'
import { applyClick, selectAll, selectRange } from './selection.ts'
import { cycleSort } from './sort.ts'
import {
  EDITABLE_FIELDS,
  patchKeyForColumn,
  type ColumnState,
  type GridPanelProps,
} from './types.ts'
import { computeWindow } from './windowing.ts'
import './grid.css'

export type { GridPanelProps, ColumnState }
export { DEFAULT_COLUMNS }

const OVERSCAN = 8

export function GridPanel(props: GridPanelProps): ReactNode {
  const {
    rows,
    totals,
    loading,
    selectedIds,
    onSelectionChange,
    onOpenItem,
    onPatch,
    sort,
    onSortChange,
    columns,
    onColumnsChange,
    density,
  } = props

  const rowHeight = density === 'comfortable' ? 36 : 28
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(400)
  const [focus, setFocus] = useState<FocusPos>({ row: 0, col: 0 })
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null)
  /**
   * Editing is keyed by itemId, NOT by row index.
   *
   * The index alone is a correctness bug: a background refresh (OCR finishing, an
   * import landing, a re-sort) reorders `rows` while the editor is open, and
   * committing by index then writes the draft onto whichever item now occupies
   * that position. That silently puts a value on the wrong receipt, which is the
   * worst failure this application can have. The index is kept only for focus and
   * is re-derived from itemId before any write.
   */
  const [editing, setEditing] = useState<
    { itemId: number; row: number; col: number; draft: string } | null
  >(null)
  const [cellErrors, setCellErrors] = useState<Record<string, string>>({})
  const [colMenuOpen, setColMenuOpen] = useState(false)
  const dragCol = useRef<{ key: string; fromOrder: number } | null>(null)
  const resizeRef = useRef<{ key: string; startX: number; startW: number } | null>(null)
  const editorRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const visCols = useMemo(() => visibleColumns(columns), [columns])
  const orderedIds = useMemo(() => rows.map((r) => r.itemId), [rows])

  // Measure scroll container.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setViewportHeight(entry.contentRect.height)
    })
    ro.observe(el)
    setViewportHeight(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  const win = useMemo(
    () =>
      computeWindow({
        scrollTop,
        viewportHeight,
        rowHeight,
        rowCount: rows.length,
        overscan: OVERSCAN,
      }),
    [scrollTop, viewportHeight, rowHeight, rows.length],
  )

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (el) setScrollTop(el.scrollTop)
  }, [])

  // Keep focused row in view.
  const ensureVisible = useCallback(
    (rowIdx: number) => {
      const el = scrollRef.current
      if (!el) return
      const top = rowIdx * rowHeight
      const bottom = top + rowHeight
      if (top < el.scrollTop) el.scrollTop = top
      else if (bottom > el.scrollTop + el.clientHeight) {
        el.scrollTop = bottom - el.clientHeight
      }
    },
    [rowHeight],
  )

  const beginEdit = useCallback(
    (rowIdx: number, colIdx: number) => {
      const row = rows[rowIdx]
      const col = visCols[colIdx]
      if (!row || !col || !EDITABLE_FIELDS.has(col.key)) return
      setEditing({
        itemId: row.itemId,
        row: rowIdx,
        col: colIdx,
        draft: cellEditValue(row, col.key),
      })
      setCellErrors((prev) => {
        const key = `${row.itemId}:${col.key}`
        if (!(key in prev)) return prev
        const next = { ...prev }
        delete next[key]
        return next
      })
    },
    [rows, visCols],
  )

  const commitEdit = useCallback(
    async (move: 'down' | 'right' | 'none') => {
      if (!editing) return
      // Re-derive position from itemId: the list may have reordered underneath us.
      const rowIdx = rows.findIndex((r) => r.itemId === editing.itemId)
      const row = rowIdx >= 0 ? rows[rowIdx] : undefined
      const col = visCols[editing.col]
      if (!row || !col) {
        // The item being edited is no longer in the list. Discard rather than
        // write the draft somewhere it does not belong.
        setEditing(null)
        return
      }
      const patchKey = patchKeyForColumn(col.key)
      if (!patchKey) {
        setEditing(null)
        return
      }

      const draft = editing.draft
      const patch: ItemPatch = {}
      if (patchKey === 'totalText' || patchKey === 'taxTotalText') {
        patch[patchKey] = draft.trim() === '' ? null : draft.trim()
      } else if (patchKey === 'txnDate') {
        patch.txnDate = draft.trim() === '' ? null : draft.trim()
      } else if (patchKey === 'vendorName') {
        patch.vendorName = draft.trim() === '' ? null : draft.trim()
      } else if (patchKey === 'categoryName') {
        patch.categoryName = draft.trim() === '' ? null : draft.trim()
      } else if (patchKey === 'paymentTypeName') {
        patch.paymentTypeName = draft.trim() === '' ? null : draft.trim()
      }

      const result = await onPatch(row.itemId, patch)
      if (!result.ok) {
        const errKey = Object.keys(result.errors)[0]
        const msg = errKey ? result.errors[errKey] : 'Invalid value'
        setCellErrors((prev) => ({
          ...prev,
          [`${row.itemId}:${col.key}`]: msg ?? 'Invalid value',
        }))
        // Stay in edit mode so the user can fix.
        return
      }

      setEditing(null)
      setCellErrors((prev) => {
        const key = `${row.itemId}:${col.key}`
        if (!(key in prev)) return prev
        const next = { ...prev }
        delete next[key]
        return next
      })

      if (move === 'down' || move === 'right') {
        const next = navigateFocus(
          { row: rowIdx, col: editing.col },
          move === 'down' ? 'Enter' : 'Tab',
          { rowCount: rows.length, colCount: visCols.length },
        )
        setFocus(next)
        ensureVisible(next.row)
      }
    },
    [editing, rows, visCols, onPatch, ensureVisible],
  )

  const cancelEdit = useCallback(() => {
    setEditing(null)
  }, [])

  useEffect(() => {
    if (editing && editorRef.current) {
      editorRef.current.focus()
      editorRef.current.select()
    }
  }, [editing])

  const handleRowClick = useCallback(
    (e: ReactMouseEvent, rowIdx: number) => {
      if (editing) return
      const result = applyClick(orderedIds, selectedIds, rowIdx, {
        shift: e.shiftKey,
        meta: e.metaKey || e.ctrlKey,
        anchorIndex,
      })
      onSelectionChange(result.selected)
      setAnchorIndex(result.anchorIndex)
      setFocus((f) => ({ row: rowIdx, col: f.col }))
    },
    [orderedIds, selectedIds, anchorIndex, onSelectionChange, editing],
  )

  const handleRowDoubleClick = useCallback(
    (rowIdx: number, colIdx: number) => {
      const row = rows[rowIdx]
      if (row) onOpenItem(row.itemId)
      beginEdit(rowIdx, colIdx)
    },
    [rows, onOpenItem, beginEdit],
  )

  const handleHeaderClick = useCallback(
    (e: ReactMouseEvent, colKey: string) => {
      if (colKey === 'rowNum') return
      onSortChange(cycleSort(sort, colKey, e.shiftKey))
    },
    [sort, onSortChange],
  )

  // Column resize pointer handlers.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const r = resizeRef.current
      if (!r) return
      const delta = e.clientX - r.startX
      onColumnsChange(resizeColumn(columns, r.key, r.startW + delta))
    }
    const onUp = () => {
      resizeRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [columns, onColumnsChange])

  const startResize = (e: ReactMouseEvent, key: string, width: number) => {
    e.preventDefault()
    e.stopPropagation()
    resizeRef.current = { key, startX: e.clientX, startW: width }
  }

  const onDragStart = (e: React.DragEvent, key: string, order: number) => {
    dragCol.current = { key, fromOrder: order }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', key)
  }

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const onDrop = (e: React.DragEvent, toOrder: number) => {
    e.preventDefault()
    const d = dragCol.current
    if (!d) return
    onColumnsChange(reorderColumns(columns, d.fromOrder, toOrder))
    dragCol.current = null
  }

  const markReviewedAndNext = useCallback(async () => {
    const row = rows[focus.row]
    if (!row) return
    if (!row.reviewed) {
      await onPatch(row.itemId, { reviewed: true })
    }
    const flags = rows.map((r, i) => (i === focus.row ? true : r.reviewed))
    const next = nextUnreviewedIndex(flags, focus.row)
    if (next != null) {
      setFocus((f) => ({ row: next, col: f.col }))
      onSelectionChange(new Set([rows[next]!.itemId]))
      setAnchorIndex(next)
      ensureVisible(next)
    }
  }, [rows, focus.row, onPatch, onSelectionChange, ensureVisible])

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (editing) {
        if (e.key === 'Enter') {
          e.preventDefault()
          void commitEdit('down')
        } else if (e.key === 'Tab') {
          e.preventDefault()
          void commitEdit(e.shiftKey ? 'none' : 'right')
          if (e.shiftKey) {
            const next = navigateFocus(
              { row: editing.row, col: editing.col },
              'ShiftTab',
              { rowCount: rows.length, colCount: visCols.length },
            )
            setFocus(next)
            setEditing(null)
          }
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancelEdit()
        }
        return
      }

      const meta = e.metaKey || e.ctrlKey

      if (meta && e.key === 'a') {
        e.preventDefault()
        onSelectionChange(selectAll(orderedIds))
        return
      }

      if (meta && e.key === 'Enter') {
        e.preventDefault()
        void markReviewedAndNext()
        return
      }

      const keyMap: Record<string, NavAction> = {
        ArrowUp: 'ArrowUp',
        ArrowDown: 'ArrowDown',
        ArrowLeft: 'ArrowLeft',
        ArrowRight: 'ArrowRight',
        Home: 'Home',
        End: 'End',
        PageUp: 'PageUp',
        PageDown: 'PageDown',
        Enter: 'Enter',
        Tab: e.shiftKey ? 'ShiftTab' : 'Tab',
      }

      if (e.key === 'Enter' && !meta) {
        // Open editor on focused cell if editable; else move down after open attempt.
        const col = visCols[focus.col]
        if (col && EDITABLE_FIELDS.has(col.key)) {
          e.preventDefault()
          beginEdit(focus.row, focus.col)
          return
        }
      }

      if (e.key === 'F2') {
        e.preventDefault()
        beginEdit(focus.row, focus.col)
        return
      }

      const action = keyMap[e.key]
      if (!action) return
      if (e.key === 'Tab') {
        // Let focus escape at the edges instead of trapping it. Tab past the last
        // cell of the last row, or Shift-Tab before the first, falls through to the
        // browser so the user reaches the nav pane and inspector. Previously Tab
        // always preventDefault'd, so a keyboard-only user could never leave.
        const atEnd =
          !e.shiftKey && focus.row === rows.length - 1 && focus.col === visCols.length - 1
        const atStart = e.shiftKey && focus.row === 0 && focus.col === 0
        if (atEnd || atStart) return
        e.preventDefault()
      }
      else if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key.startsWith('Page')) {
        e.preventDefault()
      } else if (e.key === 'Enter') {
        e.preventDefault()
      }

      const pageSize = Math.max(1, Math.floor(viewportHeight / rowHeight) - 1)
      const next = navigateFocus(focus, action, {
        rowCount: rows.length,
        colCount: visCols.length,
        pageSize,
      })
      setFocus(next)
      ensureVisible(next.row)

      // Arrow navigation also moves the selection to the focused row (plain).
      if (
        action === 'ArrowUp' ||
        action === 'ArrowDown' ||
        action === 'PageUp' ||
        action === 'PageDown' ||
        action === 'Enter'
      ) {
        const id = orderedIds[next.row]
        if (id !== undefined && !e.shiftKey) {
          onSelectionChange(new Set([id]))
          setAnchorIndex(next.row)
        } else if (id !== undefined && e.shiftKey && anchorIndex != null) {
          onSelectionChange(selectRange(orderedIds, anchorIndex, next.row))
        }
      }
    },
    [
      editing,
      commitEdit,
      cancelEdit,
      orderedIds,
      onSelectionChange,
      markReviewedAndNext,
      visCols,
      focus,
      beginEdit,
      viewportHeight,
      rowHeight,
      rows.length,
      ensureVisible,
      anchorIndex,
    ],
  )

  const primaryTotal = totals?.byCurrency[0]

  const sortIndex = useMemo(() => {
    const map = new Map<string, number>()
    sort.forEach((s, i) => map.set(s.column, i + 1))
    return map
  }, [sort])

  const sortDir = useMemo(() => {
    const map = new Map<string, 'asc' | 'desc'>()
    sort.forEach((s) => map.set(s.column, s.dir))
    return map
  }, [sort])

  return (
    <div
      ref={rootRef}
      className="keepr-grid"
      data-density={density}
      tabIndex={0}
      role="grid"
      aria-rowcount={rows.length}
      aria-colcount={visCols.length}
      onKeyDown={onKeyDown}
    >
      <div className="keepr-grid-toolbar">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={colMenuOpen}
          onClick={() => setColMenuOpen((o) => !o)}
        >
          Columns
        </button>
      </div>

      {colMenuOpen && (
        <div className="keepr-grid-col-menu" role="menu">
          {columns
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((c) => (
              <label key={c.key}>
                <input
                  type="checkbox"
                  checked={c.visible}
                  disabled={c.key === 'rowNum'}
                  onChange={(e) =>
                    onColumnsChange(setColumnVisible(columns, c.key, e.target.checked))
                  }
                />
                <input
                  type="text"
                  value={c.label}
                  aria-label={`Rename ${c.key}`}
                  onChange={(e) =>
                    onColumnsChange(renameColumn(columns, c.key, e.target.value))
                  }
                />
              </label>
            ))}
        </div>
      )}

      <div className="keepr-grid-head" role="row">
        {visCols.map((col) => {
          const dir = sortDir.get(col.key)
          const idx = sortIndex.get(col.key)
          const multi = sort.length > 1
          return (
            <div
              key={col.key}
              className={`keepr-grid-hcell${isMoneyColumn(col.key) ? ' num' : ''}`}
              style={{ width: col.width }}
              role="columnheader"
              data-sorted={dir ? 'true' : 'false'}
              draggable={col.key !== 'rowNum'}
              onClick={(e) => handleHeaderClick(e, col.key)}
              onDragStart={(e) => onDragStart(e, col.key, col.order)}
              onDragOver={onDragOver}
              onDrop={(e) => onDrop(e, col.order)}
            >
              <span>{col.label}</span>
              {dir && (
                <span className="keepr-grid-sort" aria-hidden>
                  {dir === 'asc' ? '▲' : '▼'}
                  {multi && idx != null && (
                    <span className="keepr-grid-sort-idx">{idx}</span>
                  )}
                </span>
              )}
              <span
                className="keepr-grid-resize"
                data-active={resizeRef.current?.key === col.key ? 'true' : 'false'}
                onMouseDown={(e) => startResize(e, col.key, col.width)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )
        })}
      </div>

      <div
        className="keepr-grid-scroll"
        ref={scrollRef}
        onScroll={onScroll}
        role="rowgroup"
      >
        {rows.length === 0 && !loading ? (
          <div className="keepr-grid-empty">
            <h2>No receipts here yet</h2>
            <p>
              Import scans or PDFs into the Inbox, then file them into a folder.
              This grid will list every item in the current filter for review and
              bulk edit.
            </p>
            <p className="keepr-grid-hint">
              Tip: use the Inbox smart filter for new imports that still need a
              date, vendor, or total.
            </p>
          </div>
        ) : (
          <div
            className="keepr-grid-spacer"
            style={{ height: win.totalHeight }}
          >
            <div
              className="keepr-grid-window"
              style={{ transform: `translateY(${win.offsetY}px)` }}
            >
              {rows.slice(win.start, win.end).map((row, i) => {
                const rowIdx = win.start + i
                return (
                  <GridRowView
                    key={row.itemId}
                    row={row}
                    rowIdx={rowIdx}
                    visCols={visCols}
                    selected={selectedIds.has(row.itemId)}
                    focusedRow={focus.row === rowIdx}
                    focusCol={focus.row === rowIdx ? focus.col : -1}
                    editing={
                      editing && editing.itemId === row.itemId
                        ? { col: editing.col, draft: editing.draft }
                        : null
                    }
                    cellErrors={cellErrors}
                    editorRef={editorRef}
                    onRowClick={handleRowClick}
                    onRowDoubleClick={handleRowDoubleClick}
                    onFocusCell={(r, c) => setFocus({ row: r, col: c })}
                    onDraftChange={(draft) =>
                      setEditing((ed) => (ed ? { ...ed, draft } : null))
                    }
                    onEditorKeyDown={(ev) => {
                      if (ev.key === 'Enter') {
                        ev.preventDefault()
                        void commitEdit('down')
                      } else if (ev.key === 'Tab') {
                        ev.preventDefault()
                        void commitEdit(ev.shiftKey ? 'none' : 'right')
                        if (ev.shiftKey) {
                          const next = navigateFocus(
                            { row: editing!.row, col: editing!.col },
                            'ShiftTab',
                            { rowCount: rows.length, colCount: visCols.length },
                          )
                          setFocus(next)
                          setEditing(null)
                        }
                      } else if (ev.key === 'Escape') {
                        ev.preventDefault()
                        cancelEdit()
                      }
                    }}
                  />
                )
              })}
            </div>
          </div>
        )}
      </div>

      {loading && <div className="keepr-grid-loading">Loading…</div>}

      {/* The application status bar lives in App.tsx and already reports item
          count, per-currency totals and the unreviewed count. This panel used to
          render its own footer too, which put two identical status bars on screen,
          one above the other. The pane reports nothing global; the shell does. */}
    </div>
  )
}

/**
 * The row-level flag.
 *
 * Three severities, deliberately different marks rather than three shades of the
 * same one, so the reason is legible at a glance and not just the fact that
 * something is wrong:
 *
 *   !  danger  OCR failed or was unreadable — the data is on the paper and the
 *              machine did not get it, so this needs manual entry from the image.
 *   ?  warn    a key field is empty, or a field was extracted with low
 *              confidence — check it against the image.
 *   (nothing)  the app believes this row is right. An empty cell is the reward,
 *              which is why there is no "ok" tick: a column of ticks trains the
 *              eye to skip the column.
 */
function RowFlag({ row }: { row: GridRow }) {
  if (row.needsManualEntry) {
    const why =
      row.ocrStatus === 'failed'
        ? 'OCR failed on this image — enter the details manually'
        : row.ocrConfidence != null && row.ocrConfidence < 0.3
          ? `Text was unreadable (${Math.round(row.ocrConfidence * 100)}% confidence) — enter the details manually`
          : 'This receipt has an image but no amount was found — enter it manually'
    return <span className="keepr-grid-flag keepr-grid-flag-danger" title={why} aria-label={why}>!</span>
  }
  if (row.missingFields.length > 0 || row.lowConfidenceFields.length > 0) {
    const parts: string[] = []
    if (row.missingFields.length) parts.push(`missing: ${row.missingFields.join(', ')}`)
    if (row.lowConfidenceFields.length) parts.push(`low confidence: ${row.lowConfidenceFields.join(', ')}`)
    const why = parts.join(' · ')
    return <span className="keepr-grid-flag keepr-grid-flag-warn" title={why} aria-label={why}>?</span>
  }
  if (row.ocrStatus === 'pending') {
    return <span className="keepr-grid-flag keepr-grid-flag-quiet" title="OCR still running" aria-label="OCR still running">…</span>
  }
  return null
}

/* ---- row subcomponent ------------------------------------------------- */

interface GridRowViewProps {
  row: GridRow
  rowIdx: number
  visCols: ColumnState[]
  selected: boolean
  focusedRow: boolean
  focusCol: number
  editing: { col: number; draft: string } | null
  cellErrors: Record<string, string>
  editorRef: React.RefObject<HTMLInputElement | null>
  onRowClick(e: ReactMouseEvent, rowIdx: number): void
  onRowDoubleClick(rowIdx: number, colIdx: number): void
  onFocusCell(row: number, col: number): void
  onDraftChange(draft: string): void
  onEditorKeyDown(e: ReactKeyboardEvent<HTMLInputElement>): void
}

function GridRowView(props: GridRowViewProps): ReactNode {
  const {
    row,
    rowIdx,
    visCols,
    selected,
    focusedRow,
    focusCol,
    editing,
    cellErrors,
    editorRef,
    onRowClick,
    onRowDoubleClick,
    onFocusCell,
    onDraftChange,
    onEditorKeyDown,
  } = props

  const hasMissing = row.missingFields.length > 0
  const rowStyle: CSSProperties = { height: 'var(--grid-row-h)' }

  return (
    <div
      className="keepr-grid-row"
      role="row"
      aria-rowindex={rowIdx + 1}
      aria-selected={selected}
      data-selected={selected ? 'true' : 'false'}
      data-unreviewed={row.reviewed ? 'false' : 'true'}
      data-missing={hasMissing ? 'true' : 'false'}
      data-focused-row={focusedRow ? 'true' : 'false'}
      style={rowStyle}
      onClick={(e) => onRowClick(e, rowIdx)}
    >
      {visCols.map((col, colIdx) => {
        const money = isMoneyColumn(col.key)
        const missing = isMissingField(row, col.key)
        const low = isLowConfidenceField(row, col.key)
        const conf = confidenceLabel(row, col.key)
        const err = cellErrors[`${row.itemId}:${col.key}`]
        const isEdit = editing != null && editing.col === colIdx
        const display = cellDisplayValue(row, col.key, rowIdx)
        const empty = display === '' || display === '—'

        return (
          <div
            key={col.key}
            className={`keepr-grid-cell${money ? ' num' : ''}`}
            role="gridcell"
            style={{ width: col.width }}
            data-focused={focusCol === colIdx ? 'true' : 'false'}
            data-missing={missing ? 'true' : 'false'}
            data-selected-row={selected ? 'true' : 'false'}
            onClick={(e) => {
              e.stopPropagation()
              onFocusCell(rowIdx, colIdx)
              onRowClick(e, rowIdx)
            }}
            onDoubleClick={(e) => {
              e.stopPropagation()
              onRowDoubleClick(rowIdx, colIdx)
            }}
          >
            {isEdit ? (
              <input
                ref={editorRef}
                className={`keepr-grid-editor${money ? ' num' : ''}`}
                value={editing.draft}
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={onEditorKeyDown}
                onBlur={() => {
                  /* commit on blur via parent if needed — Escape cancels, Enter commits */
                }}
                aria-label={`Edit ${col.label}`}
              />
            ) : (
              <>
                {col.key === 'flag' && <RowFlag row={row} />}
                {row.isSplitChild && col.key === 'rowNum' && (
                  <span className="keepr-grid-badge keepr-grid-badge-split" title="Split child">
                    split
                  </span>
                )}
                {empty && missing ? (
                  <span className="keepr-grid-missing-mark">missing</span>
                ) : empty && col.key === 'flag' ? (
                  // No em-dash in the flag column. A clean row must read as BLANK:
                  // a column of dashes is visual noise that trains the eye to skip
                  // the very column the flags live in.
                  null
                ) : empty && col.key !== 'rowNum' ? (
                  <span className="keepr-grid-cell-text keepr-grid-muted">—</span>
                ) : (
                  <span className="keepr-grid-cell-text">{display}</span>
                )}
                {low && conf && (
                  <span className="keepr-grid-badge keepr-grid-badge-warn" title="Low OCR confidence">
                    {conf === 'low' ? 'low' : `${conf} match`}
                  </span>
                )}
              </>
            )}
            {err && <span className="keepr-grid-cell-error">{err}</span>}
          </div>
        )
      })}
    </div>
  )
}
