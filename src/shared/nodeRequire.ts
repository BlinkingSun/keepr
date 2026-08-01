/**
 * A `require` that works in BOTH runtimes this code has to survive.
 *
 * The problem, found by launching the packaged app rather than by running tests:
 *
 *   - Under `node --experimental-strip-types` the modules are ESM, there is no
 *     native `require`, and `createRequire(import.meta.url)` is the way to reach
 *     CommonJS-only packages.
 *   - In the esbuild CJS bundle that Electron loads, `import.meta.url` does not
 *     exist. It compiles to `undefined`, `createRequire(undefined)` throws
 *     ERR_INVALID_ARG_VALUE, and the app dies during module evaluation — before
 *     any window, so the user sees only a JavaScript error dialog.
 *
 * Every unit test passed throughout, because tests only ever exercise the ESM
 * path. This module picks whichever mechanism actually exists.
 */
import { createRequire } from 'node:module'

interface NodeRequire {
  (id: string): unknown
  /** Present in both runtimes; callers use it to locate bundled wasm and tessdata. */
  resolve(id: string): string
}

/**
 * Resolved once at module load. Order matters: a native CJS `require` is already
 * correctly scoped when present, so prefer it and never construct a second one.
 */
export const nodeRequire: NodeRequire = (() => {
  // CJS bundle (Electron main / preload): the real thing is already here.
  const g = globalThis as { require?: NodeRequire }
  if (typeof g.require === 'function') return g.require

  // ESM: build one from this module's own URL.
  const url = typeof import.meta !== 'undefined' ? import.meta.url : undefined
  if (url) return createRequire(url) as NodeRequire

  // Neither available. Fall back to the working directory so the message names
  // the real problem instead of surfacing as "filename must be a string".
  return createRequire(`${process.cwd()}/__keepr_require_anchor__.js`) as NodeRequire
})()

/** Resolve a module path without loading it. Same dual-runtime concern. */
export function nodeResolve(id: string): string {
  return nodeRequire.resolve(id)
}
