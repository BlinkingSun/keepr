/**
 * Regression: watcher status must not report pendingCount 0 while files are
 * actively mid-import. Found by the batch-2 execution audit; the first fix
 * declared the counter and never incremented it (a silent no-op string patch),
 * which the cycle-1 confirmation caught. The decrement is a per-iteration
 * finally, so every exit path — four continues, the normal end, a throw —
 * balances exactly once.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createContext } from '../../main/context.ts'
import { createNewReceiptsWatcher } from '../watchFolders.ts'
import { createImagePool, type ImagePool } from '../../workers/imagePool.ts'
import type { OcrProvider } from '../../shared/types.ts'
import sharp from 'sharp'

const stub: OcrProvider = {
  id: 's',
  async ocrPage(i) {
    return { text: 'X', words: [], confidence: 0.9, engine: 's', generation: i.generation, msElapsed: 1 }
  },
  async dispose() {},
}

test('pendingCount counts in-flight work, and settles to zero', async () => {
  const realPool = createImagePool()
  // Slow the SYNCHRONOUS import path (thumbnails are awaited inside importFiles;
  // OCR is not — the watcher imports with awaitOcr:false).
  const slowPool: ImagePool = new Proxy(realPool, {
    get(target, prop, receiver) {
      if (prop === 'thumbnail') {
        const slow: ImagePool['thumbnail'] = async (absPath, opts) => {
          await new Promise((r) => setTimeout(r, 300))
          return target.thumbnail(absPath, opts)
        }
        return slow
      }
      return Reflect.get(target, prop, receiver)
    },
  })
  const root = mkdtempSync(path.join(tmpdir(), 'keepr-pending-'))
  const ctx = createContext({ libraryRoot: path.join(root, 'lib'), skipSeed: true })
  const deps = { repos: ctx.repos, fileStore: ctx.fileStore, jobs: ctx.jobs, ocr: stub, imagePool: slowPool }
  const w = createNewReceiptsWatcher(deps as never, { newDir: ctx.newReceiptsDir, oldDir: ctx.oldReceiptsDir })

  const png = await sharp({ create: { width: 160, height: 200, channels: 3, background: { r: 245, g: 245, b: 245 } } })
    .png().toBuffer()
  for (const n of ['a', 'b']) writeFileSync(path.join(ctx.newReceiptsDir, `${n}.png`), png)

  await w.tick()
  await w.tick()
  const inFlight = w.tick() // third observation -> eligible -> slow import
  await new Promise((r) => setTimeout(r, 150))
  assert.ok(w.status().pendingCount > 0, 'status must reflect in-flight work')
  await inFlight
  assert.equal(w.status().pendingCount, 0, 'and settle to zero when done')
  w.stop()
  ctx.close()
})
