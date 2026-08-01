/**
 * Field extraction from OCR results into receipt rows.
 * Fills EMPTY fields only. Never overwrites a pinned field unless force is set.
 */

import { parseReceipt } from '../ocr/parse/receipt.ts'
import { applyRules, type RuleDef } from '../rules/engine.ts'
import type {
  ExtractableField,
  ExtractionRecord,
  FieldProvenance,
  OcrResult,
} from '../shared/types.ts'
import type { ItemPatch } from '../shared/ipc.ts'
import type { IngestDeps } from './types.ts'

export interface ExtractOptions {
  /** Overwrite even pinned / non-empty fields. */
  force?: boolean
  /** Known vendor names for the parser. */
  vendors?: string[]
  /** BCP-47 locale for date order. */
  locale?: string
  /** Optional rules list; when omitted, loads enabled rules from the DB. */
  rules?: RuleDef[]
  pageId?: number | null
}

export interface ExtractOutcome {
  itemId: number
  filled: ExtractableField[]
  skipped: Array<{ field: ExtractableField; reason: string }>
  patchOk: boolean
}

/**
 * Run parseReceipt on OCR data, apply rules, write empty fields via items.patch
 * and merge extraction_json provenance (confidence, bbox, pinned=false).
 */
export function extractItem(
  deps: IngestDeps,
  itemId: number,
  ocr: OcrResult | OcrResult[],
  opts: ExtractOptions = {},
): ExtractOutcome {
  const force = opts.force === true
  const results = Array.isArray(ocr) ? ocr : [ocr]
  const filled: ExtractableField[] = []
  const skipped: ExtractOutcome['skipped'] = []

  const itemRow = deps.repos.db
    .prepare(`SELECT id, type FROM item WHERE id = ?`)
    .get(itemId) as { id: number; type: string } | undefined

  if (!itemRow || itemRow.type !== 'receipt') {
    return { itemId, filled, skipped: [{ field: 'vendor', reason: 'not a receipt' }], patchOk: false }
  }

  // Ensure receipt_data exists.
  const exists = deps.repos.db
    .prepare(`SELECT 1 AS x FROM receipt_data WHERE item_id = ?`)
    .get(itemId) as { x: number } | undefined
  if (!exists) {
    deps.repos.db
      .prepare(`INSERT INTO receipt_data(item_id, currency) VALUES (?, 'USD')`)
      .run(itemId)
  }

  const current = readReceiptState(deps, itemId)
  const extraction: ExtractionRecord = { ...(current.extraction ?? {}) }

  // Merge parse results across pages (first non-null field wins; higher conf wins).
  const proposed: ExtractionRecord = {}
  for (const r of results) {
    const pageId = opts.pageId ?? null
    const partial = parseReceipt(r, {
      vendors: opts.vendors,
      locale: opts.locale,
      pageId,
    })
    for (const [key, prov] of Object.entries(partial) as Array<
      [ExtractableField, FieldProvenance | undefined]
    >) {
      if (!prov) continue
      const prev = proposed[key]
      if (!prev || (typeof prov.confidence === 'number' && prov.confidence > (prev.confidence ?? 0))) {
        proposed[key] = prov
      }
    }
  }

  const patch: ItemPatch = {}
  const provenanceUpdates: ExtractionRecord = {}

  const consider = (
    field: ExtractableField,
    isEmpty: boolean,
    apply: (prov: FieldProvenance) => void,
  ) => {
    const prov = proposed[field]
    if (!prov) return
    const existingProv = extraction[field]
    if (!force) {
      if (existingProv?.pinned) {
        skipped.push({ field, reason: 'pinned' })
        return
      }
      if (!isEmpty) {
        skipped.push({ field, reason: 'already set' })
        return
      }
    }
    apply(prov)
    provenanceUpdates[field] = {
      value: prov.value,
      confidence: prov.confidence,
      bbox: prov.bbox,
      pageId: prov.pageId ?? opts.pageId ?? null,
      pinned: false,
    }
    filled.push(field)
  }

  consider('vendor', current.vendorId == null && !current.vendorName, (prov) => {
    if (typeof prov.value === 'string' && prov.value.trim()) {
      patch.vendorName = prov.value.trim()
    }
  })

  consider('txnDate', current.txnDate == null, (prov) => {
    if (typeof prov.value === 'string') patch.txnDate = prov.value
  })

  consider('total', current.totalMinor == null, (prov) => {
    // parseReceipt stores MinorUnits (integer). items.patch expects money text.
    if (typeof prov.value === 'number' && Number.isInteger(prov.value)) {
      patch.totalText = formatMinor(prov.value)
    } else if (typeof prov.value === 'string') {
      patch.totalText = prov.value
    }
  })

  consider('taxTotal', current.taxTotalMinor == null, (prov) => {
    const v = prov.value as { totalMinor?: number } | number | null
    if (v && typeof v === 'object' && typeof v.totalMinor === 'number') {
      patch.taxTotalText = formatMinor(v.totalMinor)
    } else if (typeof v === 'number') {
      patch.taxTotalText = formatMinor(v)
    }
  })

  consider('paymentType', current.paymentTypeId == null, (prov) => {
    if (typeof prov.value === 'string' && prov.value.trim()) {
      patch.paymentTypeName = prov.value.trim()
    }
  })

  consider('externalRef', current.externalRef == null, (prov) => {
    if (typeof prov.value === 'string') patch.externalRef = prov.value
  })

  consider('description', current.description == null, (prov) => {
    if (typeof prov.value === 'string') patch.description = prov.value
  })

  // Category from rules after vendor is known.
  let vendorNameForRules =
    (typeof patch.vendorName === 'string' ? patch.vendorName : null) ?? current.vendorName
  let vendorIdForRules = current.vendorId

  let patchOk = true
  if (Object.keys(patch).length > 0) {
    const result = deps.repos.items.patch(itemId, patch)
    patchOk = result.ok
    // items.patch pins user-style edits — restore auto provenance (pinned:false).
    if (result.ok) {
      mergeExtractionJson(deps, itemId, provenanceUpdates)
    }
  } else if (Object.keys(provenanceUpdates).length > 0) {
    mergeExtractionJson(deps, itemId, provenanceUpdates)
  }

  // Refresh after patch for rule engine.
  const after = readReceiptState(deps, itemId)
  vendorIdForRules = after.vendorId
  vendorNameForRules = after.vendorName

  const pinnedFields = new Set<string>()
  for (const [k, p] of Object.entries(after.extraction ?? {})) {
    if (p?.pinned) pinnedFields.add(k)
  }
  if (!force && after.categoryId != null) {
    // already has category — rules engine also no-ops
  }

  const rules = opts.rules ?? loadRules(deps)
  let vendorDefaultCategoryId: number | null = null
  if (vendorIdForRules != null) {
    const v = deps.repos.db
      .prepare(`SELECT default_category_id FROM vendor WHERE id = ?`)
      .get(vendorIdForRules) as { default_category_id: number | null } | undefined
    vendorDefaultCategoryId = v?.default_category_id ?? null
  }

  const outcome = applyRules({
    rules,
    candidate: {
      vendorId: vendorIdForRules,
      vendorName: vendorNameForRules,
      categoryId: after.categoryId,
    },
    pinnedFields,
    vendorDefaultCategoryId,
  })

  for (const prop of outcome.proposals) {
    if (prop.field === 'categoryId' && typeof prop.value === 'number') {
      if (!force && (after.categoryId != null || pinnedFields.has('category'))) {
        skipped.push({ field: 'category', reason: pinnedFields.has('category') ? 'pinned' : 'already set' })
        continue
      }
      // Resolve category name for patch.
      const cat = deps.repos.db
        .prepare(`SELECT name FROM category WHERE id = ?`)
        .get(prop.value) as { name: string } | undefined
      if (cat) {
        const r = deps.repos.items.patch(itemId, { categoryName: cat.name })
        if (r.ok) {
          // Re-mark as unpinned auto fill
          mergeExtractionJson(deps, itemId, {
            category: {
              value: cat.name,
              confidence: 0.9,
              bbox: null,
              pageId: opts.pageId ?? null,
              pinned: false,
            },
          })
          filled.push('category')
          if (prop.ruleId != null) {
            bumpRuleHit(deps, prop.ruleId)
          }
        }
      }
    }
  }

  return { itemId, filled, skipped, patchOk }
}

