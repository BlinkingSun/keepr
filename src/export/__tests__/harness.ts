/**
 * In-memory DB + temp library for export tests.
 * Mirrors spikes/schema-verify.ts and repo harness patterns.
 */
import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { allocate, asMinor } from '../../shared/types.ts'

const require = createRequire(import.meta.url)
const sharp = require('sharp') as typeof import('sharp')

const here = dirname(fileURLToPath(import.meta.url))
const schemaPath = join(here, '../../db/schema/001_initial.sql')
const schemaSql = readFileSync(schemaPath, 'utf8')

export const NOW = 1_753_900_000_000

export interface ExportFixture {
  db: InstanceType<typeof Database>
  libraryRoot: string
  folderUser: number
  folderInbox: number
  vendorId: number
  categoryId: number
  taxCategoryId: number
  /** Call to remove temp dir. */
  cleanup: () => void
}

export function openExportFixture(): ExportFixture {
  const db = new Database(':memory:')
  db.exec(schemaSql)
  db.pragma('foreign_keys = ON')

  const libraryRoot = mkdtempSync(join(tmpdir(), 'keepr-export-'))

  db.prepare(
    `INSERT INTO cabinet(id, display_name, base_currency, profile_json, created_at, modified_at)
     VALUES (1, 'Test Cabinet', 'USD', ?, ?, ?)`,
  ).run(
    JSON.stringify({
      name: 'Alex Accountant',
      business: 'KeepR Test Co',
      address: '1 Main St\nSpringfield',
      taxId: '12-3456789',
    }),
    NOW,
    NOW,
  )

  const folderInbox = Number(
    db
      .prepare(
        `INSERT INTO folder(kind, name, created_at, modified_at) VALUES ('inbox', 'Inbox', ?, ?)`,
      )
      .run(NOW, NOW).lastInsertRowid,
  )
  const folderUser = Number(
    db
      .prepare(
        `INSERT INTO folder(kind, name, created_at, modified_at) VALUES ('user', 'Materials', ?, ?)`,
      )
      .run(NOW, NOW).lastInsertRowid,
  )
  db.prepare(
    `INSERT INTO folder(kind, name, created_at, modified_at) VALUES ('trash', 'Trash', ?, ?)`,
  ).run(NOW, NOW)

  const categoryId = Number(
    db.prepare(`INSERT INTO category(name, created_at) VALUES ('Materials', ?)`).run(NOW)
      .lastInsertRowid,
  )
  const taxCategoryId = Number(
    db.prepare(`INSERT INTO tax_category(name, created_at) VALUES ('Standard', ?)`).run(NOW)
      .lastInsertRowid,
  )
  const vendorId = Number(
    db
      .prepare(
        `INSERT INTO vendor(name, normalized_name, default_category_id, created_at)
         VALUES ('Home Depot', 'home depot', ?, ?)`,
      )
      .run(categoryId, NOW).lastInsertRowid,
  )

  return {
    db,
    libraryRoot,
    folderUser,
    folderInbox,
    vendorId,
    categoryId,
    taxCategoryId,
    cleanup: () => {
      try {
        db.close()
      } catch {
        /* ignore */
      }
      try {
        rmSync(libraryRoot, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    },
  }
}

export function mkItem(
  db: InstanceType<typeof Database>,
  folderId: number,
  type = 'receipt',
  extra: { sg?: number | null; role?: string | null; sup?: number | null } = {},
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO item(folder_id, type, split_group_id, split_role, superseded_at, created_at, modified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        folderId,
        type,
        extra.sg ?? null,
        extra.role ?? null,
        extra.sup ?? null,
        NOW,
        NOW,
      ).lastInsertRowid,
  )
}

export function mkReceipt(
  db: InstanceType<typeof Database>,
  folderId: number,
  opts: {
    totalMinor?: number | null
    taxMinor?: number | null
    currency?: string
    vendorId?: number | null
    categoryId?: number | null
    taxCategoryId?: number | null
    txnDate?: string | null
    vendorName?: string
    description?: string | null
    sg?: number | null
    role?: string | null
    sup?: number | null
  } = {},
): number {
  let vendorId = opts.vendorId ?? null
  if (opts.vendorName && vendorId == null) {
    const existing = db
      .prepare(`SELECT id FROM vendor WHERE name = ?`)
      .get(opts.vendorName) as { id: number } | undefined
    if (existing) {
      vendorId = existing.id
    } else {
      vendorId = Number(
        db
          .prepare(
            `INSERT INTO vendor(name, normalized_name, created_at) VALUES (?, ?, ?)`,
          )
          .run(opts.vendorName, opts.vendorName.toLowerCase(), NOW).lastInsertRowid,
      )
    }
  }
  const id = mkItem(db, folderId, 'receipt', {
    sg: opts.sg,
    role: opts.role,
    sup: opts.sup,
  })
  db.prepare(
    `INSERT INTO receipt_data(item_id, txn_date, vendor_id, total_minor, currency, tax_total_minor, category_id, tax_category_id, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    opts.txnDate ?? '2026-07-12',
    vendorId,
    opts.totalMinor ?? null,
    opts.currency ?? 'USD',
    opts.taxMinor ?? null,
    opts.categoryId ?? null,
    opts.taxCategoryId ?? null,
    opts.description ?? null,
  )
  return id
}

/** Solid PNG under libraryRoot; returns relative path. */
export async function writeTestImage(
  libraryRoot: string,
  relPath: string,
  width: number,
  height: number,
  color: { r: number; g: number; b: number } = { r: 240, g: 240, b: 240 },
): Promise<string> {
  const abs = join(libraryRoot, relPath)
  mkdirSync(dirname(abs), { recursive: true })
  const buf = await sharp({
    create: { width, height, channels: 3, background: color },
  })
    .png()
    .toBuffer()
  writeFileSync(abs, buf)
  return relPath
}

export function addPage(
  db: InstanceType<typeof Database>,
  itemId: number,
  opts: {
    seq?: number
    relPath: string
    width: number
    height: number
    rotation?: number
    ocrWords?: Array<{ text: string; bbox: { x: number; y: number; w: number; h: number }; confidence?: number }>
    ocrText?: string
  },
): number {
  const words = opts.ocrWords ?? []
  const ocrText = opts.ocrText ?? words.map((w) => w.text).join(' ')
  return Number(
    db
      .prepare(
        `INSERT INTO page(item_id, seq, file_relpath, width, height, rotation, ocr_status, ocr_text, ocr_words_json, ocr_conf, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'done', ?, ?, 0.95, ?)`,
      )
      .run(
        itemId,
        opts.seq ?? 1,
        opts.relPath,
        opts.width,
        opts.height,
        opts.rotation ?? 0,
        ocrText,
        JSON.stringify(
          words.map((w) => ({
            text: w.text,
            bbox: w.bbox,
            confidence: w.confidence ?? 0.95,
          })),
        ),
        NOW,
      ).lastInsertRowid,
  )
}

/** 3-way split of $100.00 — origin superseded, children summable. */
export function seedSplitReceipt(fx: ExportFixture): {
  originId: number
  childIds: number[]
  originTotal: number
} {
  const { db, folderUser, vendorId, categoryId, taxCategoryId } = fx
  const originTotal = 10000
  const taxTotal = 825
  const originId = mkReceipt(db, folderUser, {
    totalMinor: originTotal,
    taxMinor: taxTotal,
    vendorId,
    categoryId,
    taxCategoryId,
  })
  db.prepare(
    `INSERT INTO receipt_tax_line(item_id, label, rate_bp, amount_minor, tax_category_id)
     VALUES (?, 'Sales Tax', 825, ?, ?)`,
  ).run(originId, taxTotal, taxCategoryId)
  db.prepare(
    `INSERT INTO page(item_id, seq, file_relpath, content_hash, ocr_status, created_at)
     VALUES (?, 1, 'images/o1.jpg', 'sha-abc', 'done', ?)`,
  ).run(originId, NOW)
  const pageId = (db.prepare(`SELECT id FROM page WHERE item_id = ?`).get(originId) as { id: number })
    .id

  const parts = allocate(asMinor(originTotal), 3)
  const taxParts = allocate(asMinor(taxTotal), 3)
  const sg = Number(
    db
      .prepare(
        `INSERT INTO split_group(origin_item_id, origin_page_id, origin_total_minor, origin_tax_minor, currency, created_at)
         VALUES (?, ?, ?, ?, 'USD', ?)`,
      )
      .run(originId, pageId, originTotal, taxTotal, NOW).lastInsertRowid,
  )
  db.prepare(
    `UPDATE item SET split_group_id = ?, split_role = 'origin', superseded_at = ? WHERE id = ?`,
  ).run(sg, NOW, originId)

  const childIds = parts.map((p, i) => {
    const id = mkReceipt(db, folderUser, {
      totalMinor: p,
      taxMinor: taxParts[i],
      vendorId,
      categoryId,
      taxCategoryId,
      sg,
      role: 'child',
    })
    db.prepare(
      `INSERT INTO receipt_tax_line(item_id, label, rate_bp, amount_minor, tax_category_id)
       VALUES (?, 'Sales Tax', 825, ?, ?)`,
    ).run(id, taxParts[i], taxCategoryId)
    return id
  })

  return { originId, childIds, originTotal }
}

/** Minimal CSV parser for round-trip tests (handles quotes, commas, newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let i = 0
  let inQuotes = false
  while (i < text.length) {
    const ch = text[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\n') {
      row.push(field)
      field = ''
      // Skip empty trailing row from final newline
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
      i++
      continue
    }
    if (ch === '\r') {
      i++
      continue
    }
    field += ch
    i++
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    if (row.length > 1 || row[0] !== '') rows.push(row)
  }
  return rows
}

/** Inflate PDF content streams and extract text + Tm positions. */
export function extractPdfTextPlacements(
  pdfBytes: Buffer,
): Array<{ text: string; x: number; y: number; pageIndex: number }> {
  const { inflateSync } = require('zlib') as typeof import('zlib')
  const s = pdfBytes.toString('latin1')
  const results: Array<{ text: string; x: number; y: number; pageIndex: number }> = []
  let searchFrom = 0
  let pageIndex = -1

  // Rough page tracking: each page content stream that draws text increments.
  // We count "BT" blocks across inflated streams in file order.
  while (true) {
    const a = s.indexOf('stream\n', searchFrom)
    const b = s.indexOf('stream\r\n', searchFrom)
    let idx: number
    let after: number
    if (a < 0 && b < 0) break
    if (b >= 0 && (a < 0 || b < a)) {
      idx = b
      after = 8
    } else {
      idx = a
      after = 7
    }
    const start = idx + after
    const endN = s.indexOf('endstream', start)
    if (endN < 0) break
    let dataStart = start
    if (s[dataStart] === '\r') dataStart++
    if (s[dataStart] === '\n') dataStart++
    let dataEnd = endN
    if (s[dataEnd - 1] === '\n') dataEnd--
    if (s[dataEnd - 1] === '\r') dataEnd--
    const raw = pdfBytes.subarray(dataStart, dataEnd)
    try {
      const out = inflateSync(raw).toString('latin1')
      if (!out.includes('BT') && !/Tj|TJ/.test(out)) {
        searchFrom = endN + 9
        continue
      }
      pageIndex++
      let curX = 0
      let curY = 0
      // Tm: a b c d e f Tm  → e=x, f=y
      const tmRe = /([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Tm/g
      // Hex string Tj: <48454C4C4F> Tj
      const hexTj = /<([0-9A-Fa-f]+)>\s*Tj/g
      // Literal (text) Tj — rare with Helvetica encoding in pdf-lib
      const litTj = /\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g

      // Pair Tm positions with subsequent Tj in order by scanning line-ish
      const tokens = out.split(/(?=\bTm\b)|(?=Tj)/)
      // Simpler: find all Tm and all Tj with positions
      const tms: Array<{ x: number; y: number; index: number }> = []
      let m: RegExpExecArray | null
      while ((m = tmRe.exec(out)) !== null) {
        tms.push({ x: Number(m[5]), y: Number(m[6]), index: m.index })
      }
      const tjs: Array<{ text: string; index: number }> = []
      while ((m = hexTj.exec(out)) !== null) {
        const hex = m[1]!
        let text = ''
        for (let i = 0; i < hex.length; i += 2) {
          text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
        }
        tjs.push({ text, index: m.index })
      }
      while ((m = litTj.exec(out)) !== null) {
        tjs.push({ text: m[1]!.replace(/\\([nrt\\()])/g, (_, c: string) => {
          if (c === 'n') return '\n'
          if (c === 'r') return '\r'
          if (c === 't') return '\t'
          return c
        }), index: m.index })
      }
      tjs.sort((a, b) => a.index - b.index)
      for (const tj of tjs) {
        // nearest preceding Tm
        let best = tms[0]
        for (const tm of tms) {
          if (tm.index <= tj.index) best = tm
        }
        if (best) {
          results.push({ text: tj.text, x: best.x, y: best.y, pageIndex })
          curX = best.x
          curY = best.y
        } else {
          results.push({ text: tj.text, x: curX, y: curY, pageIndex })
        }
      }
    } catch {
      /* not deflate */
    }
    searchFrom = endN + 9
  }
  return results
}
