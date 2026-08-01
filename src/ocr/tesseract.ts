/**
 * Scheduler-backed Tesseract OCR provider.
 *
 * ONE Tesseract.Scheduler per provider instance, created once, with a small
 * fixed worker count. Never nested inside the sharp/pdf pool. Never one
 * scheduler per job.
 *
 * Offline: workerPath, corePath, langPath all resolve to local files.
 * Word bboxes are in stored-master pixel space (no display rotation baked in).
 */

import { cpus } from 'node:os'
import { nodeRequire } from '../shared/nodeRequire.ts'
import type {
  BBox,
  OcrOptions,
  OcrProvider,
  OcrResult,
  PageImageRef,
  Word,
} from '../shared/types.ts'
import { resolveTesseractPaths, type TesseractOfflinePaths } from './paths.ts'
import { createImagePool, type ImagePool } from '../workers/imagePool.ts'
import sharp from 'sharp'

/**
 * Below this mean word confidence, the first OCR pass is treated as a failure
 * worth retrying on an enhanced image rather than a result worth keeping.
 *
 * Chosen from a corpus run: a faded, speckled, 5.5-degree-skewed thermal receipt
 * came back at 0.11 confidence with text so garbled the vendor read ". Lo - Le",
 * while clean receipts sat at 0.89-0.96. There is a wide gap between those, so
 * the threshold does not need to be precise.
 */
const RETRY_CONFIDENCE = 0.55

/**
 * Enhancement for a degraded scan, applied only after a poor first pass.
 *
 * Order matters. Greyscale first so the histogram stretch is not fighting three
 * channels. Upscale before sharpening because Tesseract's models are trained
 * around 300 DPI and interpolating a small blurry image gives the sharpener
 * something to work with. `normalise` is the big win on faded thermal print: it
 * stretches a narrow grey band back to full range. Deliberately no threshold or
 * binarisation — on faint text that deletes strokes instead of recovering them.
 */
async function enhanceForOcr(
  input: string | Buffer,
  variant: { denoise: boolean; rotate: number; upscale: boolean },
): Promise<Buffer> {
  const meta = await sharp(input).metadata()
  const width = meta.width ?? 0
  let pipe = sharp(input).greyscale()

  // Denoise BEFORE stretching contrast. The first version of this normalised
  // first, which amplified scanner speckle into thousands of spurious glyphs: a
  // faded receipt went from 251 characters at 0.11 confidence to 1304 characters
  // at 0.17 — more output, no more meaning. A median filter removes the speckle
  // while leaving strokes intact.
  if (variant.denoise) pipe = pipe.median(3)

  // Deskew. There is no angle detection here, so a small sweep is tried and the
  // best-scoring pass wins. Rotation matters more than it looks: Tesseract's line
  // finder degrades quickly past a couple of degrees, and phone photos and
  // sheet-feed scanners are rarely straight.
  if (variant.rotate !== 0) pipe = pipe.rotate(variant.rotate, { background: '#ffffff' })

  if (variant.upscale && width > 0 && width < 1400) {
    pipe = pipe.resize({ width: Math.round(width * 2), kernel: 'lanczos3' })
  }
  return pipe.normalise().sharpen({ sigma: 1.0 }).png().toBuffer()
}

/**
 * Enhancement attempts, cheapest first, applied only after a poor first pass.
 * Bounded on purpose — this runs per page during an import, and an unbounded
 * search would turn a slow scan into a hang.
 */
const ENHANCE_VARIANTS: Array<{ denoise: boolean; rotate: number; upscale: boolean }> = [
  { denoise: true, rotate: 0, upscale: true },
  { denoise: true, rotate: 0, upscale: false },
  { denoise: true, rotate: -5, upscale: true },
  { denoise: true, rotate: 5, upscale: true },
  { denoise: true, rotate: -2.5, upscale: true },
  { denoise: true, rotate: 2.5, upscale: true },
]

// Dual-runtime: import.meta.url is undefined in the CJS bundle Electron loads.
const require = nodeRequire

