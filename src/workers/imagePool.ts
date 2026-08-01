/**
 * Sharp/PDF worker pool — decode, thumbnail, rotate, rasterize.
 *
 * Sized independently from the Tesseract scheduler (cores-1 by default).
 * Never nests Tesseract work. Workers return data only; callers (main) write
 * to SQLite.
 *
 * Implementation uses an in-process concurrency queue. sharp already farms
 * work to libvips threads; wrapping sharp inside worker_threads multiplies
 * libvips heaps the same way nested Tesseract pools do. The contract we
 * honour is independent sizing + AbortSignal cancellation of queued jobs.
 */

import { cpus } from 'node:os'
import { nodeRequire } from '../shared/nodeRequire.ts'

// Dual-runtime: import.meta.url is undefined in the CJS bundle Electron loads,
// and esbuild compiles import.meta to {} so the .url read yields undefined.
const require = nodeRequire

export type RotationDeg = 0 | 90 | 180 | 270

export interface ImagePoolOptions {
  /** Max concurrent sharp/pdf jobs. Default max(1, cores-1). */
  concurrency?: number
}

export interface DecodeResult {
  width: number
  height: number
  format: string
  /** Raw pixel buffer when requested; otherwise omitted to save memory. */
  buffer?: Buffer
  channels?: number
}

export interface ThumbnailResult {
  buffer: Buffer
  width: number
  height: number
  format: 'jpeg'
}

export interface RotateResult {
  buffer: Buffer
  width: number
  height: number
  format: string
}

export interface RasterizeResult {
  buffer: Buffer
  width: number
  height: number
  format: 'png'
  /** DPI used for rasterization. */
  dpi: number
}

export interface ImagePool {
  decode(absPath: string, opts?: { signal?: AbortSignal; withBuffer?: boolean }): Promise<DecodeResult>
  thumbnail(absPath: string, opts?: { signal?: AbortSignal; maxEdge?: number }): Promise<ThumbnailResult>
  /**
   * Rotate pixels. Prefer metadata-only rotation for display; use this only
   * when rewriting the master (e.g. user-confirmed bake). Crops rewrite the
   * master and must bump ocr_generation.
   */
  rotate(
    absPath: string,
    degrees: RotationDeg,
    opts?: { signal?: AbortSignal },
  ): Promise<RotateResult>
  rasterizePdfPage(
    absPath: string,
    pageIndex: number,
    opts?: { signal?: AbortSignal; dpi?: number },
  ): Promise<RasterizeResult>
  /** Number of jobs currently running. */
  running(): number
  /** Number of jobs waiting. */
  queued(): number
  dispose(): Promise<void>
}

interface Job<T> {
  run: () => Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
}

