/**
 * eSCL ScanJobs lifecycle: create job → NextDocument loop → cancel/DELETE.
 *
 * 503 retry budget ≥20s with jittered backoff (warm-up lasers really do sit on
 * 503 that long); still cancelable mid-backoff via AbortSignal.
 * ADF empty: ScannerStatus AdfEmpty AND 409-on-ScanJobs (both vendor encodings).
 */
import type { ScanDevice, ScanOptions } from '../shared/types.ts'
import { deviceBaseUrl, ScanError } from './types.ts'
import { firstText, parseXml } from './xml.ts'

/** Total time spent waiting on 503 before giving up as busy. */
export const RETRY_BUDGET_MS = 20_000
/**
 * Cap on TOTAL 503 waiting across a whole job. The per-gap budget resets after
 * every successful page, so an ADF feeding N pages each preceded by ~20s of
 * busy-wait meant a job could stall for N x 20s with no way to call it stuck
 * (audit finding). Warm-up laziness is one gap; a scanner that is busy before
 * every single page is a broken scanner.
 */
export const RETRY_BUDGET_TOTAL_MS = 60_000

/** Base delay for exponential backoff; jittered ±50%. */
const BACKOFF_BASE_MS = 500
const BACKOFF_MAX_MS = 4_000

export type PageCallback = (pageIndex: number, bytes: Buffer, contentType: string) => void | Promise<void>

export interface ScanJobHandle {
  /** Run the page loop until 404 or error. */
  run(onPage: PageCallback): Promise<{ pages: number }>
  /** DELETE job URL; abort in-flight GET. */
  cancel(): Promise<void>
  readonly jobUrl: string | null
  readonly canceled: boolean
}

export interface CreateJobOpts {
  signal?: AbortSignal
  /** Injectable for tests (default global fetch). */
  fetchImpl?: typeof fetch
  /** Injectable sleep for 503 backoff tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Skip preflight ScannerStatus (tests that only exercise the job path). */
  skipStatusCheck?: boolean
}

/**
 * Create an eSCL scan job and return a handle for the page loop.
 * Validates ADF state when source is Adf (unless skipStatusCheck).
 */
