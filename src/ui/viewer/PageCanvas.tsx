/**
 * Large page image with zoom, pan, and region selection.
 * Region boxes emitted via onRegion are in STORED-MASTER pixel space.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import type { BBox, ResolvedPage, Rotation } from '../../shared/types.ts'
import {
  displaySize,
  screenBoxToMaster,
  type ViewportTransform,
} from './geometry.ts'
import { clampZoom, zoomFit } from './zoom.ts'

export interface PageCanvasProps {
  page: ResolvedPage | null
  pageSrc: string | null
  /** Natural pixel size of the master file; null until the image loads. */
  masterSize: { w: number; h: number } | null
  onMasterSize(size: { w: number; h: number }): void
  zoom: number
  onZoomChange(z: number): void
  /** Fit-mode: recompute zoom when viewport or page changes. */
  fitMode: boolean
  regionMode: boolean
  onRegion(box: BBox): void
}

type DragKind = 'none' | 'pan' | 'select'

export function PageCanvas({
  page,
  pageSrc,
  masterSize,
  onMasterSize,
  zoom,
  onZoomChange,
  fitMode,
  regionMode,
  onRegion,
}: PageCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState<DragKind>('none')
  const dragOrigin = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const [selScreen, setSelScreen] = useState<BBox | null>(null)
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 })

  const rotation: Rotation = page?.rotation ?? 0

  // Observe viewport size for fit zoom and centering.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect
      if (!cr) return
      setViewportSize({ w: cr.width, h: cr.height })
    })
    ro.observe(el)
    setViewportSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // Fit zoom when requested and dimensions known.
  useEffect(() => {
    if (!fitMode || !masterSize || viewportSize.w <= 0 || viewportSize.h <= 0) return
    const z = zoomFit(masterSize.w, masterSize.h, viewportSize.w, viewportSize.h, rotation)
    onZoomChange(clampZoom(z))
  }, [fitMode, masterSize, viewportSize.w, viewportSize.h, rotation, onZoomChange])

  // Center the image when page, zoom, or viewport changes (no active drag).
  useEffect(() => {
    if (!masterSize || viewportSize.w <= 0) return
    const { w: dW, h: dH } = displaySize(masterSize.w, masterSize.h, rotation)
    const dispW = dW * zoom
    const dispH = dH * zoom
    setPan({
      x: (viewportSize.w - dispW) / 2,
      y: (viewportSize.h - dispH) / 2,
    })
    setSelScreen(null)
  }, [page?.pageId, masterSize?.w, masterSize?.h, zoom, rotation, viewportSize.w, viewportSize.h])

  const transform: ViewportTransform = { zoom, panX: pan.x, panY: pan.y }

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!page || !masterSize) return
      const rect = viewportRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      e.currentTarget.setPointerCapture(e.pointerId)

      if (regionMode) {
        setDrag('select')
        dragOrigin.current = { x, y, panX: pan.x, panY: pan.y }
        setSelScreen({ x, y, w: 0, h: 0 })
      } else {
        setDrag('pan')
        dragOrigin.current = { x, y, panX: pan.x, panY: pan.y }
      }
    },
    [page, masterSize, regionMode, pan.x, pan.y],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (drag === 'none') return
      const rect = viewportRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const o = dragOrigin.current

      if (drag === 'pan') {
        setPan({ x: o.panX + (x - o.x), y: o.panY + (y - o.y) })
      } else if (drag === 'select') {
        const x0 = Math.min(o.x, x)
        const y0 = Math.min(o.y, y)
        setSelScreen({ x: x0, y: y0, w: Math.abs(x - o.x), h: Math.abs(y - o.y) })
      }
    },
    [drag],
  )

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (drag === 'select' && selScreen && masterSize && page) {
        if (selScreen.w >= 2 && selScreen.h >= 2) {
          const master = screenBoxToMaster(
            selScreen,
            masterSize.w,
            masterSize.h,
            rotation,
            transform,
          )
          // Normalize / clamp to master bounds
          const box: BBox = {
            x: Math.max(0, Math.min(master.x, masterSize.w)),
            y: Math.max(0, Math.min(master.y, masterSize.h)),
            w: Math.max(0, master.w),
            h: Math.max(0, master.h),
          }
          if (box.x + box.w > masterSize.w) box.w = masterSize.w - box.x
          if (box.y + box.h > masterSize.h) box.h = masterSize.h - box.y
          if (box.w >= 1 && box.h >= 1) onRegion(box)
        }
        setSelScreen(null)
      }
      setDrag('none')
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* already released */
      }
    },
    [drag, selScreen, masterSize, page, rotation, transform, onRegion],
  )

  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      e.preventDefault()
      const rect = viewportRef.current?.getBoundingClientRect()
      if (!rect) return
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      const next = clampZoom(zoom * factor)
      // Zoom toward cursor
      const ratio = next / zoom
      setPan((p) => ({
        x: mx - (mx - p.x) * ratio,
        y: my - (my - p.y) * ratio,
      }))
      onZoomChange(next)
    },
    [zoom, onZoomChange],
  )

  const className = [
    'viewer-canvas',
    regionMode ? 'viewer-canvas--selecting' : '',
    drag === 'pan' ? 'viewer-canvas--panning' : '',
  ]
    .filter(Boolean)
    .join(' ')

  // Layout: stage is positioned at pan; inside, a wrap sized to rotated display
  // at the current zoom, containing the image with CSS rotation.
  let stage: React.ReactNode = null
  if (pageSrc && masterSize) {
    const { w: dW, h: dH } = displaySize(masterSize.w, masterSize.h, rotation)
    const dispW = dW * zoom
    const dispH = dH * zoom
    // Unrotated image size at this zoom
    const imgW = masterSize.w * zoom
    const imgH = masterSize.h * zoom
    // Center the (possibly rotated) image inside the display AABB
    const imgOffsetX = (dispW - imgW) / 2
    const imgOffsetY = (dispH - imgH) / 2

    stage = (
      <div
        className="viewer-canvas__stage"
        style={{ left: pan.x, top: pan.y, width: dispW, height: dispH }}
      >
        <div
          className="viewer-canvas__img-wrap"
          style={{
            width: imgW,
            height: imgH,
            marginLeft: imgOffsetX,
            marginTop: imgOffsetY,
            transform: rotation !== 0 ? `rotate(${rotation}deg)` : undefined,
          }}
        >
          <img
            className="viewer-canvas__img"
            src={pageSrc}
            alt=""
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                onMasterSize({ w: img.naturalWidth, h: img.naturalHeight })
              }
            }}
          />
        </div>
      </div>
    )
  } else if (pageSrc) {
    // Load to discover natural size
    stage = (
      <img
        src={pageSrc}
        alt=""
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
        onLoad={(e) => {
          const img = e.currentTarget
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            onMasterSize({ w: img.naturalWidth, h: img.naturalHeight })
          }
        }}
      />
    )
  }

  return (
    <div
      ref={viewportRef}
      className={className}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      role="img"
      aria-label="Receipt page"
    >
      {stage}
      {selScreen != null && selScreen.w > 0 && selScreen.h > 0 && (
        <div
          className="viewer-canvas__sel"
          style={{
            left: selScreen.x,
            top: selScreen.y,
            width: selScreen.w,
            height: selScreen.h,
          }}
        />
      )}
      {!pageSrc && (
        <div className="viewer-canvas__empty">No page image</div>
      )}
    </div>
  )
}
