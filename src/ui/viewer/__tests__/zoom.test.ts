/**
 * Zoom fit calculation tests.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { zoomFit, clampZoom } from '../zoom.ts'

describe('zoomFit', () => {
  it('portrait image in landscape viewport is limited by height', () => {
    // Portrait 400×800, landscape viewport 1000×500 → min(1000/400, 500/800) = 0.625
    const z = zoomFit(400, 800, 1000, 500, 0)
    assert.equal(z, 0.625)
  })

  it('landscape image in portrait viewport is limited by width', () => {
    // Landscape 800×400, portrait viewport 500×1000 → min(500/800, 1000/400) = 0.625
    const z = zoomFit(800, 400, 500, 1000, 0)
    assert.equal(z, 0.625)
  })

  it('accounts for 90° rotation swapping display dimensions', () => {
    // Master 400×800 (portrait). At 90° display is 800×400 (landscape).
    // Viewport 1000×500 landscape → min(1000/800, 500/400) = min(1.25, 1.25) = 1.25
    const z = zoomFit(400, 800, 1000, 500, 90)
    assert.equal(z, 1.25)
  })

  it('clampZoom bounds extremes', () => {
    assert.equal(clampZoom(0.01), 0.1)
    assert.equal(clampZoom(100), 8)
    assert.equal(clampZoom(1.5), 1.5)
  })
})
