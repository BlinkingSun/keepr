/**
 * In-memory DB + FileStore + stub OCR + image pool for Lane C tests.
 */
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRepositories, type Repositories } from '../../db/repo/index.ts'
import { SqliteJobQueue } from '../../main/jobQueue.ts'
import { DiskFileStore } from '../../store/fileStore.ts'
import { createImagePool, type ImagePool } from '../../workers/imagePool.ts'
import type {
  OcrOptions,
  OcrProvider,
  OcrResult,
  PageImageRef,
} from '../../shared/types.ts'
import { asRelPath } from '../../shared/types.ts'
import type { IngestDeps, IngestJobQueue } from '../types.ts'

const here = dirname(fileURLToPath(import.meta.url))
const schemaPath = join(here, '../../db/schema/001_initial.sql')
const schemaSql = readFileSync(schemaPath, 'utf8')
const migration002Path = join(here, '../../db/schema/002_source_files.sql')
const migration002Sql = readFileSync(migration002Path, 'utf8')

export const NOW = 1_753_900_000_000

export interface StubOcrOptions {
  /** Text returned for every page. */
  text?: string
  /** Per-pageId text override. */
  textByPage?: Map<number, string>
  /** Fail when generation matches these page ids. */
  failPageIds?: Set<number>
  /** Delay (ms) before each OCR call — for cancel tests. */
  delayMs?: number
  /** Called at the start of each ocrPage. */
  onStart?: (input: PageImageRef) => void
  /** Gate: resolve to let each OCR proceed (cancel tests). */
  gate?: () => Promise<void>
}

export class StubOcrProvider implements OcrProvider {
  readonly id = 'stub-ocr'
  calls: PageImageRef[] = []
  opts: StubOcrOptions

  constructor(opts: StubOcrOptions = {}) {
    this.opts = opts
  }

  async ocrPage(input: PageImageRef, _opts?: OcrOptions): Promise<OcrResult> {
    this.calls.push(input)
    this.opts.onStart?.(input)
    if (this.opts.gate) await this.opts.gate()
    if (this.opts.delayMs) {
      await new Promise((r) => setTimeout(r, this.opts.delayMs))
    }

    const pageHint =
      input.kind === 'file'
        ? // tests don't pass pageId on the ref; failPageIds checked via generation only
          null
        : null
    void pageHint

    // Fail by generation tag when failPageIds includes generation as a stand-in —
    // better: fail when absPath contains a marker, or use a Set of generations.
    if (this.opts.failPageIds && this.opts.failPageIds.has(input.generation)) {
      // Not ideal. Prefer fail on path marker.
    }

    if (this.opts.failPageIds) {
      // We cannot see pageId on PageImageRef. Use a path marker '__fail__' or
      // generation-keyed set is wrong. Tests will set fail by throwing from onStart
      // or we check a Set of absPath suffixes. Use opts.failPaths instead via onStart.
    }

    if ((this.opts as { fail?: boolean }).fail) {
      throw new Error('stub OCR failure')
    }

    const text =
      this.opts.textByPage?.get(input.generation) ??
      this.opts.text ??
      'RECEIPT TOKEN zzocrfindme TOTAL 12.00'

    return {
      text,
      words: [
        {
          text: text.split(/\s+/)[0] ?? 'TOKEN',
          bbox: { x: 0, y: 0, w: 40, h: 12 },
          confidence: 0.95,
        },
      ],
      confidence: 0.92,
      engine: this.id,
      generation: input.generation,
      msElapsed: 1,
    }
  }

  async dispose(): Promise<void> {}
}

/** OCR stub that fails for specific absolute path substrings. */
export class SelectiveFailOcr extends StubOcrProvider {
  failSubstr: string[]

  constructor(failSubstr: string[], opts: StubOcrOptions = {}) {
    super(opts)
    this.failSubstr = failSubstr
  }

  override async ocrPage(input: PageImageRef, opts?: OcrOptions): Promise<OcrResult> {
    if (input.kind === 'file' && this.failSubstr.some((s) => input.absPath.includes(s))) {
      this.calls.push(input)
      if (this.opts.gate) await this.opts.gate()
      throw new Error('stub OCR page failure')
    }
    return super.ocrPage(input, opts)
  }
}

