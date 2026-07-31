/**
 * Read / prepare cell display and edit values from a GridRow.
 * Money is formatted only at the last moment via formatMoney.
 */

import type { GridRow } from '../../shared/ipc.ts'
import { formatMoney } from './money.ts'

const FIELD_MAP: Record<string, string> = {
  txnDate: 'txnDate',
  vendorName: 'vendorName',
  categoryName: 'categoryName',
  paymentTypeName: 'paymentTypeName',
  taxTotalMinor: 'taxTotal',
  totalMinor: 'total',
}

export function cellDisplayValue(row: GridRow, columnKey: string, rowIndex: number): string {
  switch (columnKey) {
    case 'rowNum':
      return String(rowIndex + 1)
    case 'txnDate':
      return row.txnDate ?? ''
    case 'vendorName':
      return row.vendorName ?? ''
    case 'categoryName':
      return row.categoryName ?? ''
    case 'paymentTypeName':
      return row.paymentTypeName ?? ''
    case 'taxTotalMinor':
      return formatMoney(row.taxTotalMinor, row.currency)
    case 'totalMinor':
      return formatMoney(row.totalMinor, row.currency)
    case 'reviewed':
      return row.reviewed ? 'yes' : ''
    case 'type':
      return row.type
    case 'currency':
      return row.currency
    default:
      return ''
  }
}

/** Text put into an inline editor when edit begins. */
export function cellEditValue(row: GridRow, columnKey: string): string {
  switch (columnKey) {
    case 'txnDate':
      return row.txnDate ?? ''
    case 'vendorName':
      return row.vendorName ?? ''
    case 'categoryName':
      return row.categoryName ?? ''
    case 'paymentTypeName':
      return row.paymentTypeName ?? ''
    case 'taxTotalMinor':
      if (row.taxTotalMinor == null) return ''
      return minorToEditText(row.taxTotalMinor)
    case 'totalMinor':
      if (row.totalMinor == null) return ''
      return minorToEditText(row.totalMinor)
    default:
      return ''
  }
}

/** Integer minor → "84.37" edit string without currency symbol (no float). */
export function minorToEditText(minor: number): string {
  const neg = minor < 0
  const abs = Math.abs(minor)
  const major = Math.floor(abs / 100)
  const cents = abs % 100
  return `${neg ? '-' : ''}${major}.${String(cents).padStart(2, '0')}`
}

export function isMoneyColumn(columnKey: string): boolean {
  return columnKey === 'taxTotalMinor' || columnKey === 'totalMinor'
}

export function isMissingField(row: GridRow, columnKey: string): boolean {
  const field = FIELD_MAP[columnKey]
  if (!field) return false
  return row.missingFields.includes(field) || row.missingFields.includes(columnKey)
}

export function isLowConfidenceField(row: GridRow, columnKey: string): boolean {
  const field = FIELD_MAP[columnKey] ?? columnKey
  return row.lowConfidenceFields.some(
    (entry) => entry === field || entry.startsWith(`${field}:`),
  )
}

/**
 * Label for a low-confidence badge: "78%" when the entry is "field:78",
 * otherwise "low". Returns null when the field is not low-confidence.
 */
export function confidenceLabel(row: GridRow, columnKey: string): string | null {
  if (!isLowConfidenceField(row, columnKey)) return null
  const field = FIELD_MAP[columnKey] ?? columnKey
  for (const entry of row.lowConfidenceFields) {
    if (entry === field || entry.startsWith(`${field}:`)) {
      const colon = entry.indexOf(':')
      if (colon >= 0) {
        const n = Number(entry.slice(colon + 1))
        if (Number.isFinite(n)) return `${Math.round(n)}%`
      }
      return 'low'
    }
  }
  return 'low'
}
