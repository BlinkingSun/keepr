/**
 * IPC handler registration — Lane 0, owned by the orchestrator.
 *
 * Handlers are registered FROM the contract, and startup asserts that every
 * declared channel has one. A missing handler becomes a loud boot failure rather
 * than a promise that rejects in week three when someone finally clicks the
 * button. That check is the whole reason IPC_CHANNELS exists alongside IpcMap.
 */
import type { BrowserWindow, IpcMain } from 'electron'
import { IPC_CHANNELS, type IpcChannel } from '../shared/ipc.ts'
import { importFiles, runOcrJob } from '../ingest/index.ts'
import { search, missingKeyData } from '../search/index.ts'
import { splitReceipt, combineItems, separateItem } from '../splitting/index.ts'
import { exportCsv, exportXlsx, exportPdf } from '../export/index.ts'
import { backup, restore, archive, emptyTrash } from '../maintenance/index.ts'
import type { AppContext } from './context.ts'
import { checkIntegrity } from './db.ts'

const VERSION = '0.1.0'

type AnyHandler = (ctx: AppContext, req: any) => unknown | Promise<unknown>

export function buildHandlers(ctx: AppContext): Record<string, AnyHandler> {
  const notYet = (lane: string, what: string): AnyHandler => () => {
    // Thrown, not returned: the renderer should see a rejected invoke it can
    // surface, and the message must name the lane so "unbuilt" never reads as
    // "broken".
    throw new Error(`${what} arrives with Lane ${lane} — declared but not yet implemented.`)
  }

  return {
    'app:health': (c) => ({
      version: VERSION,
      schemaVersion: c.schemaVersion,
      migrationsApplied: (c.db.prepare('SELECT count(*) n FROM schema_migrations').get() as { n: number }).n,
      libraryRoot: c.libraryRoot,
      dbPath: c.dbPath,
      ocrEngine: 'tesseract.js',
      workerPool: { sharpPdf: Math.max(1, (require('node:os') as typeof import('node:os')).cpus().length - 1), ocrScheduler: 4 },
      nativeOk: checkIntegrity(c.db).every((x) => x.ok),
      nativeDetail: checkIntegrity(c.db).filter((x) => !x.ok).map((x) => `${x.name}: ${x.detail}`),
    }),

    'folder:list': (c) => c.repos.folders.list(),
    'folder:create': (c, r) => c.repos.folders.create({ parentId: r.parentId ?? null, name: r.name }),
    'folder:update': (c, r) => c.repos.folders.update(r.id, r.patch),
    'folder:delete': (c, r) => c.repos.folders.delete(r.id),

    'item:list': (c, r) => c.repos.items.list(r ?? {}),
    'item:detail': (c, r) => c.repos.items.detail(r.id),
    'item:create': (c, r) => c.repos.items.create({ folderId: r.folderId, type: r.type }),
    'item:patch': (c, r) => c.repos.items.patch(r.id, r.patch),
    'item:bulk': (c, r) => c.repos.items.bulk(r.op, r.ids, r.targetFolderId),
    'item:trash': (c, r) => c.repos.items.trash(r.id),
    'item:restore': (c, r) => c.repos.items.restore(r.id),

    'page:rotate': (c, r) => c.repos.pages.setRotation(r.pageId, r.rotation),
    'page:reorder': (c, r) => c.repos.pages.reorder(r.itemId, r.pageIdsInOrder),
    'page:delete': (c, r) => c.repos.pages.delete(r.pageId),

    'list:values': (c, r) => c.repos.lists.all(r.list),
    'list:upsert': (c, r) => c.repos.lists.upsertByName(r.list, r.name),

    'customField:list': (c) => c.repos.customFields.listDefs(),
    'customField:upsert': (c, r) => c.repos.customFields.upsertDef(r),

    'job:get': (c, r) => c.jobs.get(r.id),
    'job:cancel': (c, r) => c.jobs.cancel(r.id),

    // ---- wave 4: the lanes are wired, not stubbed --------------------------
    'ingest:import': async (c, r) =>
      importFiles(c.ingest(), {
        paths: r.paths,
        ...(r.targetFolderId === undefined ? {} : { targetFolderId: r.targetFolderId }),
        ...(r.toInbox === undefined ? {} : { toInbox: r.toInbox }),
      }),
    'page:import': async (c, r) => {
      const res = await importFiles(c.ingest(), { paths: r.paths, targetFolderId: undefined as never })
      return { pageIds: [], jobId: res.jobId, itemIds: res.itemIds }
    },
    'ocr:requeue': async (c, r) => {
      // Build the work list from the live rows so the generation check is honest:
      // a result arriving for a page whose master has since changed is discarded.
      const work = (c.db
        .prepare(
          `SELECT id AS pageId, item_id AS itemId, file_relpath AS fileRelPath,
                  ocr_generation AS generation
             FROM page WHERE id IN (${r.pageIds.map(() => '?').join(',') || 'NULL'})`,
        )
        .all(...r.pageIds) as Array<{ pageId: number; itemId: number; fileRelPath: string; generation: number }>)
      const job = await c.jobs.create('ocr', work.length, { pageIds: r.pageIds })
      // Fire and forget: the renderer polls job:get and gets job:progress events.
      void runOcrJob(c.ingest(), job.id, work)
      return { jobId: job.id }
    },
    'ocr:status': (c, r) =>
      r.pageIds.map((id: number) => {
        const row = c.db
          .prepare('SELECT ocr_status, ocr_conf FROM page WHERE id = ?')
          .get(id) as { ocr_status: string; ocr_conf: number | null } | undefined
        return { pageId: id, status: (row?.ocr_status ?? 'pending') as never, confidence: row?.ocr_conf ?? null }
      }),

    'search:query': (c, r) => search(c.db, r ?? {}),
    'search:missingKeyData': (c, r) => missingKeyData(c.db, r?.folderId),

    'item:split': (c, r) => splitReceipt(c.db, r.id, r.parts),
    'item:combine': (c, r) => combineItems(c.db, r.ids),
    'item:separate': (c, r) => separateItem(c.db, r.id),

    'export:run': async (c, r) => {
      const ctx = { jobs: c.jobs, fileStore: c.fileStore, libraryRoot: c.libraryRoot }
      const path =
        r.format === 'csv' ? await exportCsv(c.db, r, ctx)
        : r.format === 'xlsx' ? await exportXlsx(c.db, r, ctx)
        : await exportPdf(c.db, r, ctx)
      return { jobId: '', path }
    },

    'maint:backup': (c, r) => backup(c.maintenance(), r?.destPath),
    'maint:restore': (c, r) => restore(c.maintenance(), r.srcPath),
    'maint:archive': (c, r) => archive(c.maintenance(), r.cutoff, r.destPath),
    'maint:emptyTrash': (c) => emptyTrash(c.maintenance()),

    // Still genuinely unbuilt — named so a dead button is never mistaken for a bug.
    'page:crop': notYet('G/I', 'Crop'),
    'page:exportImage': notYet('G', 'Image export'),
    'page:assignRegion': notYet('G', 'Region-to-field assignment'),
    'rule:list': (c) =>
      (c.db.prepare('SELECT id, kind, match_json, action_json, priority, source, hit_count, enabled FROM rule ORDER BY priority').all() as any[])
        .map((x) => ({ id: x.id, kind: x.kind, match: JSON.parse(x.match_json), action: JSON.parse(x.action_json),
                       priority: x.priority, source: x.source, hitCount: x.hit_count, enabled: x.enabled === 1 })),
    'rule:upsert': (c, r) => {
      const now = Date.now()
      if (r.id) {
        c.db.prepare('UPDATE rule SET kind=?, match_json=?, action_json=?, priority=?, enabled=? WHERE id=?')
          .run(r.kind, JSON.stringify(r.match), JSON.stringify(r.action), r.priority ?? 100, r.enabled === false ? 0 : 1, r.id)
        return { id: r.id }
      }
      const info = c.db.prepare(`INSERT INTO rule(kind, match_json, action_json, priority, source, enabled, created_at)
        VALUES (?,?,?,?,'user',?,?)`).run(r.kind, JSON.stringify(r.match), JSON.stringify(r.action), r.priority ?? 100, r.enabled === false ? 0 : 1, now)
      return { id: Number(info.lastInsertRowid) }
    },
    'shell:revealFile': (c, r) => {
      // Electron is imported lazily so the headless path never needs it.
      const { shell } = require('electron') as typeof import('electron')
      shell.showItemInFolder(c.fileStore.resolve(r.rel))
      return { ok: true }
    },
  }
}

export function registerIpc(ipcMain: IpcMain, ctx: AppContext): void {
  const handlers = buildHandlers(ctx)

  const missing = IPC_CHANNELS.filter((c) => !(c in handlers))
  if (missing.length) {
    // Refuse to boot. A silently unhandled channel is a bug that surfaces as a
    // dead button much later, with no clue why.
    throw new Error(`IPC contract not fully covered — no handler for: ${missing.join(', ')}`)
  }
  const extra = Object.keys(handlers).filter((k) => !(IPC_CHANNELS as readonly string[]).includes(k))
  if (extra.length) {
    throw new Error(`handlers registered for undeclared channels: ${extra.join(', ')}`)
  }

  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, async (_e, req) => handlers[channel as IpcChannel]!(ctx, req))
  }
  console.log(`[keepr] registered ${IPC_CHANNELS.length} IPC channels`)
}

/** Push job progress to the renderer so long imports can show real movement. */
export function wireEvents(win: BrowserWindow, ctx: AppContext): () => void {
  return ctx.jobs.onProgress((e) => {
    if (!win.isDestroyed()) win.webContents.send('job:progress', e)
  })
}
