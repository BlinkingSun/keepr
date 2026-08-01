/**
 * New Receipts → Old Receipts watched-folder service.
 *
 * Pure Node. No Electron imports. Timers via setInterval + debounced fs.watch
 * hints, but ALL behavior is drivable through tick() with a fake now so tests
 * never sleep.
 *
 * INVARIANT: a file reaches Old Receipts if and only if its content is committed
 * to the library. importFiles NEVER moves anything; only this watcher moves,
 * and only after item-created-or-confirmed-duplicate.
 *
 * Safety (audit-rated file-loss bugs):
 * - Symlink containment: never move/unlink a path whose realpath escapes newDir.
 * - Serialize per-file import → verify → move.
 * - Collision naming uses exclusive-create retry (wx / COPYFILE_EXCL), never
 *   check-then-rename.
 * - Stability gate = 3 consecutive identical (size, mtimeMs) observations.
 * - Single-flight tick: concurrent tick() callers await the in-flight pass.
 * - EXDEV: copy → verify size + sha256 → only then unlink. NEVER unlink an
 *   unverified copy.
 */

import { createHash } from 'node:crypto'
import {
  constants,
  watch as fsWatch,
  type FSWatcher,
} from 'node:fs'
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
} from 'node:fs/promises'
import path from 'node:path'
import { isPathInside, walkForImportable } from './dirwalk.ts'
import { importFiles } from './import.ts'
import type { IngestDeps } from './types.ts'

export type TickResult = {
  ingested: number
  duplicates: number
  failed: number
  /** Files seen but not yet stable enough to import. */
  pending: number
  /** Files successfully archived to oldDir this tick. */
  moved: number
}

export type WatcherActivity = {
  ingested: number
  duplicates: number
  failed: number
}

export type WatcherStatus = {
  watching: boolean
  pendingCount: number
  failed: Array<{ name: string; reason: string }>
}

export type WatchFoldersOpts = {
  newDir: string
  oldDir: string
  /** Poll interval ms. Default 4000. */
  pollMs?: number
  /** Injectable clock (tests). */
  now?: () => number
  /**
   * Injectable rename for crash-window tests. Defaults to fs.promises.rename.
   * Called with (src, dest). May throw once etc.
   */
  renameFn?: (src: string, dest: string) => Promise<void>
  /**
   * Injectable copyFile. Defaults to fs.promises.copyFile.
   * Used by EXDEV fallback and exclusive-create collision path.
   */
  copyFileFn?: (src: string, dest: string, mode?: number) => Promise<void>
  /** Injectable unlink. Defaults to fs.promises.unlink. */
  unlinkFn?: (p: string) => Promise<void>
  /** Debounce for fs.watch hints. Default 500ms. */
  watchDebounceMs?: number
}

type StabilityObs = {
  size: number
  mtimeMs: number
  /** How many consecutive ticks observed this exact (size, mtimeMs). */
  streak: number
}

type FailedEntry = {
  name: string
  reason: string
  /** mtimeMs at failure — retry only when mtime changes. */
  mtimeMs: number
}

const STABILITY_REQUIRED = 3

