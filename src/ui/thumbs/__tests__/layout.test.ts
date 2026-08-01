/**
 * Thumbnail layout math — column count with gap, fluid row height, mount budget.
 * Run: node --experimental-strip-types --test src/ui/thumbs/__tests__/layout.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  CAPTION_H,
  columnCount,
  colWidthFor,
  GAP,
  itemRangeForRows,
  layoutMetrics,
  MAX_MOUNTED_CARDS,
  MIN_CARD,
  rowHeightFor,
  thumbWindow,
} from '../thumbLayout.ts'

describe('columnCount (gap-aware)', () => {
  it('fits one column when width is just under 2×minCard+gap', () => {
    // Exactly 2 tracks need: 2*minCard + 1*gap
    const two = 2 * MIN_CARD + GAP // 380
    assert.equal(columnCount(two), 2)
    assert.equal(columnCount(two - 1), 1)
  })

  it('fits three columns at the exact boundary', () => {
    // 3*minCard + 2*gap = 3*184 + 24 = 576
    const three = 3 * MIN_CARD + 2 * GAP
    assert.equal(columnCount(three), 3)
    assert.equal(columnCount(three - 1), 2)
  })

  it('handles a mid-width example (900px)', () => {
    // floor((900 + 12) / (184 + 12)) = floor(912/196) = 4
    assert.equal(columnCount(900), 4)
  })

  it('handles ultrawide 3840', () => {
    // floor((3840 + 12) / 196) = floor(3852/196) = 19
    assert.equal(columnCount(3840), 19)
  })

  it('never returns less than 1', () => {
    assert.equal(columnCount(0), 1)
    assert.equal(columnCount(10), 1)
    assert.equal(columnCount(MIN_CARD), 1)
  })
})

describe('rowHeightFor (fluid 4:5)', () => {
  it('scales thumb height with column width', () => {
    const w1 = 184
    const w2 = 220
    const h1 = rowHeightFor(w1)
    const h2 = rowHeightFor(w2)
    // thumb = colW * 5/4; card = thumb + CAPTION; row = card + GAP
    assert.equal(h1, w1 * (5 / 4) + CAPTION_H + GAP)
    assert.equal(h2, w2 * (5 / 4) + CAPTION_H + GAP)
    assert.ok(h2 > h1)
  })

  it('two widths produce consistent windows (same overscan math path)', () => {
    const a = layoutMetrics(900, 10_000)
    const b = layoutMetrics(1280, 10_000)
    assert.notEqual(a.cols, b.cols)
    assert.notEqual(a.rowHeight, b.rowHeight)
    // rowCount = ceil(items/cols)
    assert.equal(a.rowCount, Math.ceil(10_000 / a.cols))
    assert.equal(b.rowCount, Math.ceil(10_000 / b.cols))
    // Wider → more cols → fewer rows → shorter total scroll
    assert.ok(b.totalHeight < a.totalHeight)
  })
})

describe('colWidthFor', () => {
  it('splits remaining width after gaps', () => {
    const cols = 4
    const width = 900
    const expected = (width - GAP * (cols - 1)) / cols
    assert.equal(colWidthFor(width, cols), expected)
  })
})

describe('thumbWindow — bounds and mount budget', () => {
  const viewportHeight = 800

  it('top of list: window starts at 0', () => {
    const tw = thumbWindow({
      width: 900,
      viewportHeight,
      scrollTop: 0,
      itemCount: 10_000,
    })
    assert.equal(tw.window.start, 0)
    assert.ok(tw.window.end > 0)
    assert.equal(tw.window.offsetY, 0)
    assert.ok(tw.mountedCardBudget < MAX_MOUNTED_CARDS)
  })

  it('middle of 10k: window is bounded', () => {
    const layout = layoutMetrics(900, 10_000)
    const midScroll = (layout.rowCount / 2) * layout.rowHeight
    const tw = thumbWindow({
      width: 900,
      viewportHeight,
      scrollTop: midScroll,
      itemCount: 10_000,
    })
    assert.ok(tw.window.start > 0)
    assert.ok(tw.window.end < layout.rowCount)
    assert.ok(
      tw.mountedCardBudget < 100,
      `mounted cards must be < 100, got ${tw.mountedCardBudget}`,
    )
  })

  it('bottom of 10k: window ends at last row', () => {
    const layout = layoutMetrics(900, 10_000)
    const tw = thumbWindow({
      width: 900,
      viewportHeight,
      scrollTop: layout.totalHeight,
      itemCount: 10_000,
    })
    assert.equal(tw.window.end, layout.rowCount)
    assert.ok(tw.window.start < tw.window.end)
    assert.ok(tw.mountedCardBudget < 100)
  })

  it('3840px × 10k items stays well under 100 mounted cards', () => {
    const positions = [0, 0.25, 0.5, 0.75, 1]
    for (const frac of positions) {
      const layout = layoutMetrics(3840, 10_000)
      const scrollTop = frac * Math.max(0, layout.totalHeight - viewportHeight)
      const tw = thumbWindow({
        width: 3840,
        viewportHeight,
        scrollTop,
        itemCount: 10_000,
      })
      assert.equal(tw.cols, 19)
      assert.ok(
        tw.mountedCardBudget < 100,
        `at frac=${frac}: mounted ${tw.mountedCardBudget} must be < 100 (rows=${tw.window.visibleCount} cols=${tw.cols})`,
      )
      // "well under" — leave clear headroom, not just 99.
      assert.ok(
        tw.mountedCardBudget <= 96,
        `at frac=${frac}: expected well under 100, got ${tw.mountedCardBudget}`,
      )
    }
  })

  it('empty list → zero window', () => {
    const tw = thumbWindow({
      width: 900,
      viewportHeight,
      scrollTop: 0,
      itemCount: 0,
    })
    assert.equal(tw.rowCount, 0)
    assert.equal(tw.window.visibleCount, 0)
    assert.equal(tw.totalHeight, 0)
  })
})

describe('itemRangeForRows', () => {
  it('maps row window to flat item indices', () => {
    // 10 items, 4 cols → rows 0:[0-3] 1:[4-7] 2:[8-9]
    assert.deepEqual(itemRangeForRows(0, 1, 4, 10), { start: 0, end: 4 })
    assert.deepEqual(itemRangeForRows(1, 3, 4, 10), { start: 4, end: 10 })
    assert.deepEqual(itemRangeForRows(2, 3, 4, 10), { start: 8, end: 10 })
  })
})
