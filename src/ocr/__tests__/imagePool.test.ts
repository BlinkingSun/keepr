/**
 * Image pool: concurrency, thumbnail max edge, abort of queued work.
 */
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createImagePool } from '../../workers/imagePool.ts'

const require = createRequire(import.meta.url)

describe('imagePool', () => {
  let dir: string
  let pngPath: string

  async function setup() {
    dir = await mkdtemp(path.join(tmpdir(), 'keepr-img-'))
    const sharp = require('sharp')
    const buf = await sharp({
      create: { width: 640, height: 480, channels: 3, background: { r: 20, g: 30, b: 40 } },
    })
      .png()
      .toBuffer()
    pngPath = path.join(dir, 'master.png')
    await writeFile(pngPath, buf)
  }

  after(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('decode returns dimensions of stored master', async () => {
    await setup()
    const pool = createImagePool({ concurrency: 2 })
    try {
      const meta = await pool.decode(pngPath)
      assert.equal(meta.width, 640)
      assert.equal(meta.height, 480)
    } finally {
      await pool.dispose()
    }
  })

  it('thumbnail max edge is 320', async () => {
    await setup()
    const pool = createImagePool({ concurrency: 2 })
    try {
      const thumb = await pool.thumbnail(pngPath)
      assert.ok(thumb.width <= 320)
      assert.ok(thumb.height <= 320)
      assert.equal(Math.max(thumb.width, thumb.height), 320)
      assert.equal(thumb.format, 'jpeg')
    } finally {
      await pool.dispose()
    }
  })

  it('rotate 90 swaps dimensions (explicit bake — not metadata-only)', async () => {
    await setup()
    const pool = createImagePool({ concurrency: 2 })
    try {
      const rot = await pool.rotate(pngPath, 90)
      assert.equal(rot.width, 480)
      assert.equal(rot.height, 640)
    } finally {
      await pool.dispose()
    }
  })

  it('abort cancels queued jobs', async () => {
    await setup()
    const pool = createImagePool({ concurrency: 1 })
    try {
      const ac = new AbortController()
      // Occupy the single slot
      const slow = pool.thumbnail(pngPath)
      const blocked = pool.thumbnail(pngPath, { signal: ac.signal })
      ac.abort()
      await assert.rejects(() => blocked, (e: Error) => e.name === 'AbortError')
      await slow
      assert.equal(pool.queued(), 0)
    } finally {
      await pool.dispose()
    }
  })
})