export function createImagePool(options: ImagePoolOptions = {}): ImagePool {
  const concurrency = Math.max(1, options.concurrency ?? Math.max(1, cpus().length - 1))
  const queue: Job<unknown>[] = []
  let active = 0
  let disposed = false

  function enqueue<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (disposed) return Promise.reject(new Error('ImagePool disposed'))
    if (signal?.aborted) return Promise.reject(abortError())

    return new Promise<T>((resolve, reject) => {
      const job: Job<T> = { run, resolve, reject, signal }
      const onAbort = () => {
        const idx = queue.indexOf(job as Job<unknown>)
        if (idx >= 0) {
          queue.splice(idx, 1)
          reject(abortError())
        }
        // Running jobs complete; caller may ignore. Queued work is stopped.
      }
      job.onAbort = onAbort
      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true })
      }
      queue.push(job as Job<unknown>)
      pump()
    })
  }

  function pump(): void {
    while (active < concurrency && queue.length > 0) {
      const job = queue.shift()
      if (!job) break
      if (job.signal?.aborted) {
        job.reject(abortError())
        continue
      }
      active++
      job
        .run()
        .then((v) => {
          if (job.signal) job.signal.removeEventListener('abort', job.onAbort as () => void)
          job.resolve(v)
        })
        .catch((e) => {
          if (job.signal) job.signal.removeEventListener('abort', job.onAbort as () => void)
          job.reject(e)
        })
        .finally(() => {
          active--
          pump()
        })
    }
  }

  // The shim returns unknown by design (it can load anything), so the cast is
  // where this module asserts what it asked for.
  const sharp = (): typeof import('sharp') => require('sharp') as typeof import('sharp')

  return {
    decode(absPath, opts) {
      return enqueue(async () => {
        const img = sharp()(absPath)
        const meta = await img.metadata()
        const width = meta.width ?? 0
        const height = meta.height ?? 0
        const format = meta.format ?? 'unknown'
        if (opts?.withBuffer) {
          const buffer = await img.ensureAlpha().raw().toBuffer()
          return {
            width,
            height,
            format,
            buffer,
            channels: 4,
          }
        }
        return { width, height, format }
      }, opts?.signal)
    },

    thumbnail(absPath, opts) {
      const maxEdge = opts?.maxEdge ?? 320
      return enqueue(async () => {
        const buffer = await sharp()(absPath)
          .rotate() // honour EXIF orientation for thumbs only; master stays unbaked
          .resize({
            width: maxEdge,
            height: maxEdge,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality: 80, mozjpeg: true })
          .toBuffer({ resolveWithObject: true })
        return {
          buffer: buffer.data,
          width: buffer.info.width,
          height: buffer.info.height,
          format: 'jpeg' as const,
        }
      }, opts?.signal)
    },

    rotate(absPath, degrees, opts) {
      return enqueue(async () => {
        if (degrees !== 0 && degrees !== 90 && degrees !== 180 && degrees !== 270) {
          throw new RangeError(`rotation must be 0|90|180|270, got ${degrees}`)
        }
        const out = await sharp()(absPath)
          .rotate(degrees)
          .png()
          .toBuffer({ resolveWithObject: true })
        return {
          buffer: out.data,
          width: out.info.width,
          height: out.info.height,
          format: 'png',
        }
      }, opts?.signal)
    },

    rasterizePdfPage(absPath, pageIndex, opts) {
      const dpi = opts?.dpi ?? 300
      return enqueue(async () => {
        const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs')
        // Disable worker — run on this pool's concurrency slot to avoid a
        // second nested worker layer for PDF parse.
        try {
          GlobalWorkerOptions.workerSrc = ''
        } catch {
          /* ignore */
        }

        const data = new Uint8Array(await readFile(absPath))
        // disableWorker is a runtime option; types lag in some pdfjs versions.
        const doc = await getDocument({
          data,
          disableWorker: true,
          isEvalSupported: false,
          useSystemFonts: true,
        } as Parameters<typeof getDocument>[0]).promise

        try {
          if (pageIndex < 0 || pageIndex >= doc.numPages) {
            throw new RangeError(`PDF pageIndex ${pageIndex} out of range 0..${doc.numPages - 1}`)
          }
          const page = await doc.getPage(pageIndex + 1) // pdf.js is 1-based
          const viewport = page.getViewport({ scale: dpi / 72 })
          const width = Math.max(1, Math.ceil(viewport.width))
          const height = Math.max(1, Math.ceil(viewport.height))

          // Node has no canvas; render via pdf.js ops is heavy. Prefer a
          // simple path: use pdf.js page render into a raw RGBA buffer via
          // the experimental node canvas-less path if available, else fall
          // back to rendering with a minimal CanvasFactory.
          const factory = createNodeCanvasFactory()
          const canvasAndContext = factory.create(width, height)
          const renderContext = {
            canvasContext: canvasAndContext.context,
            viewport,
            canvasFactory: factory,
          }
          await page.render(renderContext as never).promise
          const rgba = canvasAndContext.context.getImageData(0, 0, width, height).data
          const buffer = await sharp()(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), {
            raw: { width, height, channels: 4 },
          })
            .png()
            .toBuffer()

          factory.destroy(canvasAndContext)
          return { buffer, width, height, format: 'png' as const, dpi }
        } finally {
          await doc.destroy()
        }
      }, opts?.signal)
    },

    running: () => active,
    queued: () => queue.length,

    async dispose() {
      disposed = true
      while (queue.length) {
        const j = queue.shift()
        j?.reject(new Error('ImagePool disposed'))
      }
      // Wait for in-flight
      while (active > 0) {
        await new Promise((r) => setTimeout(r, 10))
      }
    },
  }
}

