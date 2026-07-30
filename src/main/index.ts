/**
 * Electron main — Lane 0, owned by the orchestrator.
 *
 * Two modes from one entry point, sharing one context so the headless path and
 * the windowed path cannot drift into two implementations:
 *   --serve   headless, HTTP test API only (release smoke test, auditor)
 *   default   the window, plus the API when --port is given
 */
import { app, BrowserWindow, ipcMain } from 'electron'
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

main().catch((e) => {
  console.error(`[keepr] fatal: ${(e as Error).message}`)
  app.exit(1)
})
