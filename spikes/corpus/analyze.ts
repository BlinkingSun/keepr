/**
 * Import the corpus through the REAL pipeline and score extraction against
 * ground truth, field by field.
 *
 * Deliberately drives `importFiles` exactly as the app does — same context, same
 * OCR provider, same extraction — rather than calling the parser directly. A
 * parser test proves the parser; this proves the program.
 *
 * Run: node --experimental-strip-types spikes/corpus/analyze.ts <corpusDir> <libraryDir>
 */
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { createContext } from '../../src/main/context.ts'
import { importFiles, waitForImportOcr } from '../../src/ingest/index.ts'
import type { Truth } from './generate.ts'

const corpusDir = process.argv[2]
const libDir = process.argv[3]
if (!corpusDir || !libDir) throw new Error('usage: analyze.ts <corpusDir> <libraryDir>')

const truths: Truth[] = JSON.parse(readFileSync(path.join(corpusDir, 'truth.json'), 'utf8'))
const files = readdirSync(corpusDir).filter((f) => f.endsWith('.png')).sort()

rmSync(libDir, { recursive: true, force: true })
const ctx = createContext({ libraryRoot: libDir })
const deps = ctx.ingest()

interface FieldScore { field: string; hit: number; miss: number; wrong: number }
const scores = new Map<string, FieldScore>()
const bump = (field: string, kind: 'hit' | 'miss' | 'wrong') => {
  const s = scores.get(field) ?? { field, hit: 0, miss: 0, wrong: 0 }
  s[kind] += 1
  scores.set(field, s)
}

const rows: string[] = []
let perfect = 0

for (const file of files) {
  const id = file.replace(/\.png$/, '')
  const truth = truths.find((t) => t.id === id)
  if (!truth) continue

  const res = await importFiles(deps, {
    paths: [path.join(corpusDir, file)],
    awaitOcr: true,
  })
  if (res.rejected.length || res.itemIds.length === 0) {
    rows.push(`${id.padEnd(20)} IMPORT FAILED  ${JSON.stringify(res.rejected)}`)
    continue
  }
  const itemId = res.itemIds[0]!
  await waitForImportOcr(res.jobId).catch(() => {})

  const r = ctx.db
    .prepare(
      `SELECT r.txn_date, r.total_minor, r.tax_total_minor, r.currency,
              v.name AS vendor, pt.name AS payment, r.extraction_json,
              (SELECT length(ocr_text) FROM page WHERE item_id = r.item_id LIMIT 1) AS ocrLen,
              (SELECT ocr_conf FROM page WHERE item_id = r.item_id LIMIT 1) AS ocrConf
         FROM receipt_data r
         LEFT JOIN vendor v ON v.id = r.vendor_id
         LEFT JOIN payment_type pt ON pt.id = r.payment_type_id
        WHERE r.item_id = ?`,
    )
    .get(itemId) as any

  // Score a field three ways, because "missing" and "wrong" are not the same
  // failure. A missing total asks the user to look; a wrong total does not.
  const score = (field: string, got: unknown, want: unknown, cmp?: (a: any, b: any) => boolean) => {
    const equal = cmp ? cmp(got, want) : got === want
    if (want == null) { // nothing to find
      if (got == null) { bump(field, 'hit'); return 'ok' }
      bump(field, 'wrong'); return `INVENTED ${String(got)}`
    }
    if (got == null) { bump(field, 'miss'); return 'missing' }
    if (equal) { bump(field, 'hit'); return 'ok' }
    bump(field, 'wrong'); return `WRONG got ${String(got)} want ${String(want)}`
  }

  const vendorLoose = (a: string, b: string) =>
    a != null && b != null && a.toLowerCase().replace(/[^a-z]/g, '').includes(b.toLowerCase().replace(/[^a-z]/g, '').slice(0, 6))
  const payLoose = (a: string, b: string) =>
    a != null && b != null && a.toUpperCase().includes(b.toUpperCase())

  const results = {
    total: score('total', r?.total_minor ?? null, truth.totalMinor),
    tax: score('tax', r?.tax_total_minor ?? null, truth.taxMinor),
    date: score('date', r?.txn_date ?? null, truth.txnDate),
    vendor: score('vendor', r?.vendor ?? null, truth.vendor, vendorLoose),
    payment: score('payment', r?.payment ?? null, truth.paymentType, payLoose),
  }
  const allOk = Object.values(results).every((v) => v === 'ok')
  if (allOk) perfect += 1

  const problems = Object.entries(results).filter(([, v]) => v !== 'ok').map(([k, v]) => `${k}:${v}`)
  rows.push(
    `${id.padEnd(20)} ${truth.difficulty.padEnd(9)} ${allOk ? 'ALL OK' : problems.join('  ')}` +
      `   [ocr ${r?.ocrLen ?? 0} chars, conf ${r?.ocrConf == null ? 'n/a' : Number(r.ocrConf).toFixed(2)}]`,
  )
}

console.log('\n=== per-receipt ===')
for (const line of rows) console.log('  ' + line)

console.log('\n=== per-field across the corpus ===')
console.log('  field      hit  miss  wrong   note')
for (const f of ['total', 'tax', 'date', 'vendor', 'payment']) {
  const s = scores.get(f) ?? { field: f, hit: 0, miss: 0, wrong: 0 }
  const note = s.wrong > 0 ? '<-- WRONG VALUES are the dangerous ones' : s.miss > 0 ? 'missing only (safe: user is prompted)' : ''
  console.log(`  ${f.padEnd(10)} ${String(s.hit).padStart(3)}  ${String(s.miss).padStart(4)}  ${String(s.wrong).padStart(5)}   ${note}`)
}

const total = files.length
console.log(`\n  fully correct receipts: ${perfect}/${total}`)
const wrongTotals = scores.get('total')?.wrong ?? 0
console.log(`  receipts with a WRONG total: ${wrongTotals}  (this is the number that matters)`)

ctx.close()
