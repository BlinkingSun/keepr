/**
 * Missing-thumb placeholder classifier + flag severity.
 * Run: node --experimental-strip-types --test src/ui/thumbs/__tests__/placeholder.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { flagKind } from '../flagKind.ts'
import { needsPlaceholder, placeholderLabel } from '../placeholder.ts'

describe('placeholderLabel', () => {
  it('maps item types to glyph-free labels', () => {
    assert.equal(placeholderLabel('document'), 'PDF')
    assert.equal(placeholderLabel('contact'), 'Contact')
    assert.equal(placeholderLabel('receipt'), 'No image')
  })

  it('unknown / null falls back to No image', () => {
    assert.equal(placeholderLabel(null), 'No image')
    assert.equal(placeholderLabel(undefined), 'No image')
    assert.equal(placeholderLabel('other'), 'No image')
  })
})

describe('needsPlaceholder', () => {
  it('null / empty → placeholder branch', () => {
    assert.equal(needsPlaceholder(null), true)
    assert.equal(needsPlaceholder(undefined), true)
    assert.equal(needsPlaceholder(''), true)
  })

  it('non-empty src → image branch', () => {
    assert.equal(needsPlaceholder('file:///thumbs/a.jpg'), false)
    assert.equal(needsPlaceholder('keepr-thumb://1'), false)
  })
})

describe('flagKind (grid severity parity)', () => {
  const base = {
    needsManualEntry: false,
    ocrStatus: 'done' as const,
    ocrConfidence: 0.9,
    missingFields: [] as string[],
    lowConfidenceFields: [] as string[],
  }

  it('danger when needsManualEntry', () => {
    const f = flagKind({ ...base, needsManualEntry: true, ocrStatus: 'failed' })
    assert.ok(f)
    assert.equal(f!.kind, 'danger')
    assert.equal(f!.mark, '!')
  })

  it('warn when missing or low-confidence fields', () => {
    const f = flagKind({ ...base, missingFields: ['vendorName'] })
    assert.ok(f)
    assert.equal(f!.kind, 'warn')
    assert.equal(f!.mark, '?')
  })

  it('pending when OCR still running', () => {
    const f = flagKind({ ...base, ocrStatus: 'pending' })
    assert.ok(f)
    assert.equal(f!.kind, 'pending')
    assert.equal(f!.mark, '…')
  })

  it('null when clean', () => {
    assert.equal(flagKind(base), null)
  })

  it('danger beats warn', () => {
    const f = flagKind({
      ...base,
      needsManualEntry: true,
      missingFields: ['total'],
    })
    assert.equal(f!.kind, 'danger')
  })
})
