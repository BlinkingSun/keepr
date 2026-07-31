/**
 * Windowing math + 10k-row visible window bound.
 * Run: node --experimental-strip-types --test src/ui/grid/__tests__/windowing.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { computeWindow } from '../windowing.ts'

describe('computeWindow', () => {
  it('returns empty range for empty list', () => {
    const w = computeWindow({
      scrollTop: 0,
      viewportHeight: 400,
      rowHeight: 28,
      rowCount: 0,
      overscan: 5,
    })
    assert.equal(w.start, 0)
    assert.equal(w.end, 0)
    assert.equal(w.visibleCount, 0)
    assert.equal(w.totalHeight, 0)
    assert.equal(w.offsetY, 0)
  })

  it('starts at 0 at the very top', () => {
    const w = computeWindow({
      scrollTop: 0,
      viewportHeight: 280,
      rowHeight: 28,
      rowCount: 1000,
      overscan: 5,
    })
    // firstVisible=0, visible=10, overscan 5 → start 0, end 15
    assert.equal(w.start, 0)
    assert.equal(w.end, 15)
    assert.equal(w.offsetY, 0)
    assert.equal(w.totalHeight, 1000 * 28)
  })

  it('clamps at the very bottom', () => {
    const rowCount = 100
    const rowHeight = 28
    const viewportHeight = 280
    const scrollTop = rowCount * rowHeight // past the end
    const w = computeWindow({
      scrollTop,
      viewportHeight,
      rowHeight,
      rowCount,
      overscan: 5,
    })
    assert.ok(w.end === rowCount, `end should be ${rowCount}, got ${w.end}`)
    assert.ok(w.start >= 0)
    assert.ok(w.start < w.end, `start ${w.start} should be < end ${w.end}`)
    assert.ok(w.visibleCount <= 10 + 5 + 5 + 1) // viewport + overscan + clamp slack
  })

  it('mid-list window is firstVisible ± overscan', () => {
    const w = computeWindow({
      scrollTop: 28 * 50, // row 50 at top
      viewportHeight: 280, // 10 rows
      rowHeight: 28,
      rowCount: 200,
      overscan: 3,
    })
    assert.equal(w.start, 50 - 3)
    assert.equal(w.end, 50 + 10 + 3)
    assert.equal(w.offsetY, (50 - 3) * 28)
    assert.equal(w.visibleCount, 16)
  })

  it('10,000 rows produce a visible window well under 100', () => {
    // Typical desktop viewport ~800px, compact 28px rows, overscan 8 (panel default).
    const w = computeWindow({
      scrollTop: 28 * 5000,
      viewportHeight: 800,
      rowHeight: 28,
      rowCount: 10_000,
      overscan: 8,
    })
    assert.equal(w.totalHeight, 10_000 * 28)
    assert.ok(
      w.visibleCount < 100,
      `visible window must be < 100 for 10k rows, got ${w.visibleCount}`,
    )
    // Also assert a concrete bound so regressions are obvious.
    // ceil(800/28)=29 visible + 8*2 overscan = 45
    assert.ok(
      w.visibleCount <= 50,
      `expected ~45 rows, got ${w.visibleCount}`,
    )
    assert.ok(w.start >= 0)
    assert.ok(w.end <= 10_000)
  })
})
