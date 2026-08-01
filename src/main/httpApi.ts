/**
 * Headless test API — Lane 0, owned by the orchestrator.
 *
 * Team policy: every program we build exposes an API so the auditor can validate
 * features without a GUI. Every acceptance criterion in PLAN.md §8 is written as
 * a call against this surface, which is why it exists at all — "it looks right"
 * is not a test.
 *
 * Bound to 127.0.0.1 only. This is a local tool with no authentication; binding
 * it to a routable interface would expose the whole library to the network.
 *
 * Every route here is now WIRED to its lane. Earlier the wave-4 routes returned
 * 501 naming the lane, which was honest but meant the program could not actually
 * do its job: the modules existed and nothing could reach them.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { importFiles } from '../ingest/index.ts'
import { search, missingKeyData } from '../search/index.ts'
import { splitReceipt, combineItems, separateItem } from '../splitting/index.ts'
import { exportCsv, exportXlsx, exportPdf } from '../export/index.ts'
import { backup, restore, archive, emptyTrash } from '../maintenance/index.ts'
import type { AppContext } from './context.ts'
import { checkIntegrity } from './db.ts'

export const KEEPR_DEFAULT_PORT = 17915

const VERSION = '0.1.0'

type Handler = (
  ctx: AppContext,
  req: IncomingMessage,
  url: URL,
  body: any,
  /** Numeric :id segment, when it parsed as a number. */
  id?: number,
  /** Raw :id / :name segment, for string keys like job uuids and list names. */
  raw?: string,
) => Promise<{ status?: number; body: unknown }>

const num = (v: string | null): number | undefined => {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}
const bool = (v: string | null): boolean | undefined =>
  v == null || v === '' ? undefined : v === '1' || v.toLowerCase() === 'true'