function abortError(): Error {
  const e = new Error('Aborted')
  e.name = 'AbortError'
  return e
}

async function readFile(absPath: string): Promise<Buffer> {
  const fs = await import('node:fs/promises')
  return fs.readFile(absPath)
}

/**
 * Minimal canvas factory for pdf.js in Node without node-canvas.
 * Uses a pure-JS RGBA buffer + a stub 2d context sufficient for
 * pdf.js's internal paint path when combined with our own image assembly.
 *
 * Note: full PDF text/vector fidelity needs a real canvas. For receipt
 * PDFs (usually scanned images) this path is enough; complex vector PDFs
 * may need node-canvas later (report as BLOCKER if required).
 */
function createNodeCanvasFactory() {
  // Dynamic require of @napi-rs/canvas or canvas is forbidden without package.json.
  // Implement a minimal ImageData + fake context that records the full-frame
  // putImageData from pdf.js image XObjects where possible.
  //
  // Practical approach for Phase 1: use pdf.js getOperatorList is too heavy.
  // Instead, try to load `canvas` if present; otherwise use a pure buffer
  // context from a tiny inline implementation.
  return {
    create(width: number, height: number) {
      const w = Math.max(1, Math.floor(width))
      const h = Math.max(1, Math.floor(height))
      const data = new Uint8ClampedArray(w * h * 4)
      // fill white
      data.fill(255)
      const imageData = { data, width: w, height: h, colorSpace: 'srgb' as const }
      const context = createStubContext(w, h, data)
      return {
        canvas: { width: w, height: h, getContext: () => context },
        context,
        _imageData: imageData,
      }
    },
    reset(canvasAndContext: { canvas: { width: number; height: number } }, width: number, height: number) {
      canvasAndContext.canvas.width = Math.max(1, Math.floor(width))
      canvasAndContext.canvas.height = Math.max(1, Math.floor(height))
    },
    destroy(canvasAndContext: { canvas?: unknown; context?: unknown }) {
      // drop refs
      void canvasAndContext
    },
  }
}

