/**
 * Small filesystem helpers for backup/restore/archive.
 * No npm archive libraries — only node:fs / node:crypto / node:zlib / node:path.
 */
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { readdir, readFile, stat, writeFile, mkdir, rm, copyFile } from 'node:fs/promises'
import path from 'node:path'
import { createGzip, createGunzip } from 'node:zlib'

export function sha256FileSync(absPath: string): string {
  const hash = createHash('sha256')
  hash.update(readFileSync(absPath))
  return hash.digest('hex')
}

export async function sha256File(absPath: string): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(absPath)
  for await (const chunk of stream) {
    hash.update(chunk as Buffer)
  }
  return hash.digest('hex')
}

export function sha256Buffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/** Walk a directory tree; yields paths relative to `root` using posix separators. */
export function* walkRelSync(root: string, base = ''): Generator<string> {
  if (!existsSync(root)) return
  for (const name of readdirSync(root)) {
    const abs = path.join(root, name)
    const rel = base ? `${base}/${name}` : name
    if (statSync(abs).isDirectory()) {
      yield* walkRelSync(abs, rel)
    } else {
      yield rel.replace(/\\/g, '/')
    }
  }
}

export async function walkRel(root: string, base = ''): Promise<string[]> {
  const out: string[] = []
  if (!existsSync(root)) return out
  const entries = await readdir(root, { withFileTypes: true })
  for (const ent of entries) {
    const rel = base ? `${base}/${ent.name}` : ent.name
    const abs = path.join(root, ent.name)
    if (ent.isDirectory()) {
      out.push(...(await walkRel(abs, rel)))
    } else {
      out.push(rel.replace(/\\/g, '/'))
    }
  }
  return out
}

export function copyDirSync(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  if (!existsSync(src)) return
  for (const name of readdirSync(src)) {
    const s = path.join(src, name)
    const d = path.join(dest, name)
    if (statSync(s).isDirectory()) copyDirSync(s, d)
    else copyFileSync(s, d)
  }
}

export async function copyDir(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true })
  if (!existsSync(src)) return
  const entries = await readdir(src, { withFileTypes: true })
  for (const ent of entries) {
    const s = path.join(src, ent.name)
    const d = path.join(dest, ent.name)
    if (ent.isDirectory()) await copyDir(s, d)
    else await copyFile(s, d)
  }
}

export function ensureDirSync(dir: string): void {
  mkdirSync(dir, { recursive: true })
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

/**
 * Recursive delete that tolerates Windows file locks.
 *
 * Node's rmSync has `maxRetries`, but it only retries on EBUSY/EPERM when
 * `recursive` is set AND it does not wait long enough for a SQLite -shm handle the
 * OS has not finished releasing. Restore deletes the images tree next to a database
 * that was open moments earlier, and on Windows that is a real race — CI on
 * windows-latest failed here while macOS and Linux passed.
 */
export function rmrfSync(target: string): void {
  if (!existsSync(target)) return
  try {
    rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'ENOTEMPTY') throw e
    throw new Error(
      `could not remove ${target} — another process is holding a file inside it ` +
        `open. Close any other KeepR window and try again.`,
    )
  }
}

export async function rmrf(target: string): Promise<void> {
  await rm(target, { recursive: true, force: true }).catch(() => undefined)
}

export function fileSizeSync(abs: string): number {
  return existsSync(abs) ? statSync(abs).size : 0
}

export async function fileSize(abs: string): Promise<number> {
  try {
    return (await stat(abs)).size
  } catch {
    return 0
  }
}

/* ===========================================================================
 * Minimal tar (ustar) writer/reader — good enough for images + JSON manifests.
 * We never need sparse files, long-link extensions, or pax headers in tests.
 * ======================================================================== */

const TAR_BLOCK = 512

function tarHeader(name: string, size: number, type: '0' | '5' = '0'): Buffer {
  const buf = Buffer.alloc(TAR_BLOCK, 0)
  const writeStr = (s: string, offset: number, len: number) => {
    Buffer.from(s, 'utf8').copy(buf, offset, 0, len - 1)
  }
  // ustar names are 100 bytes; nest under short paths in our archives
  const n = name.length > 99 ? name.slice(0, 99) : name
  writeStr(n, 0, 100)
  writeStr('0000644\0', 100, 8) // mode
  writeStr('0000000\0', 108, 8) // uid
  writeStr('0000000\0', 116, 8) // gid
  writeStr(size.toString(8).padStart(11, '0') + '\0', 124, 12)
  writeStr(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 12)
  writeStr('        ', 148, 8) // checksum placeholder (spaces)
  buf[156] = type.charCodeAt(0)
  writeStr('ustar\0', 257, 6)
  writeStr('00', 263, 2)

  let sum = 0
  for (let i = 0; i < TAR_BLOCK; i++) sum += buf[i]!
  const checksum = sum.toString(8).padStart(6, '0') + '\0 '
  Buffer.from(checksum, 'utf8').copy(buf, 148)
  return buf
}

function padToBlock(size: number): number {
  const rem = size % TAR_BLOCK
  return rem === 0 ? 0 : TAR_BLOCK - rem
}

export async function writeTarGz(
  destPath: string,
  entries: Array<{ name: string; data: Buffer }>,
): Promise<void> {
  await ensureDir(path.dirname(destPath))
  const chunks: Buffer[] = []
  for (const e of entries) {
    const name = e.name.replace(/\\/g, '/')
    chunks.push(tarHeader(name, e.data.length, '0'))
    chunks.push(e.data)
    const pad = padToBlock(e.data.length)
    if (pad) chunks.push(Buffer.alloc(pad, 0))
  }
  // two zero blocks end a tar
  chunks.push(Buffer.alloc(TAR_BLOCK * 2, 0))
  const tar = Buffer.concat(chunks)

  const gzip = createGzip()
  const out: Buffer[] = []
  gzip.on('data', (c: Buffer) => out.push(c))
  await new Promise<void>((resolve, reject) => {
    gzip.on('end', () => resolve())
    gzip.on('error', reject)
    gzip.end(tar)
  })
  await writeFile(destPath, Buffer.concat(out))
}

export async function readTarGz(
  srcPath: string,
): Promise<Array<{ name: string; data: Buffer }>> {
  const compressed = await readFile(srcPath)
  const gunzip = createGunzip()
  const parts: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    gunzip.on('data', (c: Buffer) => parts.push(c))
    gunzip.on('end', () => resolve())
    gunzip.on('error', reject)
    gunzip.end(compressed)
  })
  const tar = Buffer.concat(parts)
  const entries: Array<{ name: string; data: Buffer }> = []
  let offset = 0
  while (offset + TAR_BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + TAR_BLOCK)
    offset += TAR_BLOCK
    // end of archive: zero block
    if (header.every((b) => b === 0)) break
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const sizeOctal = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim()
    const size = parseInt(sizeOctal, 8) || 0
    const typeFlag = String.fromCharCode(header[156] ?? 0)
    const data = tar.subarray(offset, offset + size)
    offset += size + padToBlock(size)
    if (typeFlag === '0' || typeFlag === '\0' || typeFlag === '') {
      entries.push({ name, data: Buffer.from(data) })
    }
  }
  return entries
}

/** List entry names inside a .tar.gz without writing anything. */
export async function listTarGz(srcPath: string): Promise<string[]> {
  const entries = await readTarGz(srcPath)
  return entries.map((e) => e.name)
}
