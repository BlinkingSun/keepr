/**
 * Page progress state reduction for ScanPanel.
 */
export type PageState = 'scanning' | 'done' | 'failed'

export interface ScanPageRow {
  n: number
  state: PageState
}

/** Apply a progress event to the page list (immutable). */
export function reducePageProgress(
  pages: ScanPageRow[],
  page: number,
  state: PageState,
): ScanPageRow[] {
  const idx = pages.findIndex((p) => p.n === page)
  if (idx < 0) {
    return [...pages, { n: page, state }].sort((a, b) => a.n - b.n)
  }
  return pages.map((p) => (p.n === page ? { n: page, state } : p))
}

export function allPagesDone(pages: ScanPageRow[]): boolean {
  return pages.length > 0 && pages.every((p) => p.state === 'done')
}

export function completionSummary(pageCount: number): string {
  if (pageCount <= 0) return 'No pages scanned'
  const noun = pageCount === 1 ? 'page' : 'pages'
  return `${pageCount} ${noun} -> Inbox`
}

export function pageLabel(row: ScanPageRow): string {
  switch (row.state) {
    case 'scanning':
      return `Page ${row.n} — scanning…`
    case 'done':
      return `Page ${row.n} — done`
    case 'failed':
      return `Page ${row.n} — failed`
  }
}
