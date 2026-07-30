/**
 * Typed renderer-side client over the preload bridge.
 *
 * Every call is checked against IpcMap, so a channel that does not exist, or a
 * payload that does not match, fails at compile time rather than as a rejected
 * promise the user sees as a dead button.
 */
import type { IpcChannel, IpcEventName, IpcEvents, IpcReq, IpcRes, KeeprBridge } from '../shared/ipc.ts'

declare global {
  interface Window { keepr?: KeeprBridge }
}

const bridge = (): KeeprBridge => {
  const b = window.keepr
  if (!b) throw new Error('preload bridge missing — the renderer was loaded outside Electron')
  return b
}

export const invoke = <C extends IpcChannel>(channel: C, req: IpcReq<C>): Promise<IpcRes<C>> =>
  bridge().invoke(channel, req)

export const on = <E extends IpcEventName>(event: E, fn: (p: IpcEvents[E]) => void): (() => void) =>
  bridge().on(event, fn)

export const hasBridge = (): boolean => typeof window !== 'undefined' && !!window.keepr
