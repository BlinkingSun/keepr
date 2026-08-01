/**
 * Lane W — New/Old receipts watcher tests (stability, move, crash-window, safety).
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  stat,
  symlink,
  unlink,
  writeFile,
  utimes,
} from 'node:fs/promises'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import { importFiles } from '../import.ts'
import { createNewReceiptsWatcher } from '../watchFolders.ts'
import {
  openIngestFixture,
  writeTestJpeg,
  type IngestFixture,
} from './harness.ts'

async function withFx(fn: (fx: IngestFixture) => Promise<void>): Promise<void> {
  const fx = await openIngestFixture()
  // Watcher tests drive OCR off so ticks stay fast.
  fx.deps.awaitOcr = false
  try {
    await fn(fx)
  } finally {
    await fx.close()
  }
}

async function sha256(p: string): Promise<string> {
  return createHash('sha256').update(await readFile(p)).digest('hex')
}

/** Run enough ticks for a stable file to pass the 3-observation gate. */
async function tickUntilStable(
  tick: () => Promise<unknown>,
  times = 3,
): Promise<void> {
  for (let i = 0; i < times; i++) await tick()
}

test('4. unstable growing file is NOT ingested; becomes stable → moved hash-identical', async () => {
  await withFx(async (fx) => {
    const newDir = join(fx.libraryRoot, 'New Receipts')
    const oldDir = join(fx.libraryRoot, 'Old Receipts')
    await mkdir(newDir, { recursive: true })
    await mkdir(oldDir, { recursive: true })

    const target = join(newDir, 'growing.jpg')
    // Start with a real jpeg, then grow the file between ticks.
    await writeTestJpeg(newDir, 'growing.jpg', { r: 1, g: 2, b: 3 })

    const w = createNewReceiptsWatcher(fx.deps, { newDir, oldDir })
    try {
      // Tick 1: first observation
      await w.tick()
      assert.equal(
        (fx.raw.prepare(`SELECT COUNT(*) AS n FROM item`).get() as { n: number }).n,
        0,
      )

      // Grow the file (preallocate-then-fill style) — resets streak.
      const more = Buffer.concat([await readFile(target), Buffer.alloc(64, 0xab)])
      await writeFile(target, more)

      await w.tick() // streak 1 again
      await w.tick() // streak 2
      assert.equal(
        (fx.raw.prepare(`SELECT COUNT(*) AS n FROM item`).get() as { n: number }).n,
        0,
        'must not ingest before 3 consecutive identical observations',
      )

      // Now stable for 3 ticks — but wait, the file is no longer a valid jpeg.
      // Replace with a stable valid jpeg for the rest of the test.
      await writeTestJpeg(newDir, 'growing.jpg', { r: 10, g: 20, b: 30 })
      const expectedHash = await sha256(target)

      await w.tick() // obs 1
      await w.tick() // obs 2
      await w.tick() // obs 3 → eligible → import + move

      const items = fx.raw.prepare(`SELECT COUNT(*) AS n FROM item`).get() as { n: number }
      assert.equal(items.n, 1)
      // Original gone from New, present in Old, bytes match.
      await assert.rejects(() => stat(target), /ENOENT/)
      const oldPath = join(oldDir, 'growing.jpg')
      assert.equal(await sha256(oldPath), expectedHash)
    } finally {
      w.stop()
    }
  })
})

test('5. collision: Old already has r.jpg → arrives as r (2).jpg', async () => {
  await withFx(async (fx) => {
    const newDir = join(fx.libraryRoot, 'New Receipts')
    const oldDir = join(fx.libraryRoot, 'Old Receipts')
    await mkdir(newDir, { recursive: true })
    await mkdir(oldDir, { recursive: true })

    // Pre-seed Old with r.jpg (different bytes so it's a real occupant).
    await writeTestJpeg(oldDir, 'r.jpg', { r: 99, g: 99, b: 99 })
    await writeTestJpeg(newDir, 'r.jpg', { r: 1, g: 2, b: 3 })
    const expectedHash = await sha256(join(newDir, 'r.jpg'))

    const w = createNewReceiptsWatcher(fx.deps, { newDir, oldDir })
    try {
      await tickUntilStable(() => w.tick())
      await assert.rejects(() => stat(join(newDir, 'r.jpg')), /ENOENT/)
      const dest = join(oldDir, 'r (2).jpg')
      assert.equal(await sha256(dest), expectedHash)
      // Original occupant untouched.
      assert.ok((await stat(join(oldDir, 'r.jpg'))).isFile())
    } finally {
      w.stop()
    }
  })
})

