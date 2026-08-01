/**
 * Navigation panel — pure presentation over props.
 *
 * No IPC, no imports from src/main. All tree math lives in tree.ts so it can
 * be tested without a DOM library or Electron.
 */
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import type { Folder } from '../../shared/types.ts'
import type { ListRequest } from '../../shared/ipc.ts'
import { shouldShowInboxBadge } from './badge.ts'
import { canDrop, flattenFolders } from './tree.ts'
import './nav.css'

export interface NavPanelProps {
  folders: Folder[]
  inboxCount: number
  selectedFolderId: number | null
  /** Derived from the contract so adding a filter cannot leave the nav behind. */
  smartFilter: NonNullable<ListRequest['smartFilter']>
  /**
   * Count for the Needs Review row. Rendered as a warn-coloured badge because
   * unlike the Inbox count this is not queue depth — it is work the app believes
   * it may have gotten wrong.
   */
  needsReviewCount?: number
  onSelectFolder(id: number | null): void
  onSelectSmartFilter(f: NavPanelProps['smartFilter']): void
  onCreateFolder(parentId: number | null, name: string): Promise<void>
  onRenameFolder(id: number, name: string): Promise<void>
  onMoveFolder(id: number, newParentId: number | null): Promise<void>
  onDropItems(itemIds: number[], folderId: number): Promise<void>
  collapsed: Set<number>
  onCollapsedChange(next: Set<number>): void
}

const SMART_FILTERS: Array<{
  key: Exclude<NavPanelProps['smartFilter'], 'inbox' | 'trash' | 'needsReview'>
  label: string
}> = [
  { key: 'all', label: 'View All' },
  { key: 'recent', label: 'Recently Added' },
  { key: 'unreviewed', label: 'Unreviewed' },
]

const DND_FOLDER = 'application/x-keepr-folder'
const DND_ITEMS = 'application/x-keepr-items'

type FocusTarget =
  | { kind: 'inbox' }
  | { kind: 'folder'; id: number }
  | { kind: 'smart'; filter: 'all' | 'recent' | 'unreviewed' | 'needsReview' }
  | { kind: 'trash' }

function rowId(target: FocusTarget): string {
  switch (target.kind) {
    case 'inbox':
      return 'nav-inbox'
    case 'folder':
      return `nav-folder-${target.id}`
    case 'smart':
      return `nav-smart-${target.filter}`
    case 'trash':
      return 'nav-trash'
  }
}

