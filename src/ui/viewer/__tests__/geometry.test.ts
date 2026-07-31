/**
 * Geometry invariant tests — coordinate round-trip and concrete 90° mapping.
 * Run: node --experimental-strip-types --test src/ui/viewer/__tests__/*.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { BBox, Rotation } from '../../../shared/types.ts'
import {
  masterBoxToScreen,
  screenBoxToMaster,
  screenPointToMaster,
  masterPointToScreen,
  type ViewportTransform,
} from '../geometry.ts'

const MASTER_W = 200
const MASTER_H = 100
const ROTATIONS: Rotation[] = [0, 90, 180, 270]
const ZOOMS = [0.5, 1, 2]

function almostEqual(a: number, b: number, tol = 1): void {
  assert.ok(
    Math.abs(a - b) <= tol,
    `expected ${a} ≈ ${b} (tol ${tol}), delta ${Math.abs(a - b)}`,
  )
}

function boxesClose(a: BBox, b: BBox, tol = 1): void {
  almostEqual(a.x, b.x, tol)
  almostEqual(a.y, b.y, tol)
  almostEqual(a.w, b.w, tol)
  almostEqual(a.h, b.h, tol)
}

describe('coordinate round-trip (geometry invariant)', () => {
  it('maps stored-master box → screen → master within 1px for all rotations and zooms', () => {
    const original: BBox = { x: 20, y: 10, w: 40, h: 30 }
    const panVariants: ViewportTransform[] = [
      { zoom: 1, panX: 0, panY: 0 },
      { zoom: 1, panX: 15, panY: -8 },
    ]

    for (const rotation of ROTATIONS) {
      for (const zoom of ZOOMS) {
        for (const pan of panVariants) {
          const t: ViewportTransform = { zoom, panX: pan.panX, panY: pan.panY }
          const screen = masterBoxToScreen(original, MASTER_W, MASTER_H, rotation, t)
          const back = screenBoxToMaster(screen, MASTER_W, MASTER_H, rotation, t)
          boxesClose(back, original, 1)
        }
      }
    }
  })

  it('point round-trip across rotations and zooms', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: MASTER_W, y: MASTER_H },
      { x: 50, y: 25 },
      { x: MASTER_W / 2, y: MASTER_H / 2 },
    ]
    for (const rotation of ROTATIONS) {
      for (const zoom of ZOOMS) {
        const t: ViewportTransform = { zoom, panX: 3, panY: 7 }
        for (const p of pts) {
          const s = masterPointToScreen(p.x, p.y, MASTER_W, MASTER_H, rotation, t)
          const m = screenPointToMaster(s.x, s.y, MASTER_W, MASTER_H, rotation, t)
          almostEqual(m.x, p.x, 1e-9)
          almostEqual(m.y, p.y, 1e-9)
        }
      }
    }
  })
})

describe('90° region maps to concrete stored-master box', () => {
  it('screen selection on a 90°-rotated image yields exact master coordinates', () => {
    // Master image 200×100. CSS rotate(90) → display AABB is 100×200.
    // A unit square at master (0,0) (top-left corner of the file) maps under
    // CSS 90° around center (100, 50):
    //   dx=-100, dy=-50 → rx=50, ry=-100 → display (50+50, -100+100) = (100, 0)
    // We assert a full selection region with concrete numbers.
    const masterW = 200
    const masterH = 100
    const rotation: Rotation = 90
    const t: ViewportTransform = { zoom: 1, panX: 0, panY: 0 }

    // Screen box covering the top-left 20×30 of the *displayed* rotated image.
    const screenSel: BBox = { x: 0, y: 0, w: 20, h: 30 }
    const master = screenBoxToMaster(screenSel, masterW, masterH, rotation, t)

    // Inverse: display (0,0) → center-relative (-50, -100)
    //   dx = -50*0 + (-100)*1 = -100
    //   dy = -(-50)*1 + (-100)*0 = 50
    //   master = (-100+100, 50+50) = (0, 100)
    // display (20,0) → ...
    // Corners of screen (0,0)-(20,30) map to master; AABB:
    // (0,0) → (0, 100)
    // (20,0) → (0, 80)
    // (0,30) → (30, 100)
    // (20,30) → (30, 80)
    // AABB: x=0, y=80, w=30, h=20
    assert.equal(Math.round(master.x), 0)
    assert.equal(Math.round(master.y), 80)
    assert.equal(Math.round(master.w), 30)
    assert.equal(Math.round(master.h), 20)

    // Round-trip the known master box back for extra certainty.
    const masterBox: BBox = { x: 0, y: 80, w: 30, h: 20 }
    const screen = masterBoxToScreen(masterBox, masterW, masterH, rotation, t)
    almostEqual(screen.x, 0, 1e-6)
    almostEqual(screen.y, 0, 1e-6)
    almostEqual(screen.w, 20, 1e-6)
    almostEqual(screen.h, 30, 1e-6)
  })

  it('with zoom 2, screen region scales correctly into master', () => {
    const masterW = 200
    const masterH = 100
    const rotation: Rotation = 90
    const t: ViewportTransform = { zoom: 2, panX: 0, panY: 0 }

    // Same visual region as above but at 2×: screen 0,0,40×60 → display 0,0,20×30
    const screenSel: BBox = { x: 0, y: 0, w: 40, h: 60 }
    const master = screenBoxToMaster(screenSel, masterW, masterH, rotation, t)
    assert.equal(Math.round(master.x), 0)
    assert.equal(Math.round(master.y), 80)
    assert.equal(Math.round(master.w), 30)
    assert.equal(Math.round(master.h), 20)
  })
})
