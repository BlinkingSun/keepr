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
  // CJS (Electron main and preload, after esbuild): `require` is a MODULE-SCOPED
  // binding, not a property of globalThis. Checking globalThis.require was the
  // first attempt and it silently failed in the packaged app — the shim fell all
  // the way through to a cwd-anchored createRequire, which resolves relative to
  // wherever the user launched the exe from, so better-sqlite3 could not be found
  // and the app started and then did nothing at all. No output, no window, no
  // error: the worst possible failure to diagnose.
  //
  // `typeof require` rather than `require` directly, so this is safe under ESM
  // where the binding does not exist.
  if (typeof require === 'function') return require as unknown as NodeRequire

  // ESM (node --experimental-strip-types): build one from this module's URL.
  // Note esbuild rewrites import.meta to {} in CJS output, so .url can be
  // undefined even when import.meta itself appears defined.
  const url = typeof import.meta !== 'undefined' ? import.meta.url : undefined
  if (url) return createRequire(url) as NodeRequire

  throw new Error(
    'KeepR: no module loader available. Neither a CommonJS require nor ' +
      'import.meta.url is present, so native modules cannot be located.',
  )
})()

/** Resolve a module path without loading it. Same dual-runtime concern. */
export function nodeResolve(id: string): string {
  return nodeRequire.resolve(id)
}
