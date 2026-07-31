/**
 * Extracted-field form — inline editable, commits through onPatch.
 * Confidence below threshold shows an explicit "N% match" in --warn.
 */
import { useCallback, useEffect, useState } from 'react'
import type {
  ExtractionRecord,
  ExtractableField,
  FieldProvenance,
} from '../../shared/types.ts'
import type { ItemDetail, ItemPatch, PatchResult } from '../../shared/ipc.ts'
import { formatConfidence } from './confidence.ts'

export interface FieldFormProps {
  detail: ItemDetail
  onPatch(itemId: number, patch: ItemPatch): Promise<PatchResult>
  /** When set, the next region assignment targets this field (region mode). */
  assignField: string | null
  onAssignFieldChange(field: string | null): void
  variant: 'inspector' | 'details'
}

type FieldKey =
  | 'txnDate'
  | 'vendorName'
  | 'totalText'
  | 'paymentTypeName'
  | 'taxTotalText'
  | 'categoryName'
  | 'taxCategoryName'
  | 'projectName'

interface FieldDef {
  key: FieldKey
  label: string
  /** Provenance key in ExtractionRecord, if any. */
  prov?: ExtractableField
  numeric?: boolean
  /** Read value from detail into the input string. */
  read(d: ItemDetail): string
}

function minorToText(minor: number | null | undefined): string {
  if (minor == null) return ''
  const neg = minor < 0
  const abs = Math.abs(minor)
  const whole = Math.floor(abs / 100)
  const cents = String(abs % 100).padStart(2, '0')
  return `${neg ? '-' : ''}${whole}.${cents}`
}

function stringProv(
  extraction: ExtractionRecord | null | undefined,
  key: ExtractableField,
): string {
  const p = extraction?.[key]
  if (!p) return ''
  const v = p.value
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  return ''
}

const FIELDS: FieldDef[] = [
  {
    key: 'txnDate',
    label: 'Transaction Date',
    prov: 'txnDate',
    read: (d) => d.receipt?.txnDate ?? stringProv(d.receipt?.extraction, 'txnDate'),
  },
  {
    key: 'vendorName',
    label: 'Vendor',
    prov: 'vendor',
    read: (d) => stringProv(d.receipt?.extraction, 'vendor'),
  },
  {
    key: 'totalText',
    label: 'Total',
    prov: 'total',
    numeric: true,
    read: (d) => minorToText(d.receipt?.totalMinor),
  },
  {
    key: 'paymentTypeName',
    label: 'Payment Type',
    prov: 'paymentType',
    read: (d) => stringProv(d.receipt?.extraction, 'paymentType'),
  },
  {
    key: 'taxTotalText',
    label: 'Tax',
    prov: 'taxTotal',
    numeric: true,
    read: (d) => minorToText(d.receipt?.taxTotalMinor),
  },
  {
    key: 'categoryName',
    label: 'Category',
    prov: 'category',
    read: (d) => stringProv(d.receipt?.extraction, 'category'),
  },
  {
    key: 'taxCategoryName',
    label: 'Tax Category',
    prov: 'taxCategory',
    read: (d) => stringProv(d.receipt?.extraction, 'taxCategory'),
  },
  {
    key: 'projectName',
    label: 'Project',
    read: (d) => {
      const p = d.customFields['project'] ?? d.customFields['projectName']
      return typeof p === 'string' ? p : ''
    },
  },
]

function provenanceOf(
  extraction: ExtractionRecord | null | undefined,
  key: ExtractableField | undefined,
): FieldProvenance | null {
  if (!extraction || !key) return null
  return extraction[key] ?? null
}

function readAll(detail: ItemDetail): Record<FieldKey, string> {
  const out = {} as Record<FieldKey, string>
  for (const f of FIELDS) {
    out[f.key] = f.read(detail)
  }
  return out
}

export function FieldForm({
  detail,
  onPatch,
  assignField,
  onAssignFieldChange,
  variant,
}: FieldFormProps) {
  const [drafts, setDrafts] = useState<Record<FieldKey, string>>(() => readAll(detail))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setDrafts(readAll(detail))
    setErrors({})
  }, [detail])

  const commit = useCallback(
    async (key: FieldKey, value: string) => {
      const baseline = readAll(detail)[key]
      if (value === baseline) return
      setBusy(true)
      try {
        const patch: ItemPatch = { [key]: value === '' ? null : value }
        const res = await onPatch(detail.item.id, patch)
        if (!res.ok) {
          setErrors((e) => ({ ...e, ...res.errors }))
        } else {
          setErrors((e) => {
            const next = { ...e }
            delete next[key]
            return next
          })
        }
      } finally {
        setBusy(false)
      }
    },
    [detail, onPatch],
  )

  const extraction = detail.receipt?.extraction ?? null
  const title = variant === 'details' ? 'Extracted Details' : 'Extracted Fields'
  const isReceipt = detail.item.type === 'receipt'

  return (
    <div className="viewer-form">
      <div className="viewer-form__header">
        <span className="viewer-form__title">{title}</span>
      </div>
      <div className="viewer-form__body">
        {FIELDS.map((f) => {
          const prov = provenanceOf(extraction, f.prov)
          const confLabel = formatConfidence(prov?.confidence ?? null)
          const err = errors[f.key]
          const assignKey = f.prov ?? f.key
          const isAssign = assignField === assignKey
          return (
            <div className="viewer-field" key={f.key}>
              <label className="viewer-field__label" htmlFor={`vf-${f.key}`}>
                {f.label}
              </label>
              <div className="viewer-field__control">
                <input
                  id={`vf-${f.key}`}
                  className={
                    f.numeric
                      ? 'viewer-field__input viewer-field__input--num'
                      : 'viewer-field__input'
                  }
                  type="text"
                  value={drafts[f.key] ?? ''}
                  disabled={busy || !isReceipt}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [f.key]: e.target.value }))
                  }
                  onBlur={() => void commit(f.key, drafts[f.key] ?? '')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                  }}
                  spellCheck={false}
                  autoComplete="off"
                />
                <div className="viewer-field__meta">
                  {confLabel != null && (
                    <span className="viewer-field__conf" title="OCR confidence">
                      {confLabel}
                    </span>
                  )}
                  {err != null && <span className="viewer-field__error">{err}</span>}
                  {f.prov != null && isReceipt && (
                    <button
                      type="button"
                      className={
                        isAssign ? 'viewer-btn viewer-btn--active' : 'viewer-btn'
                      }
                      style={{ height: 20, padding: '0 6px', fontSize: 11 }}
                      title="Draw a region on the page to fill this field"
                      onClick={() =>
                        onAssignFieldChange(isAssign ? null : assignKey)
                      }
                    >
                      Region
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {isReceipt && (
        <div className="viewer-form__footer">
          <span
            className={
              detail.item.reviewedAt == null
                ? 'viewer-status-dot viewer-status-dot--warn'
                : 'viewer-status-dot'
            }
            aria-hidden
          />
          <span className="viewer-form__hint">
            {detail.item.reviewedAt != null ? 'Reviewed' : 'Unreviewed'}
          </span>
          <span className="viewer-form__footer-spacer" />
          {detail.item.reviewedAt == null && (
            <button
              type="button"
              className="viewer-btn viewer-btn--primary"
              disabled={busy}
              onClick={() => void onPatch(detail.item.id, { reviewed: true })}
            >
              Mark reviewed
            </button>
          )}
        </div>
      )}
    </div>
  )
}
