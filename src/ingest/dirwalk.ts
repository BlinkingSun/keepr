/**
 * Recursive directory walk for importable receipt/document files.
 *
 * Safety:
 * - Cycle-safe via realpath visited-set on directories.
 * - Depth cap 25.
 * - Symlink containment: directory realpaths outside the walk root are refused.
 *   File entries are returned as paths under the root (never their outside
 *   realpath), so a symlink in New that points at a user's only original
 *   elsewhere is never returned as that outside path.
 * - Unsupported extensions are counted, not rejected.
 */

import { lstat, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'

const SUPPORTED_EXTS = new Set([
  'jpg',
  'jpeg',
  'png',
  'tif',
  'tiff',
  'bmp',
  'webp',
  'pdf',
  'vcf',
])

const IGNORE_NAMES = new Set(['desktop.ini', 'thumbs.db'])

const MAX_DEPTH = 25

export interface WalkForImportableResult {
  /** Absolute paths of importable files, deterministically sorted. */
  files: string[]
  /** Files under the root that are not importable (e.g. .txt notes). */
  skippedUnsupported: number
}

/**
 * Walk `root` recursively for importable files.
 * `root` itself may be a file (then returns that file alone if supported).
 */
export async function walkForImportable(root: string): Promise<WalkForImportableResult> {
  const absRoot = path.resolve(root)
  let rootReal: string
  try {
    rootReal = await realpath(absRoot)
  } catch {
    // Root missing: empty result (caller decides error vs empty).
    return { files: [], skippedUnsupported: 0 }
  }

  const st = await lstat(absRoot)
  if (st.isFile() || st.isSymbolicLink()) {
    // Single path: only treat as file if it is a regular file or a symlink to one.
    const name = path.basename(absRoot)
    if (isIgnoredName(name)) return { files: [], skippedUnsupported: 0 }
    const ext = extOf(name)
    if (!SUPPORTED_EXTS.has(ext)) {
      return { files: [], skippedUnsupported: 1 }
    }
    // Containment: if realpath escapes root's parent chain, still return the
    // path the caller gave (it is the entry itself). Callers that care about
    // move safety re-check realpath under their own root.
    return { files: [absRoot], skippedUnsupported: 0 }
  }

  if (!st.isDirectory()) {
    return { files: [], skippedUnsupported: 0 }
  }

  const files: string[] = []
  let skippedUnsupported = 0
  const visitedDirs = new Set<string>()
  visitedDirs.add(rootReal)

  async function walkDir(dirAbs: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return

    let entries: string[]
    try {
      entries = await readdir(dirAbs)
    } catch {
      return
    }
    entries.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

    for (const name of entries) {
      if (isIgnoredName(name)) continue

      const childAbs = path.join(dirAbs, name)
      let childStat
      try {
        childStat = await lstat(childAbs)
      } catch {
        continue
      }

      if (childStat.isDirectory()) {
        // Follow directory only if realpath stays under walk root.
        let childReal: string
        try {
          childReal = await realpath(childAbs)
        } catch {
          continue
        }
        if (!isPathInside(rootReal, childReal)) {
          // Symlink (or mount) escaping the walk root — refuse.
          continue
        }
        if (visitedDirs.has(childReal)) continue
        visitedDirs.add(childReal)
        await walkDir(childAbs, depth + 1)
        continue
      }

      if (childStat.isFile() || childStat.isSymbolicLink()) {
        // For symlinks-to-files: include the path UNDER the root (childAbs),
        // never the outside realpath. Import can still read content (copy);
        // the watcher refuses move/unlink of outside realpaths.
        if (childStat.isSymbolicLink()) {
          try {
            const targetReal = await realpath(childAbs)
            // Only require the target to be a file; outside-root is allowed
            // for content ingest-by-copy, but we still return childAbs.
            const targetStat = await lstat(targetReal)
            if (!targetStat.isFile()) continue
          } catch {
            continue
          }
        }

        const ext = extOf(name)
        if (!SUPPORTED_EXTS.has(ext)) {
          skippedUnsupported += 1
          continue
        }
        files.push(childAbs)
      }
    }
  }

  await walkDir(absRoot, 0)
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return { files, skippedUnsupported }
}

/**
 * True if `candidate` is equal to or nested under `root`.
 * Both sides are path.resolve'd; callers that care about macOS /var → /private/var
 * should pass realpath'd roots (the watcher does).
 */
export function isPathInside(root: string, candidate: string): boolean {
  const r = path.resolve(root)
  const c = path.resolve(candidate)
  if (c === r) return true
  const prefix = r.endsWith(path.sep) ? r : r + path.sep
  return c.startsWith(prefix)
}

function isIgnoredName(name: string): boolean {
  if (!name || name === '.' || name === '..') return true
  if (name.startsWith('.')) return true
  if (IGNORE_NAMES.has(name.toLowerCase())) return true
  return false
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  if (i <= 0) return ''
  return name.slice(i + 1).toLowerCase()
}
