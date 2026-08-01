/**
 * Scan service — Lane V integration, owned by the orchestrator.
 *
 * Composes Lane S's protocol client (discovery, capabilities, scanAndIngest) with
 * the app context and event bus. Owns the live-job table so cancel works and a
 * second scan cannot start while one is running on the same device.
 *
 * Devices are cached by id between discoveries because scan:start receives only
 * a deviceId — the renderer never handles hosts or ports directly.
 */
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import type { ScanCaps, ScanDevice, ScanOptions } from '../shared/types.ts'
import { discoverScanners, probeScanner, fetchCapabilities, scanAndIngest, ScanError } from '../scan/index.ts'
import { importPagesAsItem } from '../ingest/index.ts'
import type { AppContext } from './context.ts'
import { mainEvents } from './events.ts'

interface LiveScan {
  controller: AbortController
  deviceId: string
}

const devices = new Map<string, ScanDevice>()
const liveScans = new Map<string, LiveScan>()

export const scanService = {
  async discover(ctx: AppContext, timeoutMs?: number): Promise<{ devices: ScanDevice[] }> {
    const found = await discoverScanners(timeoutMs === undefined ? {} : { timeoutMs })
    for (const d of found) devices.set(d.id, d)
    return { devices: [...devices.values()] }
  },

  async probe(
    _ctx: AppContext,
    host: string,
    port?: number,
    root?: string,
  ): Promise<{ device: ScanDevice | null; error?: string }> {
    try {
      const device = await probeScanner(host, port ?? 80, root ?? 'eSCL')
      if (device) devices.set(device.id, device)
      return { device }
    } catch (e) {
      return { device: null, error: (e as Error).message }
    }
  },

  async capabilities(_ctx: AppContext, deviceId: string): Promise<ScanCaps> {
    const device = devices.get(deviceId)
    if (!device) throw new Error('scanner not found — refresh the device list')
    if (device.secure) {
      throw new Error('TLS-only scanners are not supported yet — enable HTTP (eSCL) on the device if possible')
    }
    return fetchCapabilities(device)
  },

  async start(ctx: AppContext, deviceId: string, options: ScanOptions): Promise<{ jobId: string }> {
    const device = devices.get(deviceId)
    if (!device) throw new Error('scanner not found — refresh the device list')
    if ([...liveScans.values()].some((s) => s.deviceId === deviceId)) {
      throw new Error('a scan is already running on this device')
    }
    // Reserve the device SYNCHRONOUSLY. The check above and jobs.create below
    // are separated by an await, so two concurrent scan:start calls both passed
    // the check — the audit's dual-start race. The placeholder closes the gap;
    // it is replaced by the real entry (or removed on failure) below.
    const reservation = `reserve:${deviceId}`
    const controller = new AbortController()
    liveScans.set(reservation, { controller, deviceId })

    let job
    try {
      job = await ctx.jobs.create('import', 0, { source: 'scan', deviceId })
    } finally {
      liveScans.delete(reservation)
    }
    liveScans.set(job.id, { controller, deviceId })

    // Staged under the library so the temp files live on the same volume as
    // their final home — moves stay atomic renames, and startup can sweep
    // orphans from crashes in one place.
    const tmpDir = path.join(ctx.libraryRoot, '.scan-tmp', job.id)
    mkdirSync(tmpDir, { recursive: true })

    // Deliberately not awaited: scan:start returns the job id immediately and
    // the renderer follows scan:* events. Errors terminate the job row too, so
    // the headless API sees the truth without listening to events.
    void (async () => {
      try {
        const result = await scanAndIngest(
          {
            importPagesAsItem: (args) => importPagesAsItem(ctx.ingest(), args),
            emit: (channel, payload) => mainEvents.emit(channel, payload as never),
            // Cancellation rides the protocol client's job options: every HTTP
            // wait inside the page loop races this signal.
            jobOpts: { signal: controller.signal },
          },
          device,
          options,
          {
            jobId: job.id,
            tmpDir,
            oldReceiptsDir: ctx.oldReceiptsDir,
            newReceiptsDir: ctx.newReceiptsDir,
          },
        )
        await ctx.jobs.update(job.id, {
          status: 'done',
          doneUnits: result.pages,
          detail: result.jobDetail,
        })
        mainEvents.emit('item:changed', { itemIds: [result.itemId], reason: 'import' })
      } catch (e) {
        const err = e as ScanError | Error
        const code = err instanceof ScanError ? err.code : 'protocol'
        await ctx.jobs.update(job.id, { status: code === 'canceled' ? 'cancelled' : 'failed', error: err.message })
        mainEvents.emit('scan:error', { jobId: job.id, code, message: err.message })
      } finally {
        liveScans.delete(job.id)
        rmSync(tmpDir, { recursive: true, force: true })
      }
    })()

    return { jobId: job.id }
  },

  cancel(_ctx: AppContext, jobId: string): { ok: boolean } {
    const live = liveScans.get(jobId)
    if (!live) return { ok: false }
    live.controller.abort()
    return { ok: true }
  },

  /**
   * Crash hygiene: remove ABANDONED staging only.
   *
   * The first version deleted all of .scan-tmp at startup — and two app
   * instances on one library meant instance B wiped instance A's pages mid-scan
   * (the audit's finding). Now a staging dir is swept only when no live scan in
   * THIS process owns it AND it has been untouched for 15+ minutes, which no
   * in-flight scan plausibly is.
   */
  sweepTmp(ctx: AppContext): void {
    const root = path.join(ctx.libraryRoot, '.scan-tmp')
    let entries: string[]
    try { entries = readdirSync(root) } catch { return }
    const cutoff = Date.now() - 15 * 60 * 1000
    for (const name of entries) {
      if (liveScans.has(name)) continue
      const dir = path.join(root, name)
      try {
        if (statSync(dir).mtimeMs < cutoff) rmSync(dir, { recursive: true, force: true })
      } catch { /* raced with another instance — leave it */ }
    }
  },
}