/**
 * Extract for an item using OCR text already stored on its pages.
 */
export function extractFromStoredPages(
  deps: IngestDeps,
  itemId: number,
  opts: ExtractOptions = {},
): ExtractOutcome {
  // Feed the known-vendor list to the parser when the caller did not supply one.
  //
  // This was the whole reason for seeding 87 vendors, and nothing was passing them
  // in: every import ran the parser's heuristic top-line guess instead of its
  // known-vendor match. Two consequences, both visible on a corpus run — the
  // vendor came back as the raw header ("HOME DEPOT #4821") rather than the
  // canonical name, and its confidence sat at 0.79, under the review threshold, so
  // 11 of 12 correctly-read receipts were flagged as uncertain.
  const vendors =
    opts.vendors ??
    (deps.repos.db.prepare('SELECT name FROM vendor').all() as Array<{ name: string }>).map(
      (r) => r.name,
    )
  const effectiveOpts: ExtractOptions = { ...opts, vendors }
  const rows = deps.repos.db
    .prepare(
      `SELECT id, ocr_text, ocr_conf, ocr_engine, ocr_words_json, ocr_generation
         FROM page WHERE item_id = ? AND ocr_status = 'done' ORDER BY seq`,
    )
    .all(itemId) as Array<{
    id: number
    ocr_text: string | null
    ocr_conf: number | null
    ocr_engine: string | null
    ocr_words_json: string | null
    ocr_generation: number
  }>

  if (!rows.length) {
    return { itemId, filled: [], skipped: [], patchOk: true }
  }

  const ocrs: OcrResult[] = rows.map((r) => {
    let words: OcrResult['words'] = []
    if (r.ocr_words_json) {
      try {
        words = JSON.parse(r.ocr_words_json) as OcrResult['words']
      } catch {
        words = []
      }
    }
    return {
      text: r.ocr_text ?? '',
      words,
      confidence: r.ocr_conf ?? 0,
      engine: r.ocr_engine ?? 'unknown',
      generation: r.ocr_generation,
      msElapsed: 0,
    }
  })

  // Prefer first page id for provenance when single-page.
  const pageId = rows.length === 1 ? rows[0]!.id : null
  return extractItem(deps, itemId, ocrs, { ...effectiveOpts, pageId })
}