export async function createScanJob(
  device: ScanDevice,
  options: ScanOptions,
  opts: CreateJobOpts = {},
): Promise<ScanJobHandle> {
  if (device.secure) {
    throw new ScanError(
      'tls-unsupported',
      'TLS (eSCL over HTTPS / _uscans._tcp) scanners are listed but not yet scannable in this version.',
    )
  }

  const fetchImpl = opts.fetchImpl ?? fetch
  const sleepFn = opts.sleep ?? sleepWithAbort
  const base = deviceBaseUrl(device)
  const ac = new AbortController()
  const external = opts.signal

  const onExternalAbort = () => ac.abort()
  if (external) {
    if (external.aborted) ac.abort()
    else external.addEventListener('abort', onExternalAbort, { once: true })
  }

  let canceled = false
  let jobUrl: string | null = null

  const throwIfCanceled = () => {
    if (canceled || ac.signal.aborted) {
      throw new ScanError('canceled', 'Scan canceled')
    }
  }

  // Preflight ADF empty via ScannerStatus (Canon TR4500 / EPSON encoding).
  if (!opts.skipStatusCheck && options.source === 'Adf') {
    await checkAdfStatus(base, fetchImpl, ac.signal)
  }

  throwIfCanceled()

  const settingsXml = buildScanSettingsXml(options)
  let res: Response
  try {
    res = await fetchImpl(`${base}/ScanJobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
      body: settingsXml,
      signal: ac.signal,
    })
  } catch (err) {
    throwIfCanceled()
    throw new ScanError(
      'not-reachable',
      `ScanJobs POST failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // 409 Conflict — some vendors refuse empty ADF this way (not via status).
  if (res.status === 409) {
    throw new ScanError(
      'adf-empty',
      'The automatic document feeder is empty. Load pages and try again.',
    )
  }
  if (res.status === 401 || res.status === 403) {
    throw new ScanError(
      'not-reachable',
      `Scanner requires authentication (HTTP ${res.status}). KeepR does not yet support authenticated eSCL devices.`,
    )
  }
  if (res.status === 503) {
    throw new ScanError('busy', 'Scanner is busy (HTTP 503 on ScanJobs). Try again shortly.')
  }
  if (res.status !== 201) {
    // Attempt to read body for diagnostics; ignore failures.
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 200)
    } catch {
      /* ignore */
    }
    throw new ScanError(
      'protocol',
      `ScanJobs expected HTTP 201, got ${res.status}${detail ? `: ${detail}` : ''}`,
    )
  }

  const location = res.headers.get('Location') ?? res.headers.get('location')
  if (!location) {
    throw new ScanError('protocol', 'ScanJobs response missing Location header')
  }
  jobUrl = resolveJobUrl(base, location)

  const handle: ScanJobHandle = {
    get jobUrl() {
      return jobUrl
    },
    get canceled() {
      return canceled
    },
    async cancel() {
      canceled = true
      ac.abort()
      if (external) external.removeEventListener('abort', onExternalAbort)
      if (jobUrl) {
        try {
          await fetchImpl(jobUrl, { method: 'DELETE' })
        } catch {
          /* best-effort cleanup */
        }
      }
    },
    async run(onPage) {
      let pageIndex = 0
      let busyElapsed = 0
      let busyTotal = 0

      try {
        for (;;) {
          throwIfCanceled()
          const nextUrl = jobUrl!.endsWith('/')
            ? `${jobUrl}NextDocument`
            : `${jobUrl}/NextDocument`

          let pageRes: Response
          try {
            pageRes = await fetchImpl(nextUrl, { method: 'GET', signal: ac.signal })
          } catch (err) {
            throwIfCanceled()
            throw new ScanError(
              'not-reachable',
              `NextDocument failed: ${err instanceof Error ? err.message : String(err)}`,
            )
          }

          if (pageRes.status === 404) {
            // Normal end of multi-page job.
            break
          }

          if (pageRes.status === 503) {
            if (busyTotal >= RETRY_BUDGET_TOTAL_MS) {
              throw new ScanError(
                'busy',
                `Scanner spent more than ${RETRY_BUDGET_TOTAL_MS / 1000}s total busy (HTTP 503) across this job.`,
              )
            }
            if (busyElapsed >= RETRY_BUDGET_MS) {
              throw new ScanError(
                'busy',
                `Scanner stayed busy (HTTP 503) for more than ${RETRY_BUDGET_MS / 1000}s.`,
              )
            }
            const attempt = Math.floor(busyElapsed / BACKOFF_BASE_MS)
            const exp = Math.min(BACKOFF_BASE_MS * 2 ** Math.min(attempt, 4), BACKOFF_MAX_MS)
            const remaining = RETRY_BUDGET_MS - busyElapsed
            // Jitter: 50%–100% of exponential delay, capped by remaining budget.
            const jittered = Math.min(remaining, Math.floor(exp * (0.5 + Math.random() * 0.5)))
            const delay = Math.max(50, jittered)
            await sleepFn(delay, ac.signal)
            busyElapsed += delay
            busyTotal += delay
            continue
          }

          if (pageRes.status === 401 || pageRes.status === 403) {
            throw new ScanError(
              'not-reachable',
              `Scanner requires authentication (HTTP ${pageRes.status}) during NextDocument.`,
            )
          }

          if (pageRes.status !== 200) {
            throw new ScanError(
              'protocol',
              `NextDocument unexpected HTTP ${pageRes.status}`,
            )
          }

          // Reset busy budget after a successful page.
          busyElapsed = 0

          const contentType = (pageRes.headers.get('Content-Type') ?? '').split(';')[0]?.trim() ?? ''
          const bytes = Buffer.from(await readBody(pageRes))

          if (bytes.length === 0) {
            throw new ScanError('protocol', 'NextDocument returned empty body')
          }
          if (contentType && !isImageContentType(contentType)) {
            throw new ScanError(
              'protocol',
              `NextDocument Content-Type is not an image (${contentType || 'missing'})`,
            )
          }

          pageIndex += 1
          await onPage(pageIndex, bytes, contentType || 'image/jpeg')
        }

        return { pages: pageIndex }
      } finally {
        if (external) external.removeEventListener('abort', onExternalAbort)
        // Best-effort job cleanup when we finish normally (not already canceled).
        if (!canceled && jobUrl) {
          try {
            await fetchImpl(jobUrl, { method: 'DELETE' })
          } catch {
            /* ignore */
          }
        }
      }
    },
  }

  return handle
}