export interface TesseractProviderOptions {
  /** Fixed worker count for the scheduler. Default min(4, max(1, cores-1)). */
  workerCount?: number
  languages?: string[]
  /** Injected paths (tests). Default: offline resolve. */
  paths?: TesseractOfflinePaths
  /**
   * Optional factory overrides for tests (count scheduler creations, mock OCR).
   * Production code leaves these undefined and uses real tesseract.js.
   */
  tesseractModule?: TesseractModuleLike
  /** Shared image pool for PDF rasterization. Created if omitted. */
  imagePool?: ImagePool
  /** When true, do not create an internal image pool (caller supplies or none). */
  skipImagePool?: boolean
}

export interface TesseractModuleLike {
  createScheduler: () => SchedulerLike
  createWorker: (
    langs?: string | string[],
    oem?: number,
    options?: Record<string, unknown>,
  ) => Promise<WorkerLike>
}

export interface SchedulerLike {
  addWorker: (w: WorkerLike) => string
  addJob: (action: 'recognize', image: unknown, opts?: unknown, output?: unknown) => Promise<{
    data: {
      text: string
      confidence: number
      words?: Array<{
        text: string
        confidence: number
        bbox: { x0: number; y0: number; x1: number; y1: number }
      }>
    }
  }>
  terminate: () => Promise<unknown>
  getQueueLen: () => number
  getNumWorkers: () => number
}

export interface WorkerLike {
  id?: string
  recognize?: (...args: unknown[]) => Promise<unknown>
  terminate: () => Promise<unknown>
  setParameters?: (params: Record<string, unknown>) => Promise<unknown>
}

/** Test hook: how many times createScheduler was invoked by this module. */
let schedulerCreateCount = 0
export function getSchedulerCreateCount(): number {
  return schedulerCreateCount
}
export function resetSchedulerCreateCount(): void {
  schedulerCreateCount = 0
}

export class TesseractOcrProvider implements OcrProvider {
  readonly id = 'tesseract'

  private readonly workerCount: number
  private readonly languages: string[]
  private readonly paths: TesseractOfflinePaths
  private readonly tess: TesseractModuleLike
  private readonly imagePool: ImagePool | null
  private readonly ownsImagePool: boolean

  private scheduler: SchedulerLike | null = null
  private initPromise: Promise<void> | null = null
  private disposed = false

  /** In-flight + queued job tracking for cancellation assertions. */
  private pending = new Set<{ abort: () => void; done: Promise<unknown> }>()

  constructor(options: TesseractProviderOptions = {}) {
    this.workerCount =
      options.workerCount ?? Math.min(4, Math.max(1, cpus().length - 1))
    this.languages = options.languages ?? ['eng']
    this.paths = options.paths ?? resolveTesseractPaths()
    this.tess = options.tesseractModule ?? loadTesseract()
    if (options.imagePool) {
      this.imagePool = options.imagePool
      this.ownsImagePool = false
    } else if (options.skipImagePool) {
      this.imagePool = null
      this.ownsImagePool = false
    } else {
      this.imagePool = createImagePool()
      this.ownsImagePool = true
    }
  }

