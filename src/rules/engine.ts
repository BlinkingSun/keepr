/**
 * Pure, synchronous rules engine. No database access.
 * Hit-count increments belong in the caller.
 */

export type RuleKind = 'vendor_to_category' | string

export interface RuleDef {
  id: number
  kind: RuleKind
  /** For vendor_to_category: { vendorId?: number; vendorNormalized?: string; vendorName?: string } */
  match: unknown
  /** For vendor_to_category: { categoryId: number } */
  action: unknown
  priority: number
  enabled: boolean
}

export interface RuleCandidate {
  vendorId?: number | null
  vendorName?: string | null
  vendorNormalized?: string | null
  categoryId?: number | null
  /** Other fields the engine may propose into later. */
  [key: string]: unknown
}

export interface RuleInput {
  rules: RuleDef[]
  candidate: RuleCandidate
  /** Field names that are pinned — engine must never propose for these. */
  pinnedFields: ReadonlySet<string> | readonly string[]
  /** Fallback when no rule matches. */
  vendorDefaultCategoryId?: number | null
}

export interface FieldProposal {
  field: string
  value: unknown
  /** null when the proposal came from vendor.default_category_id, not a rule row. */
  ruleId: number | null
}

export interface RuleOutcome {
  proposals: FieldProposal[]
}

function isPinned(pinned: RuleInput['pinnedFields'], field: string): boolean {
  if (pinned instanceof Set) return pinned.has(field)
  for (const f of pinned) {
    if (f === field) return true
  }
  return false
}

function norm(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

interface VendorMatch {
  vendorId?: number
  vendorNormalized?: string
  vendorName?: string
}

interface CategoryAction {
  categoryId?: number
  category_id?: number
}

/**
 * Phase 1: vendor_to_category.
 * Order by priority ascending, first match wins; ties broken by lower id.
 * Falls back to vendor.default_category_id when no rule matches.
 * Never proposes a value for a pinned field.
 */
export function applyRules(input: RuleInput): RuleOutcome {
  const proposals: FieldProposal[] = []
  if (isPinned(input.pinnedFields, 'category') || isPinned(input.pinnedFields, 'categoryId')) {
    return { proposals }
  }

  // Already has a category? Phase 1 still proposes only when empty, matching
  // "re-applying rules does not overwrite… does fill an empty one".
  const existing = input.candidate.categoryId
  if (existing != null) {
    return { proposals }
  }

  const enabled = input.rules
    .filter((r) => r.enabled && r.kind === 'vendor_to_category')
    .slice()
    .sort((a, b) => a.priority - b.priority || a.id - b.id)

  const candNorm =
    input.candidate.vendorNormalized ??
    norm(typeof input.candidate.vendorName === 'string' ? input.candidate.vendorName : null)
  const candId = input.candidate.vendorId ?? null

  for (const rule of enabled) {
    const m = (rule.match ?? {}) as VendorMatch
    let matched = false
    if (m.vendorId != null && candId != null && m.vendorId === candId) {
      matched = true
    } else if (m.vendorNormalized && candNorm && m.vendorNormalized === candNorm) {
      matched = true
    } else if (m.vendorName && candNorm && norm(m.vendorName) === candNorm) {
      matched = true
    }
    if (!matched) continue

    const action = (rule.action ?? {}) as CategoryAction
    const categoryId = action.categoryId ?? action.category_id
    if (categoryId == null) continue

    proposals.push({ field: 'categoryId', value: categoryId, ruleId: rule.id })
    return { proposals }
  }

  // Fallback: vendor default category.
  if (input.vendorDefaultCategoryId != null) {
    proposals.push({
      field: 'categoryId',
      value: input.vendorDefaultCategoryId,
      ruleId: null,
    })
  }

  return { proposals }
}
