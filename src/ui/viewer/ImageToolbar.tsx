/**
 * Consistent image tools: rotate L/R, zoom fit/100%, delete page, region mode.
 */
import type { ResolvedPage, Rotation } from '../../shared/types.ts'
import { cycleRotation } from './navigation.ts'

export interface ImageToolbarProps {
  page: ResolvedPage | null
  pageCount: number
  activePageIndex: number
  zoom: number
  fitMode: boolean
  regionMode: boolean
  onFit(): void
  onZoom100(): void
  onRegionModeToggle(): void
  onRotate(pageId: number, rotation: Rotation): void
  onDeletePage(pageId: number): void
  onPrev(): void
  onNext(): void
}

export function ImageToolbar({
  page,
  pageCount,
  activePageIndex,
  zoom,
  fitMode,
  regionMode,
  onFit,
  onZoom100,
  onRegionModeToggle,
  onRotate,
  onDeletePage,
  onPrev,
  onNext,
}: ImageToolbarProps) {
  const can = page != null
  const pct = Math.round(zoom * 100)

  return (
    <div className="viewer-toolbar" role="toolbar" aria-label="Image tools">
      <div className="viewer-toolbar__group">
        <button
          type="button"
          className="viewer-btn"
          disabled={!can || pageCount < 2 || activePageIndex <= 0}
          onClick={onPrev}
          title="Previous page"
        >
          <span className="viewer-btn__glyph" aria-hidden>
            ‹
          </span>
          Prev
        </button>
        <button
          type="button"
          className="viewer-btn"
          disabled={!can || pageCount < 2 || activePageIndex >= pageCount - 1}
          onClick={onNext}
          title="Next page"
        >
          Next
          <span className="viewer-btn__glyph" aria-hidden>
            ›
          </span>
        </button>
      </div>

      <div className="viewer-toolbar__group">
        <button
          type="button"
          className="viewer-btn"
          disabled={!can}
          title="Rotate left 90°"
          onClick={() => {
            if (!page) return
            onRotate(page.pageId, cycleRotation(page.rotation, -90))
          }}
        >
          <span className="viewer-btn__glyph" aria-hidden>
            ↺
          </span>
          Rotate L
        </button>
        <button
          type="button"
          className="viewer-btn"
          disabled={!can}
          title="Rotate right 90°"
          onClick={() => {
            if (!page) return
            onRotate(page.pageId, cycleRotation(page.rotation, 90))
          }}
        >
          <span className="viewer-btn__glyph" aria-hidden>
            ↻
          </span>
          Rotate R
        </button>
      </div>

      <div className="viewer-toolbar__group">
        <button
          type="button"
          className={`viewer-btn${fitMode ? ' viewer-btn--active' : ''}`}
          disabled={!can}
          title="Fit to view"
          onClick={onFit}
        >
          Fit
        </button>
        <button
          type="button"
          className={`viewer-btn${!fitMode && Math.abs(zoom - 1) < 0.01 ? ' viewer-btn--active' : ''}`}
          disabled={!can}
          title="100% zoom"
          onClick={onZoom100}
        >
          100%
        </button>
        <span className="viewer-toolbar__label num" aria-live="polite">
          {pct}%
        </span>
      </div>

      <div className="viewer-toolbar__group">
        <button
          type="button"
          className={`viewer-btn${regionMode ? ' viewer-btn--active' : ''}`}
          disabled={!can}
          title="Draw a region and assign it to a field"
          onClick={onRegionModeToggle}
        >
          Select region
        </button>
      </div>

      <span className="viewer-toolbar__spacer" />

      <div className="viewer-toolbar__group">
        <button
          type="button"
          className="viewer-btn viewer-btn--danger"
          disabled={!can}
          title="Delete this page"
          onClick={() => {
            if (!page) return
            onDeletePage(page.pageId)
          }}
        >
          Delete page
        </button>
      </div>
    </div>
  )
}
