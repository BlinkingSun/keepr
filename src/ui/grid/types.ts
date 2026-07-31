/**
 * Grid panel public types — Lane F.
 * Props contract matches specs/LANE-F-SPEC.md exactly.
 */
import type { FilterTotals, GridRow, ItemPatch, PatchResult } from '../../shared/ipc.ts'

export interface ColumnState {
  key: string
  label: string
  width: number
  visible: boolean
  order: number
}

export interface SortSpec {
  column: string
  dir: 'asc' | 'desc'
}

export interface GridPanelProps {
  rows: GridRow[]
  totals: FilterTotals | null
  loading: boolean
  selectedIds: Set<number>
  onSelectionChange(ids: Set<number>): void
  onOpenItem(itemId: number): void
  /** Commit one field. Resolves with per-field errors rather than throwing. */
  onPatch(itemId: number, patch: ItemPatch): Promise<PatchResult>
  sort: SortSpec[]
  onSortChange(sort: SortSpec[]): void
  columns: ColumnState[]
  onColumnsChange(cols: ColumnState[]): void
  density: 'compact' | 'comfortable'
}

/** Keys that map GridRow fields to ItemPatch keys for inline edit. */
export type EditableFieldKey =
  | 'txnDate'
  | 'vendorName'
  | 'categoryName'
  | 'paymentTypeName'
  | 'taxTotalMinor'
  | 'totalMinor'

export const EDITABLE_FIELDS: ReadonlySet<string> = new Set([
  'txnDate',
  'vendorName',
  'categoryName',
  'paymentTypeName',
  'taxTotalMinor',
  'totalMinor',
])

/** Map a grid column key to the ItemPatch key used on commit. */
export function patchKeyForColumn(columnKey: string): keyof ItemPatch | null {
  switch (columnKey) {
    case 'txnDate':
      return 'txnDate'
    case 'vendorName':
      return 'vendorName'
    case 'categoryName':
      return 'categoryName'
    case 'paymentTypeName':
      return 'paymentTypeName'
    case 'taxTotalMinor':
      return 'taxTotalText'
    case 'totalMinor':
      return 'totalText'
    default:
      return null
  }
}
