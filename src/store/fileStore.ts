/**
 * KeepR file store — Lane 0, owned by the orchestrator.
 *
 * Every image byte in the library passes through here. Feature lanes never join
 * paths themselves, because that is precisely how absolute paths leak into the
 * database and make a library non-portable: a backup taken on this Mac would
 * restore to dead references on the Windows machine.
 *
 * Layout, relative to the library root:
 *
 *   images/<hash[0:2]>/<hash[2:4]>/<hash>.<ext>
 *
 * Content-addressed, which buys two things for free. Importing the same receipt
 * twice stores one file. And the hash IS the citation proof that acceptance #7
 * requires — three split children pointing at one image is verifiable rather
 * than assumed.
 *
 * Because files are shared, deletion is REFERENCE COUNTED. `release` asks how
 * many page rows still cite the path and only unlinks at zero. Unlinking on
 * first release would blank the image for a split receipt's remaining siblings.
 */
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { FileStore, LibraryRelPath, Sha256 } from '../shared/types.ts'
import { asRelPath } from '../shared/types.ts'

/** How many `page` rows still reference this relative path. Injected so the file
 *  store has no database dependency of its own. */
export type CitationCounter = (rel: LibraryRelPath) => number | Promise<number>

export interface FileStoreOptions {
  libraryRoot: string
  countCitations: CitationCounter
}

const EXT_ALLOW = new Set(['jpg', 'jpeg', 'png', 'tif', 'tiff', 'bmp', 'webp', 'pdf'])

export class DiskFileStore implements FileStore {
  readonly libraryRoot: string
  #countCitations: CitationCounter

  constructor(opts: FileStoreOptions) {
    if (!path.isAbsolute(opts.libraryRoot)) {
      throw new Error(`libraryRoot must be absolute, got ${opts.libraryRoot}`)
    }
    // Normalised and stripped of a trailing separator so the containment check
    // below cannot be defeated by a path like /library vs /library/.
    this.libraryRoot = path.resolve(opts.libraryRoot)
    this.#countCitations = opts.countCitations
  }

  /**
   * Relative path -> absolute path, refusing anything that escapes the library.
   * `asRelPath` already rejects the obvious cases, but this re-checks after
   * resolution: on Windows a path can escape through forms that a string test
   * does not catch, and this is the only place that turns library data into a
   * filesystem operation.
   */
  resolve(rel: LibraryRelPath): string {
    const abs = path.resolve(this.libraryRoot, rel)
    const root = this.libraryRoot + path.sep
    if (abs !== this.libraryRoot && !abs.startsWith(root)) {
      throw new Error(`path escapes the library root: ${rel}`)
    }
    return abs
  }

  async put(bytes: Buffer, ext: string): Promise<{ rel: LibraryRelPath; hash: Sha256 }> {
    const clean = ext.replace(/^\./, '').toLowerCase()
    if (!EXT_ALLOW.has(clean)) throw new Error(`unsupported extension: ${ext}`)

    const hash = createHash('sha256').update(bytes).digest('hex') as Sha256
    const rel = asRelPath(
      path.posix.join('images', hash.slice(0, 2), hash.slice(2, 4), `${hash}.${clean}`),
    )
    const abs = this.resolve(rel)

    // Already stored: identical content, so this is a no-op rather than a
    // rewrite. Two imports of the same receipt share one file.
    if (await this.#exists(abs)) return { rel, hash }

    await mkdir(path.dirname(abs), { recursive: true })
    // Write to a temp name in the same directory and rename into place, so a
    // crash mid-write cannot leave a truncated file sitting at a path the
    // database already believes is a complete image.
    const tmp = `${abs}.${process.pid}.tmp`
    await writeFile(tmp, bytes)
    await rename(tmp, abs)
    return { rel, hash }
  }

  async read(rel: LibraryRelPath): Promise<Buffer> {
    return readFile(this.resolve(rel))
  }

  async exists(rel: LibraryRelPath): Promise<boolean> {
    return this.#exists(this.resolve(rel))
  }

  /**
   * Drop one reference. Unlinks only when nothing cites the path any more.
   * Returns whether the bytes were actually removed, so callers can log a real
   * outcome instead of assuming.
   */
  async release(rel: LibraryRelPath): Promise<void> {
    await this.releaseWithResult(rel)
  }

  async releaseWithResult(rel: LibraryRelPath): Promise<{ unlinked: boolean; remainingCitations: number }> {
    const remaining = await this.#countCitations(rel)
    if (remaining > 0) return { unlinked: false, remainingCitations: remaining }

    const abs = this.resolve(rel)
    try {
      await unlink(abs)
      return { unlinked: true, remainingCitations: 0 }
    } catch (e: any) {
      // Already gone is success, not an error: the desired end state holds.
      if (e?.code === 'ENOENT') return { unlinked: false, remainingCitations: 0 }
      throw e
    }
  }

  /** Verifies stored bytes still match their content-addressed name. Used by the
   *  backup/restore integrity check, where "the file exists" is not enough — a
   *  silently corrupted image would pass an existence test. */
  async verify(rel: LibraryRelPath): Promise<{ ok: boolean; reason?: string }> {
    const expected = path.basename(rel).split('.')[0]
    try {
      const bytes = await this.read(rel)
      const actual = createHash('sha256').update(bytes).digest('hex')
      return actual === expected ? { ok: true } : { ok: false, reason: `content hash mismatch: expected ${expected}, got ${actual}` }
    } catch (e: any) {
      return { ok: false, reason: e?.code === 'ENOENT' ? 'missing' : String(e?.message ?? e) }
    }
  }

  async #exists(abs: string): Promise<boolean> {
    try {
      await access(abs, constants.F_OK)
      return true
    } catch {
      return false
    }
  }
}
