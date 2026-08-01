#!/usr/bin/env node
/**
 * KeepR native ABI + offline-capability gate.
 *
 * The audit's point: "works in node spikes" does not mean "works in Electron",
 * and "the installer launches" does not mean the app can import a receipt.
 * This script proves the native pipeline actually functions in whatever runtime
 * is executing it. Run it BOTH ways:
 *
 *   npm run abi:check:node    -> plain node (fast dev signal)
 *   npm run abi:check         -> inside Electron (the one that gates a release)
 *
 * On the Windows build machine it must pass under Electron, offline, after a clean `npm ci`
 * plus electron-rebuild. Exit code is the gate: 0 pass, 1 fail.
 */
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const results = []
const fail = (name, detail) => results.push({ name, ok: false, detail })
const pass = (name, detail) => results.push({ name, ok: true, detail })

const runtime = process.versions.electron ? `electron ${process.versions.electron}` : `node ${process.versions.node}`
console.log(`KeepR abi-check — runtime: ${runtime}, modules ABI: ${process.versions.modules}, ${os.platform()}-${os.arch()}`)

/* 1. better-sqlite3 loads under THIS runtime's ABI, and FTS5 is compiled in. */
try {
  const Database = require('better-sqlite3')
  const db = new Database(':memory:')
  const v = db.prepare('select sqlite_version() v').get().v
  const fts = db.prepare("select count(*) c from pragma_compile_options where compile_options like '%FTS5%'").get().c
  if (!fts) throw new Error('FTS5 not compiled into this SQLite build')

  // Exercise the exact external-content pattern the schema relies on.
  db.exec(`
    create table page(id integer primary key, ocr_text text);
    create virtual table page_fts using fts5(ocr_text, content='page', content_rowid='id',
      tokenize='unicode61 remove_diacritics 2');
    create trigger page_ai after insert on page begin
      insert into page_fts(rowid, ocr_text) values (new.id, new.ocr_text); end;
  `)
  db.prepare('insert into page(ocr_text) values (?)').run('CAFÉ thermal receipt total 12.40')
  const diacritic = db.prepare('select count(*) c from page_fts where page_fts match ?').get('cafe').c
  if (!diacritic) throw new Error('remove_diacritics 2 not effective: "cafe" did not match "CAFÉ"')
  db.prepare("insert into page_fts(page_fts) values('integrity-check')").run()
  db.close()
  pass('better-sqlite3', `sqlite ${v}, FTS5 ok, diacritic folding ok, integrity-check ok`)
} catch (e) {
  fail('better-sqlite3', e.message)
}

/* 2. sharp loads (platform package + libvips resolvable outside the asar). */
try {
  const sharp = require('sharp')
  const buf = await sharp({ create: { width: 240, height: 360, channels: 3, background: { r: 18, g: 18, b: 20 } } })
    .jpeg().toBuffer()
  const meta = await sharp(buf).rotate(90).metadata()
  pass('sharp', `${sharp.versions?.vips ? 'libvips ' + sharp.versions.vips + ', ' : ''}encode+rotate ok (${meta.width}x${meta.height})`)
} catch (e) {
  fail('sharp', e.message)
}

/* 3. tesseract.js core + traineddata present ON DISK — no CDN at runtime.
      An offline-first app that silently fetches language data over the network
      is not offline-first; it just fails later, on a customer's machine. */
try {
  require.resolve('tesseract.js')
  let corePath = null
  try { corePath = path.dirname(require.resolve('tesseract.js-core/package.json')) } catch { /* checked below */ }
  if (!corePath) throw new Error('tesseract.js-core not installed — wasm core would be fetched from a CDN at runtime')
  const wasm = readdirSync(corePath).filter((f) => f.endsWith('.wasm'))
  if (!wasm.length) throw new Error(`no .wasm found in ${corePath}`)

  const candidates = [
    path.join(process.resourcesPath ?? '', 'tessdata'),
    path.resolve('resources/tessdata'),
  ].filter(Boolean)
  const tessdata = candidates.find((d) => existsSync(path.join(d, 'eng.traineddata')))
  if (!tessdata) throw new Error(`eng.traineddata not found. Looked in: ${candidates.join(', ')}. Bundle it; do not fetch at runtime.`)
  pass('tesseract.js offline', `core wasm ${wasm[0]}, tessdata ${tessdata}`)
} catch (e) {
  fail('tesseract.js offline', e.message)
}

/* 4. pdfjs-dist is loadable for PDF rasterization. */
try {
  await import('pdfjs-dist/legacy/build/pdf.mjs')
  pass('pdfjs-dist', 'legacy build imports')
} catch (e) {
  fail('pdfjs-dist', e.message)
}

/* 5. Worker pool sizing sanity — see PLAN.md OCR runtime contract. */
pass('cpu', `${os.cpus().length} cores → sharp/pdf pool ${Math.max(1, os.cpus().length - 1)}, tesseract scheduler capped separately`)

console.log('')
let bad = 0
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(22)} ${r.detail}`)
  if (!r.ok) bad++
}
console.log('')
if (bad) {
  console.error(`abi-check FAILED: ${bad} of ${results.length} checks failed under ${runtime}.`)
  process.exit(1)
}
console.log(`abi-check passed: ${results.length}/${results.length} under ${runtime}.`)
if (process.versions.electron) {
  const { app } = require('electron')
  app.quit()
}
