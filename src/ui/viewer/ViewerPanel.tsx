/**
 * Viewer panel — large page image, filmstrip, extracted-field form, image tools.
 *
 * Pure presentation over ViewerPanelProps. No IPC, no fs, no path joining.
 * pageSrc() is supplied by the orchestrator.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BBox, ResolvedPage, Rotation } from '../../shared/types.ts'
import type { ItemDetail, ItemPatch, PatchResult } from '../../shared/ipc.ts'
import { clampPageIndex } from './navigation.ts'
import { FieldForm } from './FieldForm.tsx'
import { Filmstrip } from './Filmstrip.tsx'
import { ImageToolbar } from './ImageToolbar.tsx'
import { PageCanvas } from './PageCanvas.tsx'
import './viewer.css'

export interface ViewerPanelProps {
  detail: ItemDetail | null
  loading: boolean
  activePageIndex: number
  onActivePageChange(i: number): void
  /** Absolute file URL for a page. The orchestrator resolves it; you never
   *  touch the filesystem or join paths yourself. */
  pageSrc(page: ResolvedPage): string
  onPatch(itemId: number, patch: ItemPatch): Promise<PatchResult>
  onRotate(pageId: number, rotation: Rotation): Promise<void>
  onReorderPages(itemId: number, pageIdsInOrder: number[]): Promise<void>
  onDeletePage(pageId: number): Promise<void>
  /** Region drawn over the image, in STORED-MASTER pixel space. */
  onAssignRegion(pageId: number, field: string, box: BBox): Promise<PatchResult>
  variant: 'inspector' | 'details'
}