/** method + path -> handler. Path matching is exact or a single :id segment. */
const routes: Record<string, Handler> = {
  'GET /health': async (ctx) => ({
    body: {
      ok: true,
      version: VERSION,
      schemaVersion: ctx.schemaVersion,
      libraryRoot: ctx.libraryRoot,
      dbPath: ctx.dbPath,
      inboxId: ctx.inboxId,
      trashId: ctx.trashId,
      pid: process.pid,
    },
  }),

  'GET /integrity': async (ctx) => {
    const checks = checkIntegrity(ctx.db)
    return { status: checks.every((c) => c.ok) ? 200 : 500, body: { ok: checks.every((c) => c.ok), checks } }
  },

  'GET /folders': async (ctx) => ({ body: { folders: ctx.repos.folders.list() } }),

  'POST /folders': async (ctx, _r, _u, body) => {
    if (!body?.name) return { status: 400, body: { error: 'name is required' } }
    return { status: 201, body: ctx.repos.folders.create({ parentId: body.parentId ?? null, name: body.name }) }
  },

  'GET /items': async (ctx, _r, url) => {
    const res = ctx.repos.items.list({
      folderId: num(url.searchParams.get('folder')),
      includeSubfolders: bool(url.searchParams.get('subfolders')),
      type: (url.searchParams.get('type') as any) ?? undefined,
      smartFilter: (url.searchParams.get('filter') as any) ?? undefined,
      includeSuperseded: bool(url.searchParams.get('includeSuperseded')),
      limit: num(url.searchParams.get('limit')),
      offset: num(url.searchParams.get('offset')),
    })
    return { body: res }
  },

  'GET /items/:id': async (ctx, _r, _u, _b, id?: number) => {
    const detail = ctx.repos.items.detail(id!)
    return detail ? { body: detail } : { status: 404, body: { error: 'not_found' } }
  },

  'PATCH /items/:id': async (ctx, _r, _u, body, id?: number) => {
    const res = ctx.repos.items.patch(id!, body ?? {})
    return { status: res.ok ? 200 : 422, body: res }
  },

  'POST /items/:id/trash': async (ctx, _r, _u, _b, id?: number) => ({
    body: ctx.repos.items.trash(id!),
  }),
  'POST /items/:id/restore': async (ctx, _r, _u, _b, id?: number) => ({
    body: ctx.repos.items.restore(id!),
  }),

  'POST /items/bulk': async (ctx, _r, _u, body) => {
    if (!Array.isArray(body?.ids)) return { status: 400, body: { error: 'ids[] required' } }
    return { body: ctx.repos.items.bulk(body.op, body.ids, body.targetFolderId) }
  },

  'GET /jobs/:id': async (ctx, _r, _u, _b, _id?: number, raw?: string) => {
    const job = await ctx.jobs.get(raw!)
    return job ? { body: job } : { status: 404, body: { error: 'not_found' } }
  },

  'POST /jobs/:id/cancel': async (ctx, _r, _u, _b, _id?: number, raw?: string) => {
    await ctx.jobs.cancel(raw!)
    return { body: { ok: true } }
  },

  'GET /lists/:name': async (ctx, _r, _u, _b, _id?: number, raw?: string) => {
    const all = ctx.repos.lists.all(raw as any)
    return { body: { values: all } }
  },

  // ---- wave 4, wired ------------------------------------------------------
  'POST /import': async (ctx, _r, _u, body) => {
    if (!Array.isArray(body?.paths) || body.paths.length === 0) {
      return { status: 400, body: { error: 'paths[] required' } }
    }
    const res = await importFiles(ctx.ingest(), {
      paths: body.paths,
      ...(body.targetFolderId === undefined ? {} : { targetFolderId: body.targetFolderId }),
      ...(body.toInbox === undefined ? {} : { toInbox: body.toInbox }),
      ...(body.awaitOcr === undefined ? {} : { awaitOcr: body.awaitOcr }),
      ...(body.skipDuplicates === undefined ? {} : { skipDuplicates: body.skipDuplicates }),
    })
    return { status: 201, body: res }
  },

  'GET /search': async (ctx, _r, url) => {
    const p = url.searchParams
    const missing = p.get('missing')
    return {
      body: search(ctx.db, {
        ...(p.get('q') ? { q: p.get('q')! } : {}),
        ...(num(p.get('folder')) === undefined ? {} : { folderId: num(p.get('folder')) }),
        ...(bool(p.get('subfolders')) === undefined ? {} : { includeSubfolders: bool(p.get('subfolders')) }),
        ...(p.get('type') ? { type: p.get('type') as never } : {}),
        ...(num(p.get('vendor')) === undefined ? {} : { vendorId: num(p.get('vendor')) }),
        ...(num(p.get('category')) === undefined ? {} : { categoryId: num(p.get('category')) }),
        ...(p.get('dateFrom') ? { dateFrom: p.get('dateFrom') as never } : {}),
        ...(p.get('dateTo') ? { dateTo: p.get('dateTo') as never } : {}),
        ...(num(p.get('amountMin')) === undefined ? {} : { amountMinMinor: num(p.get('amountMin')) as never }),
        ...(num(p.get('amountMax')) === undefined ? {} : { amountMaxMinor: num(p.get('amountMax')) as never }),
        ...(missing ? { missing: missing.split(',') as never } : {}),
        ...(bool(p.get('includeTrashed')) === undefined ? {} : { includeTrashed: bool(p.get('includeTrashed')) }),
        ...(num(p.get('limit')) === undefined ? {} : { limit: num(p.get('limit')) }),
        ...(num(p.get('offset')) === undefined ? {} : { offset: num(p.get('offset')) }),
      }),
    }
  },

  'GET /search/missing': async (ctx, _r, url) => ({
    body: { rows: missingKeyData(ctx.db, num(url.searchParams.get('folder'))) },
  }),

  'POST /items/:id/split': async (ctx, _r, _u, body, id) => {
    if (!Array.isArray(body?.parts)) return { status: 400, body: { error: 'parts[] required' } }
    return { body: splitReceipt(ctx.db, id!, body.parts) }
  },
  'POST /items/combine': async (ctx, _r, _u, body) => {
    if (!Array.isArray(body?.ids) || body.ids.length < 2) {
      return { status: 400, body: { error: 'ids[] with at least two items required' } }
    }
    return { body: combineItems(ctx.db, body.ids) }
  },
  'POST /items/:id/separate': async (ctx, _r, _u, _b, id) => ({ body: separateItem(ctx.db, id!) }),

  'POST /export/csv': async (ctx, _r, _u, body) => exportRoute(ctx, body, 'csv'),
  'POST /export/xlsx': async (ctx, _r, _u, body) => exportRoute(ctx, body, 'xlsx'),
  'POST /export/pdf': async (ctx, _r, _u, body) => exportRoute(ctx, body, 'pdf'),

  'POST /backup': async (ctx, _r, _u, body) => ({ body: backup(ctx.maintenance(), body?.destPath) }),
  'POST /restore': async (ctx, _r, _u, body) => {
    if (!body?.srcPath) return { status: 400, body: { error: 'srcPath required' } }
    const res = await restore(ctx.maintenance(), body.srcPath)
    return { status: res.ok ? 200 : 422, body: res }
  },
  'POST /archive': async (ctx, _r, _u, body) => {
    if (!body?.cutoff) return { status: 400, body: { error: 'cutoff (YYYY-MM-DD) required' } }
    return { body: archive(ctx.maintenance(), body.cutoff, body.destPath) }
  },
  'POST /trash/empty': async (ctx) => ({ body: emptyTrash(ctx.maintenance()) }),

  // Headless watcher visibility. The audit could not assert the New→Old
  // acceptance flow over HTTP without sniffing the filesystem; CI has the same
  // problem. GET mirrors watcher:status; POST /watcher/tick forces one pass so a
  // test does not have to sleep through the poll interval.
  'GET /watcher': async (ctx) => ({ body: ctx.watcherStatus() }),
  'POST /watcher/tick': async (ctx) => {
    const r = await ctx.tickWatcher()
    return { body: r ?? { ticked: false, reason: 'watcher not running' } }
  },
}

