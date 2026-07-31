/**
 * Pure geometry unit tests for searchable-PDF placement (assert numbers).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  displaySize,
  masterPointToDisplay,
  masterBBoxToPdfText,
} from '../geometry.ts'

describe('export geometry', () => {
  it('rotation 0: master point maps 1:1 to display', () => {
    const p = masterPointToDisplay(20, 10, 200, 100, 0)
    assert.equal(p.x, 20)
    assert.equal(p.y, 10)
  })

  it('displaySize swaps axes at 90 and 270', () => {
    assert.deepEqual(displaySize(200, 100, 0), { w: 200, h: 100 })
    assert.deepEqual(displaySize(200, 100, 90), { w: 100, h: 200 })
    assert.deepEqual(displaySize(200, 100, 180), { w: 200, h: 100 })
    assert.deepEqual(displaySize(200, 100, 270), { w: 100, h: 200 })
  })

  it('masterBBoxToPdfText: known bbox → exact PDF point (rotation 0, scale 1)', () => {
    // Master 200×100, word at (20,10) size 40×20.
    // PDF origin bottom-left: y = 100 - (10+20) = 70, x = 20.
    const place = masterBBoxToPdfText({ x: 20, y: 10, w: 40, h: 20 }, 200, 100, 0, 1)
    assert.equal(place.x, 20)
    assert.equal(place.y, 70)
    assert.equal(place.pageW, 200)
    assert.equal(place.pageH, 100)
    assert.ok(Math.abs(place.size - 18) < 1e-9) // 20 * 0.9
  })

  it('masterBBoxToPdfText: scale multiplies points', () => {
    const place = masterBBoxToPdfText({ x: 10, y: 10, w: 10, h: 10 }, 100, 100, 0, 0.5)
    assert.equal(place.x, 5)
    assert.equal(place.y, (100 - 20) * 0.5) // 40
    assert.equal(place.pageW, 50)
    assert.equal(place.pageH, 50)
  })

  it('90°: page dimensions swap and corners map to finite coords', () => {
    const place = masterBBoxToPdfText({ x: 0, y: 0, w: 10, h: 10 }, 200, 100, 90, 1)
    assert.equal(place.pageW, 100)
    assert.equal(place.pageH, 200)
    assert.ok(Number.isFinite(place.x))
    assert.ok(Number.isFinite(place.y))
  })
})