export function createNewReceiptsWatcher(
  deps: IngestDeps,
  opts: WatchFoldersOpts,
): {
  start(): void
  stop(): void
  tick(): Promise<TickResult>
  status(): WatcherStatus
  onActivity(fn: (e: WatcherActivity) => void): () => void
} {
  // path.resolve alone is not enough on macOS: /var is a symlink to /private/var,
  // so realpath(file) would "escape" a non-real newDir and block every archive.
  let newDir = path.resolve(opts.newDir)
  let oldDir = path.resolve(opts.oldDir)
  let dirsResolved = false
  const pollMs = opts.pollMs ?? 4000
  const watchDebounceMs = opts.watchDebounceMs ?? 500
  const nowFn = opts.now ?? (() => Date.now())
  const renameFn = opts.renameFn ?? rename
  const copyFileFn = opts.copyFileFn ?? copyFile
  const unlinkFn = opts.unlinkFn ?? unlink

  let watching = false
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let watchHintTimer: ReturnType<typeof setTimeout> | null = null
  let fsWatcher: FSWatcher | null = null

  /** Single-flight: concurrent tick() await this. */
  let inFlight: Promise<TickResult> | null = null
  let processingCount = 0

  const stability = new Map<string, StabilityObs>()
  const failedMap = new Map<string, FailedEntry>()
  const activityListeners = new Set<(e: WatcherActivity) => void>()

  function emitActivity(e: WatcherActivity): void {
    for (const fn of activityListeners) {
      try {
        fn(e)
      } catch {
        /* listener errors must not break the watcher */
      }
    }
  }

  async function ensureDirsResolved(): Promise<void> {
    await mkdir(newDir, { recursive: true })
    await mkdir(oldDir, { recursive: true })
    if (!dirsResolved) {
      newDir = await realpath(newDir)
      oldDir = await realpath(oldDir)
      dirsResolved = true
    }
  }

  async function runTick(): Promise<TickResult> {
    await ensureDirsResolved()

    const walked = await walkForImportable(newDir)
    const result: TickResult = {
      ingested: 0,
      duplicates: 0,
      failed: 0,
      pending: 0,
      moved: 0,
    }

    // Drop stability/failed entries for paths that vanished.
    const present = new Set(walked.files)
    for (const key of stability.keys()) {
      if (!present.has(key)) stability.delete(key)
    }
    for (const key of failedMap.keys()) {
      if (!present.has(key)) failedMap.delete(key)
    }

    // Stability pass: update observations, collect eligible.
    const eligible: string[] = []
    for (const filePath of walked.files) {
      let st
      try {
        st = await stat(filePath)
      } catch {
        continue
      }
      const size = st.size
      const mtimeMs = st.mtimeMs

      const prevFailed = failedMap.get(filePath)
      if (prevFailed && prevFailed.mtimeMs === mtimeMs) {
        // Hot-loop guard: do not retry until mtime changes.
        result.failed += 1
        continue
      }
      if (prevFailed && prevFailed.mtimeMs !== mtimeMs) {
        failedMap.delete(filePath)
      }

      const prev = stability.get(filePath)
      if (!prev || prev.size !== size || prev.mtimeMs !== mtimeMs) {
        stability.set(filePath, { size, mtimeMs, streak: 1 })
        result.pending += 1
        continue
      }
      const streak = prev.streak + 1
      stability.set(filePath, { size, mtimeMs, streak })
      if (streak < STABILITY_REQUIRED) {
        result.pending += 1
        continue
      }
      eligible.push(filePath)
    }

    // Serialize per-file: import → on success move. Never batch-move after
    // a bulk import (crash mid-batch would leave partial state harder to reason).
    for (const filePath of eligible) {
      try {
      // Containment: refuse to operate on anything whose path string escapes newDir.
      if (!isPathInside(newDir, filePath)) {
        recordFailed(filePath, 'path escapes New Receipts directory')
        result.failed += 1
        continue
      }

      // Symlink / realpath containment for move/unlink safety.
      const moveSafe = await isMoveSafe(filePath, newDir)

      processingCount += 1
      let importResult
      try {
        importResult = await importFiles(deps, {
          paths: [filePath],
          toInbox: true,
          skipDuplicates: true,
          awaitOcr: false,
        })
      } catch (e: unknown) {
        const reason = e instanceof Error ? e.message : String(e)
        await recordFailedFromStat(filePath, reason)
        result.failed += 1
        continue
      }

      const wasRejected = (importResult.rejected?.length ?? 0) > 0
      const wasDup = (importResult.duplicates?.length ?? 0) > 0
      const wasCreated = (importResult.itemIds?.length ?? 0) > 0

      if (wasRejected && !wasDup && !wasCreated) {
        const reason = importResult.rejected![0]?.reason ?? 'rejected'
        await recordFailedFromStat(filePath, reason)
        result.failed += 1
        continue
      }

      // Success = item created OR confirmed duplicate. Only then may we archive.
      if (!wasCreated && !wasDup) {
        await recordFailedFromStat(filePath, 'import produced neither item nor duplicate')
        result.failed += 1
        continue
      }

      if (wasCreated) result.ingested += 1
      if (wasDup) result.duplicates += 1

      if (!moveSafe.ok) {
        // Content is in the library; the original outside newDir must never be
        // moved or unlinked. Leave the in-tree symlink/entry and stop retrying
        // until mtime changes — treat as a soft failure surface for status.
        await recordFailedFromStat(
          filePath,
          moveSafe.reason ?? 'refusing to move path whose realpath escapes New Receipts',
        )
        result.failed += 1
        // Still notify activity for the ingest/duplicate side.
        continue
      }

      try {
        await archiveToOld(filePath, newDir, oldDir, {
          renameFn,
          copyFileFn,
          unlinkFn,
        })
        result.moved += 1
        stability.delete(filePath)
        failedMap.delete(filePath)
      } catch (e: unknown) {
        // Crash window: ingest succeeded, move failed. File stays in New.
        // Next tick: skipDuplicates confirms content present → archive, no 2nd item.
        const reason = e instanceof Error ? e.message : String(e)
        // Do NOT put in failedMap with permanent mtime lock for transient move
        // errors — allow retry next tick. Only leave the file in New.
        // Record a transient note? Spec: retry on next tick for move failure.
        // failedMap is for rejected/corrupt which should not hot-loop.
        // Move failures: leave stability at required so next tick retries immediately.
        void reason
        void nowFn
      }
      } finally {
        // Every exit from this iteration — four continues, the normal end, or a
        // throw — must decrement exactly once. The first attempt scattered a
        // decrement per exit and the cycle-1 confirmation caught the count as
        // declared-but-never-set; finally makes the invariant structural.
        processingCount -= 1
      }
    }

    emitActivity({
      ingested: result.ingested,
      duplicates: result.duplicates,
      failed: result.failed,
    })
    return result
  }

  async function recordFailedFromStat(filePath: string, reason: string): Promise<void> {
    let mtimeMs = 0
    try {
      mtimeMs = (await stat(filePath)).mtimeMs
    } catch {
      mtimeMs = 0
    }
    recordFailed(filePath, reason, mtimeMs)
  }

  function recordFailed(filePath: string, reason: string, mtimeMs = 0): void {
    failedMap.set(filePath, {
      name: path.relative(newDir, filePath) || path.basename(filePath),
      reason,
      mtimeMs,
    })
  }

  function tick(): Promise<TickResult> {
    if (inFlight) return inFlight
    inFlight = runTick().finally(() => {
      inFlight = null
      processingCount = 0
    })
    return inFlight
  }

  function start(): void {
    if (watching) return
    watching = true
    // Immediate tick — files dropped while the app was closed are picked up.
    // Resolve dirs first so fs.watch attaches to the real path.
    void ensureDirsResolved()
      .then(() => tick())
      .catch(() => {
        /* first-tick errors surface via status on subsequent ticks */
      })
    pollTimer = setInterval(() => {
      void tick()
    }, pollMs)
    // Unref so the timer does not keep the process alive in tests/CLI.
    if (typeof pollTimer === 'object' && pollTimer && 'unref' in pollTimer) {
      ;(pollTimer as NodeJS.Timeout).unref()
    }

    try {
      // fs.watch is a hint only; behavior must not depend on it.
      // newDir may still be unresolved here; watch the resolved path after ensure.
      fsWatcher = fsWatch(path.resolve(opts.newDir), { recursive: true }, () => {
        if (watchHintTimer) clearTimeout(watchHintTimer)
        watchHintTimer = setTimeout(() => {
          watchHintTimer = null
          void tick()
        }, watchDebounceMs)
        if (watchHintTimer && typeof watchHintTimer === 'object' && 'unref' in watchHintTimer) {
          ;(watchHintTimer as NodeJS.Timeout).unref()
        }
      })
      if (typeof (fsWatcher as { unref?: () => void }).unref === 'function') {
        ;(fsWatcher as { unref: () => void }).unref()
      }
    } catch {
      // watch may fail on some platforms; poll alone is sufficient.
      fsWatcher = null
    }
  }

  function stop(): void {
    watching = false
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    if (watchHintTimer) {
      clearTimeout(watchHintTimer)
      watchHintTimer = null
    }
    if (fsWatcher) {
      try {
        fsWatcher.close()
      } catch {
        /* ignore */
      }
      fsWatcher = null
    }
  }

  function status(): WatcherStatus {
    return {
      watching,
      // Stabilising files PLUS anything mid-import/move. Counting only the
      // stability queue reported 0 while a large batch was actively being
      // ingested — a status that lies low exactly when the user is watching.
      pendingCount:
        [...stability.values()].filter((s) => s.streak < STABILITY_REQUIRED).length +
        processingCount,
      failed: [...failedMap.values()].map((f) => ({ name: f.name, reason: f.reason })),
    }
  }

  function onActivity(fn: (e: WatcherActivity) => void): () => void {
    activityListeners.add(fn)
    return () => {
      activityListeners.delete(fn)
    }
  }

  return { start, stop, tick, status, onActivity }
}

