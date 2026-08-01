/**
 * Electron main — Lane 0, owned by the orchestrator.
 *
 * Two modes from one entry point, sharing one context so the headless path and
 * the windowed path cannot drift into two implementations:
 *   --serve   headless, HTTP test API only (release smoke test, auditor)
 *   default   the window, plus the API when --port is given
 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createContext, type AppContext } from './context.ts'
import { startHttpApi } from './httpApi.ts'
import { registerIpc, wireEvents } from './ipc.ts'

const argv = process.argv.slice(1)
const flag = (n: string) => argv.includes(n)
const val = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }

let ctx: AppContext | null = null

function libraryRoot(): string {
  return val('--library') ?? path.join(app.getPath('documents'), 'KeepR')
}

async function createWindow(c: AppContext): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 980, minHeight: 600,
    show: false,
    backgroundColor: '#0f1113', // matches --bg-base so there is no white flash
    title: 'KeepR',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs require() for the contract module
    },
  })

  registerIpc(ipcMain, c)
  wireEvents(win, c)

  const devUrl = process.env.KEEPR_DEV_SERVER
  if (devUrl) await win.loadURL(devUrl)
  else await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))

  win.once('ready-to-show', () => win.show())
  return win
}

async function main(): Promise<void> {
  const headless = flag('--serve')
  if (headless) {
    // No window, no dock icon, no GPU: this runs in CI and over SSH.
    app.disableHardwareAcceleration()
  }

  await app.whenReady()
  ctx = createContext({ libraryRoot: libraryRoot() })
  console.log(`[keepr] library ${ctx.libraryRoot} (schema v${ctx.schemaVersion})`)

  const portRaw = val('--port')
  if (headless || portRaw) {
    await startHttpApi(ctx, portRaw ? Number(portRaw) : undefined)
  }

  if (!headless) {
    await createWindow(ctx)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && ctx) void createWindow(ctx)
    })
  }

  app.on('window-all-closed', () => { if (!headless && process.platform !== 'darwin') app.quit() })
}

app.on('before-quit', () => { ctx?.close(); ctx = null })

/**
 * Write startup failures to a file, not just to a console nobody sees.
 *
 * A packaged Electron app on Windows is a GUI-subsystem binary with no console
 * attached, so console.error during startup goes nowhere. This exact situation
 * cost real time: a broken module loader made the app start, do nothing, and
 * produce no output at all on any stream. Anyone reporting "it will not open"
 * needs somewhere to point.
 */
function writeCrashLog(e: unknown): string | null {
  try {
    const dir = app.getPath('logs')
    mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'keepr-startup-error.log')
    const err = e as Error
    writeFileSync(
      file,
      [
        `KeepR ${app.getVersion()} failed to start`,
        `when:     ${new Date().toISOString()}`,
        `platform: ${process.platform}-${process.arch}`,
        `electron: ${process.versions.electron}  node: ${process.versions.node}  abi: ${process.versions.modules}`,
        `packaged: ${app.isPackaged}`,
        `cwd:      ${process.cwd()}`,
        `argv:     ${process.argv.join(' ')}`,
        '',
        `${err?.name ?? 'Error'}: ${err?.message ?? String(e)}`,
        '',
        err?.stack ?? '(no stack)',
        '',
      ].join('\n'),
      'utf8',
    )
    return file
  } catch {
    return null
  }
}

main().catch((e) => {
  const logPath = writeCrashLog(e)
  console.error(`[keepr] fatal: ${(e as Error).message}`)
  if (logPath) console.error(`[keepr] wrote startup error to ${logPath}`)
  // A dialog is the only channel a double-clicking user actually sees.
  try {
    if (!process.argv.includes('--serve')) {
      dialog.showErrorBox(
        'KeepR could not start',
        `${(e as Error).message}\n\n${logPath ? `Details written to:\n${logPath}` : ''}`,
      )
    }
  } catch { /* dialog unavailable this early; the log is the fallback */ }
  app.exit(1)
})