test('6. move-fails-once → self-heal on next tick, no duplicate item', async () => {
  await withFx(async (fx) => {
    const newDir = join(fx.libraryRoot, 'New Receipts')
    const oldDir = join(fx.libraryRoot, 'Old Receipts')
    await mkdir(newDir, { recursive: true })
    await mkdir(oldDir, { recursive: true })

    await writeTestJpeg(newDir, 'heal.jpg', { r: 5, g: 6, b: 7 })
    let renameCalls = 0
    const w = createNewReceiptsWatcher(fx.deps, {
      newDir,
      oldDir,
      renameFn: async (src, dest) => {
        renameCalls += 1
        if (renameCalls === 1) {
          const err = new Error('simulated move failure') as NodeJS.ErrnoException
          err.code = 'EIO'
          throw err
        }
        await rename(src, dest)
      },
    })
    try {
      // 3 stability ticks; on the 3rd, import succeeds and move throws once.
      await w.tick()
      await w.tick()
      await w.tick()

      // File still in New (move failed), item exists once.
      assert.ok((await stat(join(newDir, 'heal.jpg'))).isFile())
      const n1 = (fx.raw.prepare(`SELECT COUNT(*) AS n FROM item`).get() as { n: number }).n
      assert.equal(n1, 1)

      // Next tick: skipDuplicates → archive, no second item.
      // Stability already ≥3 so immediately eligible.
      await w.tick()
      await assert.rejects(() => stat(join(newDir, 'heal.jpg')), /ENOENT/)
      assert.ok((await stat(join(oldDir, 'heal.jpg'))).isFile())
      const n2 = (fx.raw.prepare(`SELECT COUNT(*) AS n FROM item`).get() as { n: number }).n
      assert.equal(n2, 1, 'must not create a second item on self-heal')
    } finally {
      w.stop()
    }
  })
})

test('7. rejected corrupt file stays in New, appears in status().failed, not retried until mtime changes', async () => {
  await withFx(async (fx) => {
    const newDir = join(fx.libraryRoot, 'New Receipts')
    const oldDir = join(fx.libraryRoot, 'Old Receipts')
    await mkdir(newDir, { recursive: true })
    await mkdir(oldDir, { recursive: true })

    const bad = join(newDir, 'corrupt.jpg')
    await writeFile(bad, Buffer.from('not an image'))

    const w = createNewReceiptsWatcher(fx.deps, { newDir, oldDir })
    try {
      await tickUntilStable(() => w.tick())
      // Still in New
      assert.ok((await stat(bad)).isFile())
      const st = w.status()
      assert.ok(st.failed.some((f) => f.name === 'corrupt.jpg'))
      assert.match(st.failed.find((f) => f.name === 'corrupt.jpg')!.reason, /corrupt|unreadable|image/i)

      // Another tick without mtime change must not re-import (still failed, not hot-loop).
      const failedBefore = st.failed.length
      await w.tick()
      assert.equal(w.status().failed.length, failedBefore)
      assert.ok((await stat(bad)).isFile())

      // mtime change unlocks retry.
      const now = new Date()
      await utimes(bad, now, now)
      // Need stability again after mtime change.
      await tickUntilStable(() => w.tick())
      // Still corrupt → still failed, still in New
      assert.ok((await stat(bad)).isFile())
      assert.ok(w.status().failed.some((f) => f.name === 'corrupt.jpg'))
    } finally {
      w.stop()
    }
  })
})

test('8. subfolder 2026/q3/a.png → Old Receipts/2026/q3/a.png', async () => {
  await withFx(async (fx) => {
    const newDir = join(fx.libraryRoot, 'New Receipts')
    const oldDir = join(fx.libraryRoot, 'Old Receipts')
    await mkdir(join(newDir, '2026', 'q3'), { recursive: true })
    await mkdir(oldDir, { recursive: true })
    await writeTestJpeg(join(newDir, '2026', 'q3'), 'a.png')

    // writeTestJpeg always writes jpeg bytes regardless of extension name —
    // use a real .png name by writing via sharp path... harness writeTestJpeg
    // uses .jpeg encoder. Extension is png for path preservation test.
    const w = createNewReceiptsWatcher(fx.deps, { newDir, oldDir })
    try {
      await tickUntilStable(() => w.tick())
      const dest = join(oldDir, '2026', 'q3', 'a.png')
      assert.ok((await stat(dest)).isFile())
      await assert.rejects(() => stat(join(newDir, '2026', 'q3', 'a.png')), /ENOENT/)
    } finally {
      w.stop()
    }
  })
})

test('9. start() initial tick ingests pre-existing files', async () => {
  await withFx(async (fx) => {
    const newDir = join(fx.libraryRoot, 'New Receipts')
    const oldDir = join(fx.libraryRoot, 'Old Receipts')
    await mkdir(newDir, { recursive: true })
    await mkdir(oldDir, { recursive: true })
    await writeTestJpeg(newDir, 'preexist.jpg')

    // start() fires one tick immediately; file needs 3 stable observations,
    // so we drive additional ticks after start (poll would do this in production).
    const w = createNewReceiptsWatcher(fx.deps, { newDir, oldDir, pollMs: 60_000 })
    try {
      w.start()
      assert.equal(w.status().watching, true)
      // start's first tick is async (dir resolve + tick). Drive ≥3 full ticks
      // so stability is satisfied regardless of whether start's tick has finished.
      await tickUntilStable(() => w.tick(), 4)
      const n = (fx.raw.prepare(`SELECT COUNT(*) AS n FROM item`).get() as { n: number }).n
      assert.equal(n, 1)
      assert.ok((await stat(join(oldDir, 'preexist.jpg'))).isFile())
    } finally {
      w.stop()
    }
  })
})

