/**
 * Main-process event bus — Lane 0/V, owned by the orchestrator.
 *
 * The batch-2 audit caught that scan:* and watcher:activity were declared in the
 * contract but had no route to the renderer: only job:progress was forwarded, so
 * scan progress and folder-watcher activity could never appear in the UI.
 *
 * This is deliberately tiny: services in main publish here without knowing
 * whether a window exists; wireEvents subscribes each BrowserWindow. In headless
 * --serve mode nothing subscribes and publishing is a no-op — the job rows remain
 * the queryable source of truth for the HTTP API.
 */
import type { IpcEventName, IpcEvents } from '../shared/ipc.ts'

type Listener = <E extends IpcEventName>(channel: E, payload: IpcEvents[E]) => void

const listeners = new Set<Listener>()

export const mainEvents = {
  emit<E extends IpcEventName>(channel: E, payload: IpcEvents[E]): void {
    for (const fn of listeners) {
      // One broken subscriber must not stop the others from hearing about it.
      try {
        fn(channel, payload)
      } catch {
        /* subscriber's problem, not the publisher's */
      }
    }
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}