export function ViewerPanel(props: ViewerPanelProps) {
  const {
    detail,
    loading,
    activePageIndex,
    onActivePageChange,
    pageSrc,
    onPatch,
    onRotate,
    onReorderPages,
    onDeletePage,
    onAssignRegion,
    variant,
  } = props

  const pages = detail?.pages ?? []
  const safeIndex = clampPageIndex(activePageIndex, pages.length)
  const activePage: ResolvedPage | null = pages[safeIndex] ?? null

  const [zoom, setZoom] = useState(1)
  const [fitMode, setFitMode] = useState(true)
  const [regionMode, setRegionMode] = useState(false)
  const [assignField, setAssignField] = useState<string | null>(null)
  const [masterSize, setMasterSize] = useState<{ w: number; h: number } | null>(null)
  const [pendingBox, setPendingBox] = useState<BBox | null>(null)

  // Reset canvas state when the active page changes.
  useEffect(() => {
    setMasterSize(null)
    setPendingBox(null)
    setFitMode(true)
  }, [activePage?.pageId])

  // Keep parent index in range when page list shrinks.
  useEffect(() => {
    if (detail && activePageIndex !== safeIndex) {
      onActivePageChange(safeIndex)
    }
  }, [detail, activePageIndex, safeIndex, onActivePageChange])

  const src = useMemo(
    () => (activePage ? pageSrc(activePage) : null),
    [activePage, pageSrc],
  )

  const handleZoomChange = useCallback((z: number) => {
    setZoom(z)
  }, [])

  const handleFit = useCallback(() => {
    setFitMode(true)
  }, [])

  const handleZoom100 = useCallback(() => {
    setFitMode(false)
    setZoom(1)
  }, [])

  const handleRegion = useCallback(
    (box: BBox) => {
      if (!activePage) return
      if (assignField) {
        void onAssignRegion(activePage.pageId, assignField, box)
        setAssignField(null)
        setRegionMode(false)
        setPendingBox(null)
      } else {
        // No field pre-selected — hold the box and show assign menu via pending state.
        setPendingBox(box)
      }
    },
    [activePage, assignField, onAssignRegion],
  )

  const assignPending = useCallback(
    (field: string) => {
      if (!activePage || !pendingBox) return
      void onAssignRegion(activePage.pageId, field, pendingBox)
      setPendingBox(null)
      setRegionMode(false)
      setAssignField(null)
    },
    [activePage, pendingBox, onAssignRegion],
  )

  const handleReorder = useCallback(
    (pageIdsInOrder: number[]) => {
      if (!detail) return
      void onReorderPages(detail.item.id, pageIdsInOrder)
    },
    [detail, onReorderPages],
  )

  const goPrev = useCallback(() => {
    onActivePageChange(clampPageIndex(safeIndex - 1, pages.length))
  }, [onActivePageChange, safeIndex, pages.length])

  const goNext = useCallback(() => {
    onActivePageChange(clampPageIndex(safeIndex + 1, pages.length))
  }, [onActivePageChange, safeIndex, pages.length])

  if (loading) {
    return (
      <div className={`viewer viewer--${variant}`}>
        <div className="viewer-loading">Loading…</div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className={`viewer viewer--${variant}`}>
        <div className="viewer-empty">Select a receipt to inspect</div>
      </div>
    )
  }

  const showImage = variant === 'details'

  return (
    <div className={`viewer viewer--${variant}`}>
      {showImage && (
        <div className="viewer__main">
          <ImageToolbar
            page={activePage}
            pageCount={pages.length}
            activePageIndex={safeIndex}
            zoom={zoom}
            fitMode={fitMode}
            regionMode={regionMode || assignField != null}
            onFit={handleFit}
            onZoom100={handleZoom100}
            onRegionModeToggle={() => {
              setRegionMode((r) => !r)
              setPendingBox(null)
            }}
            onRotate={(pageId, rotation) => {
              void onRotate(pageId, rotation)
            }}
            onDeletePage={(pageId) => {
              void onDeletePage(pageId)
            }}
            onPrev={goPrev}
            onNext={goNext}
          />
          <PageCanvas
            page={activePage}
            pageSrc={src}
            masterSize={masterSize}
            onMasterSize={setMasterSize}
            zoom={zoom}
            onZoomChange={(z) => {
              setFitMode(false)
              handleZoomChange(z)
            }}
            fitMode={fitMode}
            regionMode={regionMode || assignField != null}
            onRegion={handleRegion}
          />
          {pendingBox != null && (
            <AssignMenu
              onPick={assignPending}
              onCancel={() => setPendingBox(null)}
            />
          )}
          {pages.length > 1 && (
            <Filmstrip
              pages={pages}
              activePageIndex={safeIndex}
              pageSrc={pageSrc}
              onActivePageChange={onActivePageChange}
              onReorder={handleReorder}
            />
          )}
        </div>
      )}
      <div className="viewer__side">
        <FieldForm
          detail={detail}
          onPatch={onPatch}
          assignField={assignField}
          onAssignFieldChange={(f) => {
            setAssignField(f)
            if (f) setRegionMode(true)
          }}
          variant={variant}
        />
      </div>
    </div>
  )
}

const ASSIGNABLE: Array<{ field: string; label: string }> = [
  { field: 'txnDate', label: 'Transaction Date' },
  { field: 'vendor', label: 'Vendor' },
  { field: 'total', label: 'Total' },
  { field: 'paymentType', label: 'Payment Type' },
  { field: 'taxTotal', label: 'Tax' },
  { field: 'category', label: 'Category' },
  { field: 'taxCategory', label: 'Tax Category' },
  { field: 'project', label: 'Project' },
]

function AssignMenu({
  onPick,
  onCancel,
}: {
  onPick(field: string): void
  onCancel(): void
}) {
  return (
    <div className="viewer-assign" style={{ left: 16, bottom: 120 }} role="menu">
      <div className="viewer-assign__title">Assign region to</div>
      {ASSIGNABLE.map((a) => (
        <button
          key={a.field}
          type="button"
          className="viewer-assign__item"
          role="menuitem"
          onClick={() => onPick(a.field)}
        >
          {a.label}
        </button>
      ))}
      <button type="button" className="viewer-assign__item" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

export default ViewerPanel
