/**
 * Offline path resolution for tesseract.js assets.
 * Matches scripts/abi-check.mjs: eng.traineddata under resources/tessdata
 * (or process.resourcesPath/tessdata in a packaged app), wasm from tesseract.js-core.
 */

import { existsSync } from 'node:fs'
import { nodeRequire } from '../shared/nodeRequire.ts'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Dual-runtime: import.meta.url is undefined in the CJS bundle Electron loads.
const require = nodeRequire

/**
 * This module's directory, in whichever runtime is executing.
 * __dirname exists in the CJS bundle; import.meta.url exists under ESM.
 */
function moduleDir(): string {
  if (typeof __dirname !== 'undefined') return __dirname
  const url = typeof import.meta !== 'undefined' ? import.meta.url : undefined
  return url ? path.dirname(fileURLToPath(url)) : process.cwd()
}

export interface TesseractOfflinePaths {
  workerPath: string
  corePath: string
  langPath: string
  /** Directory containing eng.traineddata */
  tessdataDir: string
}

/**
 * Resolve local (never CDN) paths for worker script, wasm core, and traineddata.
 * Throws if any required file is missing — fail loud rather than fetch later.
 */
export function resolveTesseractPaths(opts?: {
  /** Override project root / cwd for tests. */
  cwd?: string
  resourcesPath?: string
}): TesseractOfflinePaths {
  const cwd = opts?.cwd ?? process.cwd()
  // Electron sets process.resourcesPath; plain Node does not.
  const proc = process as NodeJS.Process & { resourcesPath?: string }
  const resourcesPath =
    opts?.resourcesPath ??
    (typeof proc.resourcesPath === 'string' ? proc.resourcesPath : undefined)

  // worker-script for Node (not the browser CDN worker.min.js)
  const workerPath = require.resolve('tesseract.js/src/worker-script/node/index.js')

  let corePath: string
  try {
    corePath = path.dirname(require.resolve('tesseract.js-core/package.json'))
  } catch {
    throw new Error(
      'tesseract.js-core not installed — wasm core would be fetched from a CDN at runtime',
    )
  }

  const candidates = [
    resourcesPath ? path.join(resourcesPath, 'tessdata') : '',
    path.resolve(cwd, 'resources/tessdata'),
    // When running from dist/, still find repo resources/
    // moduleDir() rather than import.meta.url directly: in the CJS bundle
    // import.meta compiles to {} and fileURLToPath(undefined) throws.
    path.resolve(moduleDir(), '../../resources/tessdata'),
    path.resolve(moduleDir(), '../../../resources/tessdata'),
  ].filter(Boolean)

  const tessdataDir = candidates.find((d) => existsSync(path.join(d, 'eng.traineddata')))
  if (!tessdataDir) {
    throw new Error(
      `eng.traineddata not found. Looked in: ${candidates.join(', ')}. Bundle it; do not fetch at runtime.`,
    )
  }

  return {
    workerPath,
    corePath,
    langPath: tessdataDir,
    tessdataDir,
  }
}