/* ---------------------------------------------------------------------------
 * Move safety + exclusive collision archive
 * ------------------------------------------------------------------------ */

async function isMoveSafe(
  filePath: string,
  newDir: string,
): Promise<{ ok: boolean; reason?: string }> {
  // Path string must live under newDir.
  if (!isPathInside(newDir, filePath)) {
    return { ok: false, reason: 'path escapes New Receipts directory' }
  }

  let lst
  try {
    lst = await lstat(filePath)
  } catch (e: unknown) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }

  // Symlink under newDir: we may rename/unlink the link itself (not the target).
  // That is safe. We still verify the link path is under newDir (already done).
  if (lst.isSymbolicLink()) {
    // Do NOT follow for move/unlink of the target. Archive the link only.
    // ok = true means we operate on filePath (the link), never on realpath.
    return { ok: true }
  }

  // Regular file: realpath must stay under newDir (hardlinks / odd mounts).
  try {
    const rp = await realpath(filePath)
    if (!isPathInside(newDir, rp)) {
      return {
        ok: false,
        reason: 'realpath escapes New Receipts directory',
      }
    }
  } catch (e: unknown) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }

  return { ok: true }
}

/**
 * Move filePath into oldDir, preserving the relative subpath under newDir.
 * Collision → name (2).ext, (3), … via exclusive-create retry loop.
 */