/** Shared by the three export routes: they differ only in the writer. */
async function exportRoute(
  ctx: AppContext,
  body: any,
  format: 'csv' | 'xlsx' | 'pdf',
): Promise<{ status?: number; body: unknown }> {
  if (!body?.destPath) return { status: 400, body: { error: 'destPath required' } }
  const req = { ...body, format }
  const exportCtx = { jobs: ctx.jobs, fileStore: ctx.fileStore, libraryRoot: ctx.libraryRoot }
  const path =
    format === 'csv' ? await exportCsv(ctx.db, req, exportCtx)
    : format === 'xlsx' ? await exportXlsx(ctx.db, req, exportCtx)
    : await exportPdf(ctx.db, req, exportCtx)
  return { body: { path, format } }
}

function matchRoute(method: string, pathname: string): { handler: Handler; id?: string; tail?: string } | null {
  const exact = routes[`${method} ${pathname}`]
  if (exact) return { handler: exact }

  const segs = pathname.split('/').filter(Boolean)
  // /items/:id, /jobs/:id, /lists/:name
  if (segs.length === 2) {
    const h = routes[`${method} /${segs[0]}/:${segs[0] === 'lists' ? 'name' : 'id'}`]
    if (h) return { handler: h, id: segs[1], tail: segs[1] }
  }
  // /items/:id/trash etc.
  if (segs.length === 3) {
    const h = routes[`${method} /${segs[0]}/:id/${segs[2]}`]
    if (h) return { handler: h, id: segs[1], tail: segs[1] }
  }
  return null
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    // A local test API has no business accepting an unbounded upload.
    if (size > 8 * 1024 * 1024) throw new Error('request body too large')
    chunks.push(c as Buffer)
  }
  if (!chunks.length) return undefined
  const raw = Buffer.concat(chunks).toString('utf8')
  try { return JSON.parse(raw) } catch { throw new Error('body is not valid JSON') }
}

export function createHttpApi(ctx: AppContext): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const started = Date.now()
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const method = (req.method ?? 'GET').toUpperCase()
      const send = (status: number, body: unknown) => {
        const json = JSON.stringify(body, null, 2)
        res.writeHead(status, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(json)
      }

      try {
        const m = matchRoute(method, url.pathname)
        if (!m) return send(404, { error: 'no_such_route', method, path: url.pathname })

        const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req)
        const idNum = m.id != null ? Number(m.id) : undefined
        const out = await m.handler(
          ctx,
          req,
          url,
          body,
          Number.isFinite(idNum) ? idNum : undefined,
          m.tail,
        )
        send(out.status ?? 200, out.body)
      } catch (e) {
        // Surface the real message: this API exists to be diagnosed, and a
        // generic 500 would waste the audit cycle that follows.
        send(500, { error: 'handler_threw', detail: (e as Error).message, ms: Date.now() - started })
      }
    })()
  })
}

export function startHttpApi(ctx: AppContext, port = KEEPR_DEFAULT_PORT): Promise<Server> {
  const server = createHttpApi(ctx)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      console.log(`[keepr] test API listening on http://127.0.0.1:${port}`)
      resolve(server)
    })
  })
}