/** Convenience: create + run in one shot. */
export async function runScanJob(
  device: ScanDevice,
  options: ScanOptions,
  onPage: PageCallback,
  opts?: CreateJobOpts,
): Promise<{ pages: number; handle: ScanJobHandle }> {
  const handle = await createScanJob(device, options, opts)
  try {
    const result = await handle.run(onPage)
    return { ...result, handle }
  } catch (err) {
    if (!handle.canceled) {
      try {
        await handle.cancel()
      } catch {
        /* ignore */
      }
    }
    throw err
  }
}

export function buildScanSettingsXml(options: ScanOptions): string {
  // eSCL/PWG: ADF is InputSource "Feeder"; our options API uses "Adf".
  const inputSource = options.source === 'Adf' ? 'Feeder' : 'Platen'
  const duplex =
    options.source === 'Adf' && options.duplex === true ? 'true' : 'false'
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" ` +
    `xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">` +
    `<pwg:Version>2.6</pwg:Version>` +
    `<pwg:InputSource>${inputSource}</pwg:InputSource>` +
    `<scan:ColorMode>${options.colorMode}</scan:ColorMode>` +
    `<scan:XResolution>${options.dpi}</scan:XResolution>` +
    `<scan:YResolution>${options.dpi}</scan:YResolution>` +
    `<pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>` +
    `<scan:DocumentFormatExt>image/jpeg</scan:DocumentFormatExt>` +
    `<scan:Duplex>${duplex}</scan:Duplex>` +
    `</scan:ScanSettings>`
  )
}

async function checkAdfStatus(
  base: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<void> {
  let res: Response
  try {
    res = await fetchImpl(`${base}/ScannerStatus`, { method: 'GET', signal })
  } catch (err) {
    if (signal.aborted) throw new ScanError('canceled', 'Scan canceled')
    // Status optional on some devices — soft-fail to not block Platen-like quirks.
    return
  }
  if (!res.ok) return
  const xml = await res.text()
  let parsed: unknown
  try {
    parsed = parseXml(xml)
  } catch {
    return
  }
  const adfState = firstText(parsed, 'AdfState')
  if (
    adfState === 'ScannerAdfEmpty' ||
    adfState === 'ScannerAdfProcessing' // Kyocera: treated as empty at start
  ) {
    throw new ScanError(
      'adf-empty',
      'The automatic document feeder is empty. Load pages and try again.',
    )
  }
}

function resolveJobUrl(base: string, location: string): string {
  if (/^https?:\/\//i.test(location)) {
    // Trust path only: re-host to our known device base origin.
    try {
      const loc = new URL(location)
      const baseUrl = new URL(base.endsWith('/') ? base : base + '/')
      return `${baseUrl.protocol}//${baseUrl.host}${loc.pathname}${loc.search}`
    } catch {
      return location
    }
  }
  if (location.startsWith('/')) {
    const baseUrl = new URL(base.endsWith('/') ? base : base + '/')
    return `${baseUrl.protocol}//${baseUrl.host}${location}`
  }
  // Relative to resource root.
  return `${base.replace(/\/$/, '')}/${location.replace(/^\//, '')}`
}

function isImageContentType(ct: string): boolean {
  const c = ct.toLowerCase()
  return c.startsWith('image/') || c === 'application/octet-stream'
}

/** Read full body (chunked or Content-Length) to a Buffer. */
async function readBody(res: Response): Promise<ArrayBuffer> {
  // fetch already reassembles chunked transfer; arrayBuffer() covers both cases.
  return res.arrayBuffer()
}

export async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new ScanError('canceled', 'Scan canceled')
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new ScanError('canceled', 'Scan canceled'))
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
  })
}
