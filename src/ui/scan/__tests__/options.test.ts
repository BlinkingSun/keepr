/**
 * Pure option-derivation tests for ScanPanel.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { ScanCaps } from '../../../shared/types.ts'
import {
  availableSources,
  clampOptions,
  defaultOptions,
  duplexAvailable,
  sourceLabel,
} from '../options.ts'
import { completionSummary, reducePageProgress } from '../pages.ts'
import { previewFileName } from '../filename.ts'

const CAPS: ScanCaps = {
  makeModel: 'Test',
  sources: ['Platen', 'Adf'],
  colorModes: ['RGB24', 'Grayscale8'],
  resolutions: [100, 200, 300],
  duplex: true,
}

describe('options', () => {
  it('defaultOptions prefers Adf + 300 + RGB24', () => {
    const o = defaultOptions(CAPS)
    assert.deepEqual(o, {
      source: 'Adf',
      colorMode: 'RGB24',
      dpi: 300,
      duplex: false,
    })
  })

  it('never offers source not in caps', () => {
    const platenOnly: ScanCaps = {
      ...CAPS,
      sources: ['Platen'],
      duplex: false,
    }
    const o = defaultOptions(platenOnly)
    assert.equal(o?.source, 'Platen')
    assert.deepEqual(availableSources(platenOnly), ['Platen'])
    assert.equal(duplexAvailable(platenOnly), false)
  })

  it('clampOptions drops duplex when source is Platen', () => {
    const o = clampOptions(CAPS, defaultOptions(CAPS), {
      source: 'Platen',
      duplex: true,
    })
    assert.equal(o?.source, 'Platen')
    assert.equal(o?.duplex, undefined)
  })

  it('sourceLabel maps Adf → ADF', () => {
    assert.equal(sourceLabel('Adf'), 'ADF')
    assert.equal(sourceLabel('Platen'), 'Platen')
  })
})

describe('pages + filename', () => {
  it('reducePageProgress inserts and updates', () => {
    let pages = reducePageProgress([], 1, 'scanning')
    assert.deepEqual(pages, [{ n: 1, state: 'scanning' }])
    pages = reducePageProgress(pages, 1, 'done')
    pages = reducePageProgress(pages, 2, 'scanning')
    assert.deepEqual(pages, [
      { n: 1, state: 'done' },
      { n: 2, state: 'scanning' },
    ])
  })

  it('completionSummary wording', () => {
    assert.equal(completionSummary(1), '1 page -> Inbox')
    assert.equal(completionSummary(3), '3 pages -> Inbox')
  })

  it('previewFileName matches scan naming', () => {
    const d = new Date(2026, 7, 1, 14, 32, 7)
    assert.equal(previewFileName(d, 1), 'Scan 2026-08-01 14.32.07 p1.jpg')
  })
})