  async ocrPage(input: PageImageRef, opts?: OcrOptions): Promise<OcrResult> {
    if (this.disposed) throw new Error('TesseractOcrProvider disposed')

    // Resolve the page to actual image bytes/path once, so a retry does not
    // rasterize the same PDF page twice.
    let image: string | Buffer = input.absPath
    if (input.kind === 'pdfPage') {
      if (!this.imagePool) throw new Error('pdfPage OCR requires an imagePool for rasterization')
      const raster = await this.imagePool.rasterizePdfPage(input.absPath, input.pageIndex, {
        signal: opts?.signal,
        dpi: 300,
      })
      image = raster.buffer
    }

    const first = await this.#recognize(image, input.generation, opts)
    if (first.confidence >= RETRY_CONFIDENCE || opts?.signal?.aborted) return first

    // Poor read. Work through the enhancement variants and keep the best result.
    // Enhancement helps degraded scans and can mildly hurt clean ones, so it is
    // never applied unconditionally, and the original always stays in contention.
    let best = first
    for (const variant of ENHANCE_VARIANTS) {
      if (opts?.signal?.aborted) break
      try {
        const candidate = await this.#recognize(
          await enhanceForOcr(image, variant),
          input.generation,
          opts,
        )
        if (candidate.confidence > best.confidence) {
          best = { ...candidate, engine: `${candidate.engine}+enhanced` }
        }
        // Good enough: stop paying for further variants.
        if (best.confidence >= RETRY_CONFIDENCE) break
      } catch {
        // Best-effort. A failing variant must not lose the result we already have.
      }
    }
    return best
  }

  async #recognize(image: string | Buffer, generation: number, opts?: OcrOptions): Promise<OcrResult> {
    if (this.disposed) throw new Error('TesseractOcrProvider disposed')
    const signal = opts?.signal
    if (signal?.aborted) throw abortError()

    await this.ensureScheduler()
    const scheduler = this.scheduler
    if (!scheduler) throw new Error('scheduler not initialized')

    const t0 = Date.now()
    if (signal?.aborted) throw abortError()

    // Queue cancellation: wrap the job so an abort before/during rejects
    // and removes our tracking. Tesseract itself may still finish a running
    // WASM job; we do not leave OUR queue holding the promise as live work.
    let aborted = false
    let rejectAbort: ((e: Error) => void) | null = null
    const abortPromise = new Promise<never>((_, reject) => {
      rejectAbort = reject
    })
    const onAbort = () => {
      aborted = true
      rejectAbort?.(abortError())
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })

    const entry = {
      abort: onAbort,
      done: Promise.resolve(),
    }

    const jobPromise = (async () => {
      // If aborted while waiting for a free scheduler slot, bail before addJob
      // when possible. Scheduler has no cancel API, so we race.
      const recognize = scheduler.addJob('recognize', image)
      entry.done = recognize.then(() => undefined, () => undefined)
      const result = await Promise.race([recognize, abortPromise])
      if (aborted) throw abortError()
      return result
    })()

    this.pending.add(entry)
    try {
      const { data } = await jobPromise
      if (aborted || signal?.aborted) throw abortError()

      const words = mapWords(data.words ?? [])
      const text = (data.text ?? '').replace(/\n+$/, '')
      const confidence = words.length
        ? words.reduce((s, w) => s + w.confidence, 0) / words.length
        : normalizeConf(data.confidence)

      return {
        text,
        words,
        confidence,
        engine: this.id,
        generation,
        msElapsed: Date.now() - t0,
      }
    } catch (raw) {
      // tesseract.js rejects with a STRING, not an Error ('Error: Error
      // attempting to read image.'), proven by the corrupt-JPEG fixture below.
      // Normalising here — at the seam we own — means every consumer of
      // OcrProvider gets a real Error with a usable .message, and the
      // blank-page/abort classifiers below work on string rejections too.
      const e = asError(raw)
      if (aborted || signal?.aborted || isAbort(e)) throw abortError()
      // Empty / failed OCR of a blank page: return empty result, do not throw
      if (isEmptyOcrError(e)) {
        return {
          text: '',
          words: [],
          confidence: 0,
          engine: this.id,
          generation,
          msElapsed: Date.now() - t0,
        }
      }
      throw e
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort)
      this.pending.delete(entry)
    }
  }

  /** True when no ocrPage calls are still tracked as pending. */
  hasPendingWork(): boolean {
    return this.pending.size > 0
  }

  async dispose(): Promise<void> {
    this.disposed = true
    // Abort tracked waiters
    for (const p of this.pending) p.abort()
    this.pending.clear()
    if (this.scheduler) {
      await this.scheduler.terminate()
      this.scheduler = null
    }
    this.initPromise = null
    if (this.ownsImagePool && this.imagePool) {
      await this.imagePool.dispose()
    }
  }

  private ensureScheduler(): Promise<void> {
    if (this.scheduler) return Promise.resolve()
    if (this.initPromise) return this.initPromise
    this.initPromise = this.createSchedulerOnce()
    return this.initPromise
  }

  private async createSchedulerOnce(): Promise<void> {
    if (this.scheduler) return

    schedulerCreateCount += 1
    const scheduler = this.tess.createScheduler()

    const langs = this.languages.join('+')
    const workerOpts = {
      workerPath: this.paths.workerPath,
      corePath: this.paths.corePath,
      langPath: this.paths.langPath,
      cachePath: this.paths.langPath,
      gzip: false, // eng.traineddata is stored uncompressed under resources/tessdata
      cacheMethod: 'readOnly',
      // Never hit the network for language data
      workerBlobURL: false,
      // CRITICAL containment. Without an errorHandler, a tesseract worker-thread
      // error (corrupt image, wasm fault) surfaces as an uncaught error on the
      // event loop and KILLS THE PROCESS — the execution audit's live test
      // imported a malformed JPEG and took down the whole app mid-serve. Errors
      // routed here are logged; the recognize() promise for that job still
      // rejects and the page is marked failed like any other OCR failure.
      errorHandler: (err: unknown) => {
        console.error('[keepr] tesseract worker error (contained):', (err as Error)?.message ?? err)
      },
    }

    const makers: Promise<void>[] = []
    for (let i = 0; i < this.workerCount; i++) {
      makers.push(
        (async () => {
          const worker = await this.tess.createWorker(langs, undefined, workerOpts)
          scheduler.addWorker(worker)
        })(),
      )
    }
    await Promise.all(makers)
    this.scheduler = scheduler
  }
}

