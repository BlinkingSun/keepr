/**
 * Preload bridge — Lane 0, owned by the orchestrator.
 *
 * The ENTIRE surface the renderer gets. No fs, no child_process, no database
 * handle, no raw ipcRenderer. A renderer that can only invoke declared channels
 * cannot be talked into reading arbitrary files, which matters for an app whose
 * whole job is opening documents people hand it.
 *
 * Channel names are validated against the contract before being forwarded, so a
 * typo fails immediately and loudly instead of hanging on a channel nobody
 * handles.
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc.ts'

const ALLOWED = new Set<string>(IPC_CHANNELS as readonly string[])
const EVENTS = new Set([
  'job:progress',
  'item:changed',
  'folder:changed',
  'ocr:pageDone',
  'library:opened',
])

contextBridge.exposeInMainWorld('keepr', {
  invoke: (channel: string, req: unknown) => {
    if (!ALLOWED.has(channel)) {
      return Promise.reject(new Error(`[keepr] refused: "${channel}" is not a declared IPC channel`))
    }
    return ipcRenderer.invoke(channel, req)
  },

  on: (event: string, fn: (payload: unknown) => void) => {
    if (!EVENTS.has(event)) {
      throw new Error(`[keepr] refused: "${event}" is not a declared event channel`)
    }
    // The raw IpcRendererEvent is deliberately not passed through — it carries
    // sender internals the renderer has no business holding.
    const wrapped = (_e: unknown, payload: unknown) => fn(payload)
    ipcRenderer.on(event, wrapped)
    return () => ipcRenderer.removeListener(event, wrapped)
  },
})