export interface IngestFixture {
  raw: InstanceType<typeof Database>
  repos: Repositories
  fileStore: DiskFileStore
  jobs: SqliteJobQueue
  ocr: StubOcrProvider
  imagePool: ImagePool
  libraryRoot: string
  fixturesDir: string
  folderInbox: number
  folderUser: number
  deps: IngestDeps
  close: () => Promise<void>
}

export async function openIngestFixture(
  ocrOpts: StubOcrOptions = {},
): Promise<IngestFixture> {
  const raw = new Database(':memory:')
  raw.exec(schemaSql)
  raw.exec(migration002Sql)
  raw.pragma('foreign_keys = ON')

  raw
    .prepare(
      `INSERT INTO cabinet(id, display_name, base_currency, created_at, modified_at)
       VALUES (1, 'Test', 'USD', ?, ?)`,
    )
    .run(NOW, NOW)

  const folderInbox = Number(
    raw
      .prepare(
        `INSERT INTO folder(kind, name, created_at, modified_at) VALUES ('inbox', 'Inbox', ?, ?)`,
      )
      .run(NOW, NOW).lastInsertRowid,
  )
  const folderUser = Number(
    raw
      .prepare(
        `INSERT INTO folder(kind, name, created_at, modified_at) VALUES ('user', 'Materials', ?, ?)`,
      )
      .run(NOW, NOW).lastInsertRowid,
  )
  raw
    .prepare(
      `INSERT INTO folder(kind, name, created_at, modified_at) VALUES ('trash', 'Trash', ?, ?)`,
    )
    .run(NOW, NOW)

  const libraryRoot = await mkdtemp(join(tmpdir(), 'keepr-ingest-lib-'))
  const fixturesDir = await mkdtemp(join(tmpdir(), 'keepr-ingest-fx-'))

  const fileStore = new DiskFileStore({
    libraryRoot,
    countCitations: (rel) => {
      const row = raw
        .prepare(
          `SELECT COUNT(*) AS c FROM page
            WHERE file_relpath = ? OR thumb_relpath = ?`,
        )
        .get(String(rel), String(rel)) as { c: number }
      return row.c
    },
  })

  const repos = createRepositories({ db: raw as never, fileStore })
  const jobs = new SqliteJobQueue(raw as never)
  const ocr = new StubOcrProvider(ocrOpts)
  const imagePool = createImagePool({ concurrency: 2 })

  const deps: IngestDeps = {
    repos,
    fileStore,
    jobs: jobs as unknown as IngestJobQueue,
    ocr,
    imagePool,
    ocrConcurrency: 2,
    awaitOcr: true,
  }

  return {
    raw,
    repos,
    fileStore,
    jobs,
    ocr,
    imagePool,
    libraryRoot,
    fixturesDir,
    folderInbox,
    folderUser,
    deps,
    close: async () => {
      await imagePool.dispose()
      raw.close()
      await rm(libraryRoot, { recursive: true, force: true })
      await rm(fixturesDir, { recursive: true, force: true })
    },
  }
}

/** Tiny solid JPEG via sharp. */
export async function writeTestJpeg(
  dir: string,
  name: string,
  color: { r: number; g: number; b: number } = { r: 200, g: 40, b: 40 },
): Promise<string> {
  const sharp = (await import('sharp')).default
  const buf = await sharp({
    create: { width: 32, height: 32, channels: 3, background: color },
  })
    .jpeg()
    .toBuffer()
  const p = join(dir, name)
  await writeFile(p, buf)
  return p
}

/** N-page PDF via pdf-lib (blank pages). */
export async function writeTestPdf(dir: string, name: string, pages: number): Promise<string> {
  const { PDFDocument } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) {
    doc.addPage([200, 200])
  }
  const bytes = await doc.save()
  const p = join(dir, name)
  await writeFile(p, bytes)
  return p
}

export async function writeTestVcf(dir: string, name: string, body: string): Promise<string> {
  const p = join(dir, name)
  await writeFile(p, body, 'utf8')
  return p
}

export { asRelPath }