/* ---------------------------------------------------------------------------
 * Internals
 * ------------------------------------------------------------------------ */

interface ReceiptState {
  vendorId: number | null
  vendorName: string | null
  txnDate: string | null
  totalMinor: number | null
  taxTotalMinor: number | null
  paymentTypeId: number | null
  categoryId: number | null
  externalRef: string | null
  description: string | null
  extraction: ExtractionRecord | null
}

function readReceiptState(deps: IngestDeps, itemId: number): ReceiptState {
  const r = deps.repos.db
    .prepare(
      `SELECT r.vendor_id, v.name AS vendor_name, r.txn_date, r.total_minor,
              r.tax_total_minor, r.payment_type_id, r.category_id,
              r.external_ref, r.description, r.extraction_json
         FROM receipt_data r
         LEFT JOIN vendor v ON v.id = r.vendor_id
        WHERE r.item_id = ?`,
    )
    .get(itemId) as
    | {
        vendor_id: number | null
        vendor_name: string | null
        txn_date: string | null
        total_minor: number | null
        tax_total_minor: number | null
        payment_type_id: number | null
        category_id: number | null
        external_ref: string | null
        description: string | null
        extraction_json: string | null
      }
    | undefined

  if (!r) {
    return {
      vendorId: null,
      vendorName: null,
      txnDate: null,
      totalMinor: null,
      taxTotalMinor: null,
      paymentTypeId: null,
      categoryId: null,
      externalRef: null,
      description: null,
      extraction: null,
    }
  }

  let extraction: ExtractionRecord | null = null
  if (r.extraction_json) {
    try {
      extraction = JSON.parse(r.extraction_json) as ExtractionRecord
    } catch {
      extraction = null
    }
  }

  return {
    vendorId: r.vendor_id,
    vendorName: r.vendor_name,
    txnDate: r.txn_date,
    totalMinor: r.total_minor,
    taxTotalMinor: r.tax_total_minor,
    paymentTypeId: r.payment_type_id,
    categoryId: r.category_id,
    externalRef: r.external_ref,
    description: r.description,
    extraction,
  }
}

/**
 * Merge provenance into extraction_json WITHOUT forcing pinned:true.
 * items.patch pins fields; we immediately rewrite auto-fill provenance.
 */
function mergeExtractionJson(
  deps: IngestDeps,
  itemId: number,
  updates: ExtractionRecord,
): void {
  const row = deps.repos.db
    .prepare(`SELECT extraction_json FROM receipt_data WHERE item_id = ?`)
    .get(itemId) as { extraction_json: string | null } | undefined
  let current: ExtractionRecord = {}
  if (row?.extraction_json) {
    try {
      current = JSON.parse(row.extraction_json) as ExtractionRecord
    } catch {
      current = {}
    }
  }
  for (const [k, v] of Object.entries(updates)) {
    if (v) current[k as ExtractableField] = v
  }
  deps.repos.db
    .prepare(`UPDATE receipt_data SET extraction_json = ? WHERE item_id = ?`)
    .run(JSON.stringify(current), itemId)
}

function formatMinor(minor: number): string {
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  const whole = Math.floor(abs / 100)
  const frac = abs % 100
  return `${sign}${whole}.${frac.toString().padStart(2, '0')}`
}

function loadRules(deps: IngestDeps): RuleDef[] {
  try {
    const rows = deps.repos.db
      .prepare(
        `SELECT id, kind, match_json, action_json, priority, enabled
           FROM rule WHERE enabled = 1 ORDER BY priority, id`,
      )
      .all() as Array<{
      id: number
      kind: string
      match_json: string
      action_json: string
      priority: number
      enabled: number
    }>
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      match: JSON.parse(r.match_json),
      action: JSON.parse(r.action_json),
      priority: r.priority,
      enabled: r.enabled === 1,
    }))
  } catch {
    // rule table may be empty or mid-migration in partial DBs
    return []
  }
}

function bumpRuleHit(deps: IngestDeps, ruleId: number): void {
  try {
    deps.repos.db
      .prepare(`UPDATE rule SET hit_count = hit_count + 1 WHERE id = ?`)
      .run(ruleId)
  } catch {
    /* optional */
  }
}
