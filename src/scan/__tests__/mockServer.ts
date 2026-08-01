/**
 * In-process mock eSCL HTTP server for Lane S tests.
 * No real network devices; binds 127.0.0.1 only.
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  FIXTURE_BROTHER_SCAN_PREFIX,
  FIXTURE_HP_PWG_PREFIX,
  FIXTURE_PDF_ONLY_ADF,
  FIXTURE_STATUS_ADF_EMPTY,
  FIXTURE_STATUS_ADF_LOADED,
  TINY_JPEG,
} from './fixtures.ts'

export type CapsFixture = 'brother' | 'hp' | 'pdf-only'

export interface MockEsclOptions {
  caps?: CapsFixture
  /** Number of pages to serve before 404. */
  pageCount?: number
  /** Page body encoding: Content-Length vs chunked. */
  transfer?: 'identity' | 'chunked'
  /** How many NextDocument calls return 503 before succeeding. */
  busyCount?: number
  /** Permanent 503 on NextDocument. */
  permanentBusy?: boolean
  /** ScannerStatus AdfEmpty. */
  adfEmpty?: boolean
  /** POST ScanJobs returns 409 (vendor empty-ADF encoding). */
  scanJobsConflict?: boolean
  /** Require auth: 401 on everything. */
  requireAuth?: boolean
  /** Delay before each NextDocument 200 (ms). */
  pageDelayMs?: number
  /** Custom page payloads (default TINY_JPEG × pageCount). */
  pages?: Buffer[]
  root?: string
}

export interface MockEsclServer {
  host: string
  port: number
  root: string
  baseUrl: string
  /** Absolute job URLs that received DELETE. */
  deletedJobs: string[]
  /** Number of ScanJobs POSTs accepted. */
  jobsCreated: number
  /** Number of NextDocument attempts (including 503s). */
  nextDocumentHits: number
  close(): Promise<void>
  setAdfEmpty(empty: boolean): void
  setBusyRemaining(n: number): void
}

export async function startMockEscl(opts: MockEsclOptions = {}): Promise<MockEsclServer> {
  const root = (opts.root ?? 'eSCL').replace(/^\/+|\/+$/g, '')
  const pageCount = opts.pageCount ?? 2
  const pages = opts.pages ?? Array.from({ length: pageCount }, () => Buffer.from(TINY_JPEG))
  const transfer = opts.transfer ?? 'identity'
  let busyRemaining = opts.busyCount ?? 0
  const permanentBusy = opts.permanentBusy ?? false
  let adfEmpty = opts.adfEmpty ?? false
  const scanJobsConflict = opts.scanJobsConflict ?? false
  const requireAuth = opts.requireAuth ?? false
  const pageDelayMs = opts.pageDelayMs ?? 0

  const capsXml = pickCaps(opts.caps ?? 'brother')
  const deletedJobs: string[] = []
  let jobsCreated = 0
  let nextDocumentHits = 0
  let jobSeq = 0
  const jobs = new Map<string, { pagesSent: number }>()

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1`)
    const pathname = url.pathname

    if (requireAuth) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="eSCL"' })
      res.end('Unauthorized')
      return
    }

    // GET /{root}/ScannerCapabilities
    if (req.method === 'GET' && pathname === `/${root}/ScannerCapabilities`) {
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' })
      res.end(capsXml)
      return
    }

    // GET /{root}/ScannerStatus
    if (req.method === 'GET' && pathname === `/${root}/ScannerStatus`) {
      const body = adfEmpty ? FIXTURE_STATUS_ADF_EMPTY : FIXTURE_STATUS_ADF_LOADED
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' })
      res.end(body)
      return
    }

    // POST /{root}/ScanJobs
    if (req.method === 'POST' && pathname === `/${root}/ScanJobs`) {
      drain(req).then(() => {
        if (scanJobsConflict) {
          res.writeHead(409, { 'Content-Type': 'text/plain' })
          res.end('ADF empty')
          return
        }
        if (adfEmpty) {
          // Some devices still accept job creation; status check should catch empty.
          // We allow creation so status-path tests remain distinct from 409 path.
        }
        jobSeq += 1
        jobsCreated += 1
        const jobPath = `/${root}/ScanJobs/${jobSeq}`
        jobs.set(jobPath, { pagesSent: 0 })
        res.writeHead(201, {
          Location: jobPath,
          'Content-Type': 'text/plain',
        })
        res.end()
      })
      return
    }

    // DELETE /{root}/ScanJobs/{id}
    if (req.method === 'DELETE' && pathname.startsWith(`/${root}/ScanJobs/`)) {
      deletedJobs.push(pathname)
      jobs.delete(pathname)
      res.writeHead(200)
      res.end()
      return
    }

    // GET /{root}/ScanJobs/{id}/NextDocument
    const nextMatch = pathname.match(
      new RegExp(`^/${root}/ScanJobs/(\\d+)/NextDocument$`),
    )
    if (req.method === 'GET' && nextMatch) {
      const jobPath = `/${root}/ScanJobs/${nextMatch[1]}`
      nextDocumentHits += 1
      const job = jobs.get(jobPath)
      if (!job) {
        res.writeHead(404)
        res.end()
        return
      }

      const serve = () => {
        if (permanentBusy || busyRemaining > 0) {
          if (!permanentBusy) busyRemaining -= 1
          res.writeHead(503, { 'Content-Type': 'text/plain', 'Retry-After': '1' })
          res.end('Busy')
          return
        }

        if (job.pagesSent >= pages.length) {
          res.writeHead(404)
          res.end()
          return
        }

        const body = pages[job.pagesSent]!
        job.pagesSent += 1

        if (transfer === 'chunked') {
          res.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'Transfer-Encoding': 'chunked',
          })
          // Node will chunk automatically when we write without Content-Length.
          res.write(body.subarray(0, Math.ceil(body.length / 2)))
          res.write(body.subarray(Math.ceil(body.length / 2)))
          res.end()
        } else {
          res.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'Content-Length': body.length,
          })
          res.end(body)
        }
      }

      if (pageDelayMs > 0) setTimeout(serve, pageDelayMs)
      else serve()
      return
    }

    res.writeHead(404)
    res.end('not found')
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const addr = server.address() as AddressInfo

  return {
    host: '127.0.0.1',
    port: addr.port,
    root,
    baseUrl: `http://127.0.0.1:${addr.port}/${root}`,
    deletedJobs,
    get jobsCreated() {
      return jobsCreated
    },
    get nextDocumentHits() {
      return nextDocumentHits
    },
    setAdfEmpty(empty: boolean) {
      adfEmpty = empty
    },
    setBusyRemaining(n: number) {
      busyRemaining = n
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      })
    },
  }
}

function pickCaps(kind: CapsFixture): string {
  switch (kind) {
    case 'hp':
      return FIXTURE_HP_PWG_PREFIX
    case 'pdf-only':
      return FIXTURE_PDF_ONLY_ADF
    case 'brother':
    default:
      return FIXTURE_BROTHER_SCAN_PREFIX
  }
}

function drain(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