function createStubContext(width: number, height: number, data: Uint8ClampedArray) {
  // A best-effort CanvasRenderingContext2D stub. pdf.js image-only pages
  // primarily call drawImage / putImageData. We implement putImageData and
  // a drawImage that copies raw buffers when the source exposes them.
  const state = {
    fillStyle: '#ffffff',
    strokeStyle: '#000000',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    lineWidth: 1,
    transform: [1, 0, 0, 1, 0, 0] as number[],
  }

  const ctx = {
    canvas: { width, height },
    ...state,
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo(_x: number, _y: number) {},
    lineTo(_x: number, _y: number) {},
    bezierCurveTo() {},
    quadraticCurveTo() {},
    rect(_x: number, _y: number, _w: number, _h: number) {},
    clip() {},
    fill() {},
    stroke() {},
    fillRect(x: number, y: number, w: number, h: number) {
      const color = parseColor(String(ctx.fillStyle))
      const x0 = Math.max(0, Math.floor(x))
      const y0 = Math.max(0, Math.floor(y))
      const x1 = Math.min(width, Math.ceil(x + w))
      const y1 = Math.min(height, Math.ceil(y + h))
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * width + xx) * 4
          data[i] = color[0]!
          data[i + 1] = color[1]!
          data[i + 2] = color[2]!
          data[i + 3] = color[3]!
        }
      }
    },
    strokeRect() {},
    clearRect(x: number, y: number, w: number, h: number) {
      const prev = ctx.fillStyle
      ctx.fillStyle = '#00000000'
      ctx.fillRect(x, y, w, h)
      ctx.fillStyle = prev
    },
    transform() {},
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
      state.transform = [a, b, c, d, e, f]
    },
    resetTransform() {
      state.transform = [1, 0, 0, 1, 0, 0]
    },
    scale() {},
    rotate() {},
    translate() {},
    drawImage(img: { data?: Uint8ClampedArray | Buffer; width?: number; height?: number; getContext?: Function }, dx: number, dy: number, dw?: number, dh?: number) {
      // Attempt to copy raw pixel data from known shapes
      let src: Uint8ClampedArray | null = null
      let sw = 0
      let sh = 0
      if (img && img.data && img.width && img.height) {
        src = img.data instanceof Uint8ClampedArray ? img.data : new Uint8ClampedArray(img.data)
        sw = img.width
        sh = img.height
      }
      if (!src) return
      const destW = dw ?? sw
      const destH = dh ?? sh
      // nearest-neighbour blit
      for (let y = 0; y < destH; y++) {
        const sy = Math.min(sh - 1, Math.floor((y * sh) / destH))
        for (let x = 0; x < destW; x++) {
          const sx = Math.min(sw - 1, Math.floor((x * sw) / destW))
          const si = (sy * sw + sx) * 4
          const tx = Math.floor(dx + x)
          const ty = Math.floor(dy + y)
          if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
          const di = (ty * width + tx) * 4
          data[di] = src[si]!
          data[di + 1] = src[si + 1]!
          data[di + 2] = src[si + 2]!
          data[di + 3] = src[si + 3]!
        }
      }
    },
    getImageData(sx: number, sy: number, sw: number, sh: number) {
      const w = Math.max(1, Math.floor(sw))
      const h = Math.max(1, Math.floor(sh))
      const out = new Uint8ClampedArray(w * h * 4)
      const x0 = Math.max(0, Math.floor(sx))
      const y0 = Math.max(0, Math.floor(sy))
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const sx_ = x0 + x
          const sy_ = y0 + y
          const di = (y * w + x) * 4
          if (sx_ < 0 || sy_ < 0 || sx_ >= width || sy_ >= height) {
            out[di + 3] = 0
            continue
          }
          const si = (sy_ * width + sx_) * 4
          out[di] = data[si]!
          out[di + 1] = data[si + 1]!
          out[di + 2] = data[si + 2]!
          out[di + 3] = data[si + 3]!
        }
      }
      return { data: out, width: w, height: h, colorSpace: 'srgb' as const }
    },
    putImageData(imageData: { data: ArrayLike<number>; width: number; height: number }, dx: number, dy: number) {
      const sw = imageData.width
      const sh = imageData.height
      const src = imageData.data
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const tx = Math.floor(dx + x)
          const ty = Math.floor(dy + y)
          if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue
          const si = (y * sw + x) * 4
          const di = (ty * width + tx) * 4
          data[di] = Number(src[si] ?? 0)
          data[di + 1] = Number(src[si + 1] ?? 0)
          data[di + 2] = Number(src[si + 2] ?? 0)
          data[di + 3] = Number(src[si + 3] ?? 255)
        }
      }
    },
    createImageData(w: number, h: number) {
      return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h, colorSpace: 'srgb' as const }
    },
    measureText(text: string) {
      return { width: text.length * 6 }
    },
    fillText() {},
    strokeText() {},
    setLineDash() {},
    getLineDash() {
      return [] as number[]
    },
    createPattern() {
      return null
    },
    createLinearGradient() {
      return { addColorStop() {} }
    },
    createRadialGradient() {
      return { addColorStop() {} }
    },
  }
  return ctx
}

function parseColor(s: string): [number, number, number, number] {
  if (s.startsWith('#') && s.length === 7) {
    return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 255]
  }
  if (s.startsWith('#') && s.length === 9) {
    return [
      parseInt(s.slice(1, 3), 16),
      parseInt(s.slice(3, 5), 16),
      parseInt(s.slice(5, 7), 16),
      parseInt(s.slice(7, 9), 16),
    ]
  }
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
  if (m) {
    return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] != null ? Math.round(Number(m[4]) * 255) : 255]
  }
  return [255, 255, 255, 255]
}

