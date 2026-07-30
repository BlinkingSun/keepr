#!/usr/bin/env node
/**
 * Builds the three bundles KeepR ships: main, preload, renderer.
 *
 * main and preload are Electron/Node targets and must keep the native modules
 * EXTERNAL — better-sqlite3 and sharp are .node addons and platform packages;
 * bundling them produces an app that builds and then dies on first import.
 */
import { build } from 'esbuild'
import { cpSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const external = ['electron', 'better-sqlite3', 'sharp', 'tesseract.js', 'pdfjs-dist', 'exceljs', 'pdf-lib']

rmSync(path.join(root, 'dist/main'), { recursive: true, force: true })
rmSync(path.join(root, 'dist/preload'), { recursive: true, force: true })

const common = { bundle: true, platform: 'node', target: 'node20', sourcemap: true, logLevel: 'info', external }

await build({ ...common, entryPoints: [path.join(root, 'src/main/index.ts')], outfile: path.join(root, 'dist/main/index.js'), format: 'cjs' })
await build({ ...common, entryPoints: [path.join(root, 'src/preload/index.ts')], outfile: path.join(root, 'dist/preload/index.js'), format: 'cjs' })
// The migrations are runtime assets, not code — the bundler will not carry them.
cpSync(path.join(root, 'src/db/schema'), path.join(root, 'dist/schema'), { recursive: true })
console.log('main + preload bundled, schema copied to dist/schema')
