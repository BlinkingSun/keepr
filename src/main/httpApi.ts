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
 * Routes belonging to lanes that have not landed yet return 501 with the lane
 * named. That distinction matters to whoever is testing: "not built" and "broken"
 * demand completely different responses, and a 500 hides which one it is.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
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

const notImplemented = (lane: string, what: string): Handler => async () => ({
  status: 501,
  body: {
    error: 'not_implemented',
    lane,
    detail: `${what} arrives with Lane ${lane}. This endpoint is declared but not yet built — it is not failing.`,
  },
})

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

  // Declared, not yet built. Named by lane so a tester knows what to expect.
  'POST /import': notImplemented('C', 'Import and the Inbox queue'),
  'GET /search': notImplemented('H', 'Search'),
  'GET /search/missing': notImplemented('H', 'Find-missing-key-data'),
  'POST /items/:id/split': notImplemented('I', 'Receipt splitting'),
  'POST /items/combine': notImplemented('I', 'Combine'),
  'POST /items/:id/separate': notImplemented('I', 'Separate'),
  'POST /export/csv': notImplemented('J', 'CSV export'),
  'POST /export/xlsx': notImplemented('J', 'Excel export'),
  'POST /export/pdf': notImplemented('J', 'Searchable PDF export'),
  'POST /backup': notImplemented('K', 'Backup'),
  'POST /restore': notImplemented('K', 'Restore'),
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