function loadTesseract(): TesseractModuleLike {
  // tesseract.js is CJS
  return require('tesseract.js') as TesseractModuleLike
}

function mapWords(
  raw: Array<{
    text: string
    confidence: number
    bbox: { x0: number; y0: number; x1: number; y1: number }
  }>,
): Word[] {
  const out: Word[] = []
  for (const w of raw) {
    const text = (w.text ?? '').trim()
    if (!text) continue
    const bbox: BBox = {
      x: w.bbox.x0,
      y: w.bbox.y0,
      w: Math.max(0, w.bbox.x1 - w.bbox.x0),
      h: Math.max(0, w.bbox.y1 - w.bbox.y0),
    }
    // Tesseract confidence is 0..100
    out.push({
      text,
      bbox,
      confidence: normalizeConf(w.confidence),
    })
  }
  return out
}

function normalizeConf(c: number | undefined): number {
  if (c == null || !Number.isFinite(c)) return 0
  // Already 0..1
  if (c >= 0 && c <= 1) return c
  // Tesseract 0..100
  if (c > 1 && c <= 100) return c / 100
  return Math.max(0, Math.min(1, c))
}

function abortError(): Error {
  const e = new Error('Aborted')
  e.name = 'AbortError'
  return e
}

/**
 * Coerce an unknown rejection into an Error without losing the original.
 * tesseract.js worker failures arrive as strings; the OcrProvider contract
 * promises Errors, and `(e as Error).message` on a string yields undefined —
 * which is how a real failure reason turns into "undefined" in a job row.
 */
function asError(e: unknown): Error {
  if (e instanceof Error) return e
  const text = typeof e === 'string' ? e : (() => { try { return JSON.stringify(e) } catch { return String(e) } })()
  // Strip tesseract's doubled 'Error: ' prefix so messages read cleanly.
  const err = new Error(String(text).replace(/^Error:\s*/, ''))
  err.cause = e
  return err
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.message === 'Aborted')
}

function isEmptyOcrError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const m = e.message.toLowerCase()
  return m.includes('image is too small') || m.includes('empty') || m.includes('no image')
}

/** Factory used by provider.ts */
export function createTesseractProvider(options?: TesseractProviderOptions): TesseractOcrProvider {
  return new TesseractOcrProvider(options)
}