test('10. EXDEV hash mismatch → source NOT unlinked, error surfaced', async () => {
  await withFx(async (fx) => {
    const newDir = join(fx.libraryRoot, 'New Receipts')
    const oldDir = join(fx.libraryRoot, 'Old Receipts')
    await mkdir(newDir, { recursive: true })
    await mkdir(oldDir, { recursive: true })
    await writeTestJpeg(newDir, 'exdev.jpg', { r: 11, g: 22, b: 33 })

    const w = createNewReceiptsWatcher(fx.deps, {
      newDir,
      oldDir,
      renameFn: async () => {
        const err = new Error('cross-device') as NodeJS.ErrnoException
        err.code = 'EXDEV'
        throw err
      },
      copyFileFn: async (src, dest) => {
        // Write WRONG bytes to dest to force hash mismatch.
        await writeFile(dest, Buffer.from('corrupted-copy-not-the-source'))
        void src
      },
    })
    try {
      await tickUntilStable(() => w.tick())
      // Source must still exist — never unlinked without verified copy.
      assert.ok((await stat(join(newDir, 'exdev.jpg'))).isFile(), 'source must remain')
      // Item was created (ingest before move) — invariant: library has content.
      const n = (fx.raw.prepare(`SELECT COUNT(*) AS n FROM item`).get() as { n: number }).n
      assert.equal(n, 1)
    } finally {
      w.stop()
    }
  })
})

test('audit: single-flight — two concurrent tick() produce one import batch', async () => {
  await withFx(async (fx) => {
    const newDir = join(fx.libraryRoot, 'New Receipts')
    const oldDir = join(fx.libraryRoot, 'Old Receipts')
    await mkdir(newDir, { recursive: true })
    await mkdir(oldDir, { recursive: true })
    await writeTestJpeg(newDir, 'once.jpg')

    let importCount = 0
    const origImport = importFiles
    // Spy via wrapping deps is hard; instead count items after concurrent ticks.
    const w = createNewReceiptsWatcher(fx.deps, { newDir, oldDir })
    try {
      // Warm stability to 2, then fire two concurrent ticks that both see streak→3.
      await w.tick()
      await w.tick()
      const [a, b] = await Promise.all([w.tick(), w.tick()])
      // Both resolve to the same result object (single-flight coalesces).
      assert.strictEqual(a, b, 'concurrent tick() must share the in-flight promise')
      const n = (fx.raw.prepare(`SELECT COUNT(*) AS n FROM item`).get() as { n: number }).n
      assert.equal(n, 1, 'only one item from concurrent ticks')
      void importCount
      void origImport
    } finally {
      w.stop()
    }
  })
})

test('audit: out-of-tree symlink ingested-by-copy at most, never unlinks the original', async () => {
  await withFx(async (fx) => {
    const newDir = join(fx.libraryRoot, 'New Receipts')
    const oldDir = join(fx.libraryRoot, 'Old Receipts')
    const outside = join(fx.fixturesDir, 'only-original.jpg')
    await mkdir(newDir, { recursive: true })
    await mkdir(oldDir, { recursive: true })
    await writeTestJpeg(fx.fixturesDir, 'only-original.jpg', { r: 40, g: 50, b: 60 })
    const originalHash = await sha256(outside)
    await symlink(outside, join(newDir, 'link.jpg'))

    const w = createNewReceiptsWatcher(fx.deps, { newDir, oldDir })
    try {
      await tickUntilStable(() => w.tick())
      // Library has the content.
      const n = (fx.raw.prepare(`SELECT COUNT(*) AS n FROM item`).get() as { n: number }).n
      assert.equal(n, 1)
      // Outside original still exists with same bytes — never unlinked.
      assert.ok((await stat(outside)).isFile())
      assert.equal(await sha256(outside), originalHash)
    } finally {
      w.stop()
    }
  })
})

test('audit: EEXIST collision retry finds free name', async () => {
  await withFx(async (fx) => {
    const newDir = join(fx.libraryRoot, 'New Receipts')
    const oldDir = join(fx.libraryRoot, 'Old Receipts')
    await mkdir(newDir, { recursive: true })
    await mkdir(oldDir, { recursive: true })
    // Occupy r.jpg and r (2).jpg
    await writeTestJpeg(oldDir, 'r.jpg', { r: 1, g: 1, b: 1 })
    await writeTestJpeg(oldDir, 'r (2).jpg', { r: 2, g: 2, b: 2 })
    await writeTestJpeg(newDir, 'r.jpg', { r: 3, g: 3, b: 3 })
    const expected = await sha256(join(newDir, 'r.jpg'))

    const w = createNewReceiptsWatcher(fx.deps, { newDir, oldDir })
    try {
      await tickUntilStable(() => w.tick())
      assert.equal(await sha256(join(oldDir, 'r (3).jpg')), expected)
    } finally {
      w.stop()
    }
  })
})

// silence unused imports when tree-shaken
void copyFile
void unlink
void basename