export function NavPanel(props: NavPanelProps) {
  const {
    folders,
    inboxCount,
    selectedFolderId,
    smartFilter,
    needsReviewCount,
    onSelectFolder,
    onSelectSmartFilter,
    onCreateFolder,
    onRenameFolder,
    onMoveFolder,
    onDropItems,
    collapsed,
    onCollapsedChange,
  } = props

  const inbox = useMemo(() => folders.find((f) => f.kind === 'inbox') ?? null, [folders])
  const trash = useMemo(() => folders.find((f) => f.kind === 'trash') ?? null, [folders])
  const flat = useMemo(() => flattenFolders(folders, collapsed), [folders, collapsed])

  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [dropOverId, setDropOverId] = useState<number | null>(null)
  const [creatingParent, setCreatingParent] = useState<number | null | 'root'>(null)
  const [createValue, setCreateValue] = useState('New Folder')
  const rootRef = useRef<HTMLDivElement>(null)

  const focusOrder = useMemo((): FocusTarget[] => {
    const order: FocusTarget[] = [{ kind: 'inbox' }]
    for (const row of flat) order.push({ kind: 'folder', id: row.folder.id })
    // Needs Review is first in traversal order as well as first visually: it is
    // where a keyboard user most often wants to land.
    order.push({ kind: 'smart', filter: 'needsReview' })
    for (const s of SMART_FILTERS) order.push({ kind: 'smart', filter: s.key })
    order.push({ kind: 'trash' })
    return order
  }, [flat])

  const toggleCollapsed = useCallback(
    (id: number) => {
      const next = new Set(collapsed)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      onCollapsedChange(next)
    },
    [collapsed, onCollapsedChange],
  )

  const expand = useCallback(
    (id: number) => {
      if (!collapsed.has(id)) return
      const next = new Set(collapsed)
      next.delete(id)
      onCollapsedChange(next)
    },
    [collapsed, onCollapsedChange],
  )

  const collapse = useCallback(
    (id: number) => {
      if (collapsed.has(id)) return
      const next = new Set(collapsed)
      next.add(id)
      onCollapsedChange(next)
    },
    [collapsed, onCollapsedChange],
  )

  const selectInbox = useCallback(() => {
    onSelectSmartFilter('inbox')
    onSelectFolder(null)
  }, [onSelectFolder, onSelectSmartFilter])

  const selectTrash = useCallback(() => {
    onSelectSmartFilter('trash')
    onSelectFolder(null)
  }, [onSelectFolder, onSelectSmartFilter])

  const selectFolder = useCallback(
    (id: number) => {
      onSelectFolder(id)
      onSelectSmartFilter('all')
    },
    [onSelectFolder, onSelectSmartFilter],
  )

  const selectSmart = useCallback(
    // Typed from the contract rather than repeating the union, which is how the
    // nav fell a filter behind in the first place.
    (f: Exclude<NonNullable<ListRequest['smartFilter']>, 'inbox' | 'trash'>) => {
      onSelectSmartFilter(f)
      onSelectFolder(null)
    },
    [onSelectFolder, onSelectSmartFilter],
  )

  const beginRename = useCallback((folder: Folder) => {
    setRenamingId(folder.id)
    setRenameValue(folder.name)
  }, [])

  const commitRename = useCallback(async () => {
    if (renamingId == null) return
    const name = renameValue.trim()
    const id = renamingId
    setRenamingId(null)
    if (!name) return
    const current = folders.find((f) => f.id === id)
    if (current && current.name === name) return
    await onRenameFolder(id, name)
  }, [renamingId, renameValue, folders, onRenameFolder])

  const cancelRename = useCallback(() => {
    setRenamingId(null)
  }, [])

  const beginCreate = useCallback((parentId: number | null) => {
    setCreatingParent(parentId === null ? 'root' : parentId)
    setCreateValue('New Folder')
  }, [])

  const commitCreate = useCallback(async () => {
    if (creatingParent === null) return
    const parentId = creatingParent === 'root' ? null : creatingParent
    const name = createValue.trim() || 'New Folder'
    setCreatingParent(null)
    if (parentId != null) expand(parentId)
    await onCreateFolder(parentId, name)
  }, [creatingParent, createValue, onCreateFolder, expand])

  const cancelCreate = useCallback(() => {
    setCreatingParent(null)
  }, [])

  const parseItems = (dt: DataTransfer): number[] | null => {
    const raw = dt.getData(DND_ITEMS) || dt.getData('application/json')
    if (!raw) return null
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'number')) {
        return parsed as number[]
      }
      if (
        parsed &&
        typeof parsed === 'object' &&
        'itemIds' in parsed &&
        Array.isArray((parsed as { itemIds: unknown }).itemIds)
      ) {
        const ids = (parsed as { itemIds: unknown[] }).itemIds
        if (ids.every((x) => typeof x === 'number')) return ids as number[]
      }
    } catch {
      /* ignore */
    }
    return null
  }

  const onFolderDragStart = (e: DragEvent, folderId: number) => {
    e.dataTransfer.setData(DND_FOLDER, String(folderId))
    e.dataTransfer.effectAllowed = 'move'
  }

  const onFolderDragOver = (e: DragEvent, targetId: number) => {
    const hasFolder = e.dataTransfer.types.includes(DND_FOLDER)
    const hasItems =
      e.dataTransfer.types.includes(DND_ITEMS) || e.dataTransfer.types.includes('application/json')
    if (!hasFolder && !hasItems) return

    if (hasFolder) {
      const raw = e.dataTransfer.getData(DND_FOLDER)
      // getData is empty during dragover in some browsers; allow and validate on drop.
      if (raw) {
        const folderId = Number(raw)
        if (!Number.isFinite(folderId) || !canDrop(folderId, targetId, folders)) {
          e.dataTransfer.dropEffect = 'none'
          return
        }
      }
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = hasFolder ? 'move' : 'copy'
    setDropOverId(targetId)
  }

  const onFolderDragLeave = (e: DragEvent, targetId: number) => {
    if (dropOverId === targetId) setDropOverId(null)
    void e
  }

  const onFolderDrop = async (e: DragEvent, targetId: number) => {
    e.preventDefault()
    setDropOverId(null)
    const folderRaw = e.dataTransfer.getData(DND_FOLDER)
    if (folderRaw) {
      const folderId = Number(folderRaw)
      if (Number.isFinite(folderId) && canDrop(folderId, targetId, folders)) {
        await onMoveFolder(folderId, targetId)
      }
      return
    }
    const items = parseItems(e.dataTransfer)
    if (items && items.length > 0) {
      await onDropItems(items, targetId)
    }
  }

  const focusByIndex = (index: number) => {
    const target = focusOrder[index]
    if (!target) return
    const el = rootRef.current?.querySelector<HTMLElement>(`#${rowId(target)}`)
    el?.focus()
  }

  const currentFocusIndex = (): number => {
    const active = document.activeElement
    if (!active || !rootRef.current?.contains(active)) return -1
    const id = active.id
    return focusOrder.findIndex((t) => rowId(t) === id)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (renamingId != null || creatingParent !== null) return

    const idx = currentFocusIndex()
    if (idx < 0 && !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = idx < 0 ? 0 : Math.min(idx + 1, focusOrder.length - 1)
      focusByIndex(next)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = idx < 0 ? 0 : Math.max(idx - 1, 0)
      focusByIndex(next)
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      focusByIndex(0)
      return
    }
    if (e.key === 'End') {
      e.preventDefault()
      focusByIndex(focusOrder.length - 1)
      return
    }

    const target = focusOrder[idx]
    if (!target) return

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (target.kind === 'inbox') selectInbox()
      else if (target.kind === 'trash') selectTrash()
      else if (target.kind === 'folder') selectFolder(target.id)
      else selectSmart(target.filter)
      return
    }

    if (target.kind === 'folder') {
      const row = flat.find((r) => r.folder.id === target.id)
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (row?.hasChildren && collapsed.has(target.id)) expand(target.id)
        else if (row?.hasChildren) {
          // move to first child if expanded
          const next = focusOrder[idx + 1]
          if (next?.kind === 'folder') focusByIndex(idx + 1)
        }
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (row?.hasChildren && !collapsed.has(target.id)) collapse(target.id)
        else {
          // move to parent if any
          const folder = folders.find((f) => f.id === target.id)
          if (folder?.parentId != null) {
            const pIdx = focusOrder.findIndex((t) => t.kind === 'folder' && t.id === folder.parentId)
            if (pIdx >= 0) focusByIndex(pIdx)
          }
        }
        return
      }
      if (e.key === 'F2') {
        e.preventDefault()
        const folder = folders.find((f) => f.id === target.id)
        if (folder && folder.kind === 'user') beginRename(folder)
      }
    }
  }

  const showBadge = shouldShowInboxBadge(inboxCount)
  const inboxSelected = smartFilter === 'inbox'
  const trashSelected = smartFilter === 'trash'

  const indentStyle = (depth: number): CSSProperties => ({
    paddingLeft: `calc(var(--sp-4) + ${depth * 12}px)`,
  })

  const onChevronClick = (e: MouseEvent, id: number) => {
    e.stopPropagation()
    toggleCollapsed(id)
  }

  return (
    <div
      ref={rootRef}
      className="nav-panel"
      role="tree"
      aria-label="Library"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      {/* ---- Inbox ------------------------------------------------------- */}
      <button
        type="button"
        id={rowId({ kind: 'inbox' })}
        role="treeitem"
        className={inboxSelected ? 'nav-panel-row nav-panel-selected' : 'nav-panel-row'}
        aria-selected={inboxSelected}
        onClick={selectInbox}
        onDragOver={(e) => {
          if (inbox) onFolderDragOver(e, inbox.id)
        }}
        onDragLeave={(e) => {
          if (inbox) onFolderDragLeave(e, inbox.id)
        }}
        onDrop={(e) => {
          if (inbox) void onFolderDrop(e, inbox.id)
        }}
      >
        <span className="nav-panel-chevron-spacer" aria-hidden />
        <span className="nav-panel-label">Inbox</span>
        {showBadge && (
          <span className="nav-panel-badge" aria-label={`${inboxCount} unreviewed`}>
            {inboxCount}
          </span>
        )}
      </button>

      {/* ---- Cabinet tree ------------------------------------------------ */}
      <div className="nav-panel-head">Cabinet</div>
      {flat.length === 0 && creatingParent === null && (
        <div className="nav-panel-empty">No folders yet</div>
      )}

      {flat.map(({ folder, depth, hasChildren }) => {
        const selected = selectedFolderId === folder.id
        const isCollapsed = collapsed.has(folder.id)
        const isRenaming = renamingId === folder.id
        const isDrop = dropOverId === folder.id

        return (
          <div key={folder.id} role="group">
            <button
              type="button"
              id={rowId({ kind: 'folder', id: folder.id })}
              role="treeitem"
              aria-selected={selected}
              aria-expanded={hasChildren ? !isCollapsed : undefined}
              draggable={!isRenaming}
              className={[
                'nav-panel-row',
                selected ? 'nav-panel-selected' : '',
                isDrop ? 'nav-panel-drop-over' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={indentStyle(depth)}
              onClick={() => selectFolder(folder.id)}
              onDoubleClick={() => beginRename(folder)}
              onDragStart={(e) => onFolderDragStart(e, folder.id)}
              onDragOver={(e) => onFolderDragOver(e, folder.id)}
              onDragLeave={(e) => onFolderDragLeave(e, folder.id)}
              onDrop={(e) => void onFolderDrop(e, folder.id)}
            >
              {hasChildren ? (
                <span
                  className="nav-panel-chevron"
                  role="button"
                  tabIndex={-1}
                  aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                  onClick={(e) => onChevronClick(e, folder.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      e.stopPropagation()
                      toggleCollapsed(folder.id)
                    }
                  }}
                >
                  {isCollapsed ? '\u25B8' : '\u25BE'}
                </span>
              ) : (
                <span className="nav-panel-chevron-spacer" aria-hidden />
              )}

              {isRenaming ? (
                <input
                  className="nav-panel-rename"
                  value={renameValue}
                  autoFocus
                  aria-label="Rename folder"
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => void commitRename()}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void commitRename()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      cancelRename()
                    }
                  }}
                />
              ) : (
                <span className="nav-panel-label">{folder.name}</span>
              )}

              {!isRenaming && (
                <span className="nav-panel-actions">
                  <span
                    className="nav-panel-action"
                    role="button"
                    tabIndex={-1}
                    title="New subfolder"
                    aria-label="New subfolder"
                    onClick={(e) => {
                      e.stopPropagation()
                      beginCreate(folder.id)
                    }}
                  >
                    +
                  </span>
                </span>
              )}
            </button>

            {creatingParent === folder.id && (
              <div className="nav-panel-row" style={indentStyle(depth + 1)}>
                <span className="nav-panel-chevron-spacer" aria-hidden />
                <input
                  className="nav-panel-rename"
                  value={createValue}
                  autoFocus
                  aria-label="New folder name"
                  onChange={(e) => setCreateValue(e.target.value)}
                  onBlur={() => void commitCreate()}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void commitCreate()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      cancelCreate()
                    }
                  }}
                />
              </div>
            )}
          </div>
        )
      })}

      {creatingParent === 'root' && (
        <div className="nav-panel-row" style={indentStyle(0)}>
          <span className="nav-panel-chevron-spacer" aria-hidden />
          <input
            className="nav-panel-rename"
            value={createValue}
            autoFocus
            aria-label="New folder name"
            onChange={(e) => setCreateValue(e.target.value)}
            onBlur={() => void commitCreate()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                void commitCreate()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancelCreate()
              }
            }}
          />
        </div>
      )}

      {flat.length > 0 && (
        <button
          type="button"
          className="nav-panel-row"
          style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}
          onClick={() => beginCreate(null)}
        >
          <span className="nav-panel-chevron-spacer" aria-hidden />
          <span className="nav-panel-label">New folder</span>
        </button>
      )}
      {flat.length === 0 && creatingParent === null && (
        <button type="button" className="nav-panel-row" onClick={() => beginCreate(null)}>
          <span className="nav-panel-chevron-spacer" aria-hidden />
          <span className="nav-panel-label">New folder</span>
        </button>
      )}

      {/* ---- Needs Review ------------------------------------------------
          Sits ABOVE the ordinary smart filters and carries a warn-coloured count,
          because it is not a view of the library — it is a list of things the app
          suspects it got wrong. If nothing needs review the row still renders, so
          its absence never has to be interpreted. */}
      <div className="nav-panel-head">Review</div>
      <button
        type="button"
        id={rowId({ kind: 'smart', filter: 'needsReview' })}
        role="treeitem"
        aria-selected={smartFilter === 'needsReview' && selectedFolderId == null}
        className={
          smartFilter === 'needsReview' && selectedFolderId == null
            ? 'nav-panel-row nav-panel-selected'
            : 'nav-panel-row'
        }
        onClick={() => selectSmart('needsReview')}
        title="Items with failed or unreadable OCR, missing key data, or low-confidence fields"
      >
        <span className="nav-panel-chevron-spacer" aria-hidden />
        <span className="nav-panel-label">Needs Review</span>
        {(needsReviewCount ?? 0) > 0 && (
          <span className="nav-panel-badge nav-panel-badge-warn">{needsReviewCount}</span>
        )}
        {(needsReviewCount ?? 0) === 0 && <span className="nav-panel-badge-clear">clear</span>}
      </button>

      {/* ---- Smart filters ----------------------------------------------- */}
      <div className="nav-panel-head">Smart Filters</div>
      {SMART_FILTERS.map(({ key, label }) => {
        const selected = smartFilter === key && selectedFolderId == null
        return (
          <button
            key={key}
            type="button"
            id={rowId({ kind: 'smart', filter: key })}
            role="treeitem"
            aria-selected={selected}
            className={selected ? 'nav-panel-row nav-panel-selected' : 'nav-panel-row'}
            onClick={() => selectSmart(key)}
          >
            <span className="nav-panel-chevron-spacer" aria-hidden />
            <span className="nav-panel-label">{label}</span>
          </button>
        )
      })}

      {/* ---- Trash (pinned bottom) --------------------------------------- */}
      <div className="nav-panel-spacer" />
      <div className="nav-panel-trash-sep">
        <button
          type="button"
          id={rowId({ kind: 'trash' })}
          role="treeitem"
          aria-selected={trashSelected}
          className={trashSelected ? 'nav-panel-row nav-panel-selected' : 'nav-panel-row'}
          onClick={selectTrash}
          onDragOver={(e) => {
            if (trash) onFolderDragOver(e, trash.id)
          }}
          onDragLeave={(e) => {
            if (trash) onFolderDragLeave(e, trash.id)
          }}
          onDrop={(e) => {
            if (trash) void onFolderDrop(e, trash.id)
          }}
        >
          <span className="nav-panel-chevron-spacer" aria-hidden />
          <span className="nav-panel-label">Trash</span>
        </button>
      </div>
    </div>
  )
}
