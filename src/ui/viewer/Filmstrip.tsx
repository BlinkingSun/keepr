/**
 * Multi-page filmstrip: active highlight, click to navigate, drag to reorder.
 */
import { useState, type DragEvent as ReactDragEvent } from 'react'
import type { ResolvedPage } from '../../shared/types.ts'
import { reorderPageIds } from './reorder.ts'

export interface FilmstripProps {
  pages: ResolvedPage[]
  activePageIndex: number
  pageSrc(page: ResolvedPage): string
  onActivePageChange(i: number): void
  onReorder(pageIdsInOrder: number[]): void
}

export function Filmstrip({
  pages,
  activePageIndex,
  pageSrc,
  onActivePageChange,
  onReorder,
}: FilmstripProps) {
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)

  if (pages.length === 0) return null

  const onDragStart = (i: number) => (e: ReactDragEvent) => {
    setDragFrom(i)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(i))
  }

  const onDragOver = (i: number) => (e: ReactDragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOver !== i) setDragOver(i)
  }

  const onDrop = (i: number) => (e: ReactDragEvent) => {
    e.preventDefault()
    const from =
      dragFrom ??
      (() => {
        const raw = e.dataTransfer.getData('text/plain')
        const n = Number(raw)
        return Number.isInteger(n) ? n : null
      })()
    setDragFrom(null)
    setDragOver(null)
    if (from == null || from === i) return
    const ids = pages.map((p) => p.pageId)
    const next = reorderPageIds(ids, from, i)
    onReorder(next)
  }

  const onDragEnd = () => {
    setDragFrom(null)
    setDragOver(null)
  }

  return (
    <div className="viewer-filmstrip">
      <div className="viewer-filmstrip__header">
        Page {activePageIndex + 1} of {pages.length}
      </div>
      <div className="viewer-filmstrip__track" role="list">
        {pages.map((p, i) => {
          const active = i === activePageIndex
          const classes = [
            'viewer-filmstrip__thumb',
            active ? 'is-active' : '',
            dragFrom === i ? 'is-dragging' : '',
            dragOver === i && dragFrom !== i ? 'is-drop-target' : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <button
              key={p.pageId}
              type="button"
              role="listitem"
              className={classes}
              draggable
              onClick={() => onActivePageChange(i)}
              onDragStart={onDragStart(i)}
              onDragOver={onDragOver(i)}
              onDrop={onDrop(i)}
              onDragEnd={onDragEnd}
              title={`Page ${i + 1}`}
              aria-current={active ? 'true' : undefined}
            >
              <img src={pageSrc(p)} alt="" draggable={false} />
              <span className="viewer-filmstrip__badge">{i + 1}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
