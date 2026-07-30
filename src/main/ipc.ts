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

    // Declared in the contract, delivered by later lanes.
    'item:split': notYet('I', 'Receipt splitting'),
    'item:combine': notYet('I', 'Combine'),
    'item:separate': notYet('I', 'Separate'),
    'page:crop': notYet('G/I', 'Crop'),
    'page:import': notYet('C', 'Adding pages to an item'),
    'page:exportImage': notYet('G', 'Image export'),
    'page:assignRegion': notYet('G', 'Region-to-field assignment'),
    'ingest:import': notYet('C', 'Import'),
    'ingest:inboxCount': (c) =>
      (c.db.prepare(`SELECT count(*) count FROM item WHERE folder_id = ? AND trashed_at IS NULL`).get(c.inboxId) as { count: number }),
    'ocr:requeue': notYet('C', 'OCR requeue'),
    'ocr:status': notYet('C', 'OCR status'),
    'search:query': notYet('H', 'Search'),
    'search:missingKeyData': notYet('H', 'Find-missing-key-data'),
    'export:run': notYet('J', 'Export'),
    'rule:list': notYet('A/C', 'Rule listing'),
    'rule:upsert': notYet('A/C', 'Rule editing'),
    'maint:backup': notYet('K', 'Backup'),
    'maint:restore': notYet('K', 'Restore'),
    'maint:archive': notYet('K', 'Archive'),
    'maint:emptyTrash': notYet('K', 'Empty trash'),
    'shell:revealFile': notYet('G', 'Reveal in file manager'),
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