async function archiveToOld(
  filePath: string,
  newDir: string,
  oldDir: string,
  io: {
    renameFn: (src: string, dest: string) => Promise<void>
    copyFileFn: (src: string, dest: string, mode?: number) => Promise<void>
    unlinkFn: (p: string) => Promise<void>
  },
): Promise<string> {
  const rel = path.relative(newDir, filePath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('refusing to archive path outside New Receipts')
  }

  const destDir = path.join(oldDir, path.dirname(rel))
  await mkdir(destDir, { recursive: true })

  const base = path.basename(filePath)
  const ext = path.extname(base)
  const stem = ext ? base.slice(0, -ext.length) : base

  // Exclusive-create retry: try dest, then stem (2).ext, (3), …
  for (let n = 0; n < 10_000; n++) {
    const name = n === 0 ? base : `${stem} (${n + 1})${ext}`
    const dest = path.join(destDir, name)

    try {
      await exclusiveMove(filePath, dest, io)
      return dest
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException
      if (err && err.code === 'EEXIST') {
        continue
      }
      throw e
    }
  }
  throw new Error(`could not find free name for ${base} in Old Receipts`)
}

/**
 * Move src → dest. Prefer rename; on EXDEV: copy → verify size+sha256 → unlink
 * src. NEVER unlink an unverified copy.
 *
 * Exclusive: claim dest with open('wx') first so two concurrent archives cannot
 * clobber the same name (no check-then-rename race). rename onto the claim file
 * replaces it atomically on POSIX; on EXDEV we overwrite the claim via copy and
 * verify before unlinking src.
 */
async function exclusiveMove(
  src: string,
  dest: string,
  io: {
    renameFn: (src: string, dest: string) => Promise<void>
    copyFileFn: (src: string, dest: string, mode?: number) => Promise<void>
    unlinkFn: (p: string) => Promise<void>
  },
): Promise<void> {
  // Claim dest exclusively with O_EXCL so collision races fail with EEXIST.
  try {
    const fh = await open(dest, 'wx')
    await fh.close()
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException
    if (err && err.code === 'EEXIST') throw e
    throw e
  }

  // We hold an exclusive empty dest. rename(src, dest) replaces it on same FS.
  try {
    await io.renameFn(src, dest)
    return
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException
    if (err && err.code === 'EXDEV') {
      // Cross-device: overwrite the empty claim with a verified copy, then unlink src.
      await copyVerifyUnlink(src, dest, io, { destAlreadyClaimed: true })
      return
    }
    // rename failed for another reason — release the claim name.
    try {
      await io.unlinkFn(dest)
    } catch {
      /* ignore */
    }
    throw e
  }
}

async function copyVerifyUnlink(
  src: string,
  dest: string,
  io: {
    copyFileFn: (src: string, dest: string, mode?: number) => Promise<void>
    unlinkFn: (p: string) => Promise<void>
  },
  opts: { destAlreadyClaimed?: boolean } = {},
): Promise<void> {
  if (opts.destAlreadyClaimed) {
    // Overwrite the empty exclusive claim file with real bytes.
    await io.copyFileFn(src, dest)
  } else {
    const excl = constants.COPYFILE_EXCL ?? 1
    try {
      await io.copyFileFn(src, dest, excl)
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException
      if (err && err.code === 'EEXIST') throw e
      await io.copyFileFn(src, dest)
    }
  }

  // Verify size + sha256 BEFORE unlinking source.
  const srcStat = await stat(src)
  const destStat = await stat(dest)
  if (srcStat.size !== destStat.size) {
    try {
      await io.unlinkFn(dest)
    } catch {
      /* best-effort remove bad copy */
    }
    throw new Error(
      `EXDEV copy size mismatch: src ${srcStat.size} != dest ${destStat.size}; source NOT unlinked`,
    )
  }

  const srcHash = await sha256File(src)
  const destHash = await sha256File(dest)
  if (srcHash !== destHash) {
    try {
      await io.unlinkFn(dest)
    } catch {
      /* best-effort remove bad copy */
    }
    throw new Error(
      `EXDEV copy hash mismatch: source NOT unlinked (src=${srcHash.slice(0, 12)}… dest=${destHash.slice(0, 12)}…)`,
    )
  }

  // Verified — only now may we remove the source.
  await io.unlinkFn(src)
}

async function sha256File(absPath: string): Promise<string> {
  const buf = await readFile(absPath)
  return createHash('sha256').update(buf).digest('hex')
}
