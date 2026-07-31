/**
 * Lane C import tests — acceptance 1–5, 11.
 */
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test, after } from 'node:test'
import { importFiles, waitForImportOcr } from '../import.ts'
import {
  openIngestFixture,
  writeTestJpeg,
  writeTestPdf,
  writeTestVcf,
  type IngestFixture,
} from './harness.ts'

async function withFx(
  fn: (fx: IngestFixture) => Promise<void>,
  ocrOpts?: Parameters<typeof openIngestFixture>[0],
): Promise<void> {
  const fx = await openIngestFixture(ocrOpts)
  try {
    await fn(fx)
  } finally {
    await fx.close()
  }
}

test('1. importing 3 images creates 3 items in the Inbox, each with one page', async () => {
  await withFx(async (fx) => {
    const a = await writeTestJpeg(fx.fixturesDir, 'a.jpg', { r: 10, g: 20, b: 30 })
    const b = await writeTestJpeg(fx.fixturesDir, 'b.jpg', { r: 40, g: 50, b: 60 })
    const c = await writeTestJpeg(fx.fixturesDir, 'c.jpg', { r: 70, g: 80, b: 90 })

    const result = await importFiles(fx.deps, { paths: [a, b, c] })
    assert.equal(result.itemIds.length, 3)
    assert.equal(result.rejected.length, 0)
    assert.ok(result.jobId)

    const inInbox = fx.raw
      .prepare(
        `SELECT COUNT(*) AS n FROM item WHERE folder_id = ? AND type = 'receipt'`,
      )
      .get(fx.folderInbox) as { n: number }
    assert.equal(inInbox.n, 3)

    for (const id of result.itemIds) {
      const pages = fx.repos.pages.listForItem(id)
      assert.equal(pages.length, 1, `item ${id} should have one page`)
      assert.equal(pages[0]!.seq, 1)
    }
  })
})

test('2. a 4-page PDF creates 1 item with 4 pages in correct seq order', async () => {
  await withFx(async (fx) => {
    const pdf = await writeTestPdf(fx.fixturesDir, 'four.pdf', 4)
    const result = await importFiles(fx.deps, { paths: [pdf] })

    assert.equal(result.rejected.length, 0, JSON.stringify(result.rejected))
    assert.equal(result.itemIds.length, 1)
    const itemId = result.itemIds[0]!
    const pages = fx.raw
      .prepare(`SELECT id, seq FROM page WHERE item_id = ? ORDER BY seq`)
      .all(itemId) as Array<{ id: number; seq: number }>
    assert.equal(pages.length, 4)
    assert.deepEqual(
      pages.map((p) => p.seq),
      [1, 2, 3, 4],
    )

    const folder = fx.raw
      .prepare(`SELECT folder_id FROM item WHERE id = ?`)
      .get(itemId) as { folder_id: number }
    assert.equal(folder.folder_id, fx.folderInbox)
  })
})

test('3. a corrupt file is reported in rejected and other files still import', async () => {
  await withFx(async (fx) => {
    const good = await writeTestJpeg(fx.fixturesDir, 'good.jpg')
    const bad = join(fx.fixturesDir, 'corrupt.jpg')
    await writeFile(bad, Buffer.from('this is not an image at all'))

    const result = await importFiles(fx.deps, { paths: [good, bad] })
    assert.equal(result.itemIds.length, 1)
    assert.equal(result.rejected.length, 1)
    assert.equal(result.rejected[0]!.path, bad)
    assert.match(result.rejected[0]!.reason, /corrupt|unreadable|image/i)
  })
})

test('4. stored page paths are relative and resolve through the FileStore', async () => {
  await withFx(async (fx) => {
    const img = await writeTestJpeg(fx.fixturesDir, 'rel.jpg')
    const result = await importFiles(fx.deps, { paths: [img] })
    const itemId = result.itemIds[0]!
    const page = fx.raw
      .prepare(`SELECT file_relpath, content_hash FROM page WHERE item_id = ?`)
      .get(itemId) as { file_relpath: string; content_hash: string }

    assert.ok(!page.file_relpath.startsWith('/'), 'must not store absolute path')
    assert.ok(!/^[A-Za-z]:[\\/]/.test(page.file_relpath))
    assert.match(page.file_relpath, /^images\/[0-9a-f]{2}\/[0-9a-f]{2}\//)

    const abs = fx.fileStore.resolve(page.file_relpath as never)
    assert.ok(abs.startsWith(fx.libraryRoot))
    assert.equal(await fx.fileStore.exists(page.file_relpath as never), true)
    assert.ok(page.content_hash && page.content_hash.length === 64)
  })
})

test('5. importing the same image twice stores one file but two page rows', async () => {
  await withFx(async (fx) => {
    // Same bytes written to two path names so import reads both paths.
    const bytes = await (async () => {
      const p = await writeTestJpeg(fx.fixturesDir, 'once.jpg', { r: 1, g: 2, b: 3 })
      const { readFile } = await import('node:fs/promises')
      return readFile(p)
    })()
    const p1 = join(fx.fixturesDir, 'copy1.jpg')
    const p2 = join(fx.fixturesDir, 'copy2.jpg')
    await writeFile(p1, bytes)
    await writeFile(p2, bytes)

    const result = await importFiles(fx.deps, { paths: [p1, p2] })
    assert.equal(result.itemIds.length, 2)

    const pages = fx.raw
      .prepare(`SELECT file_relpath, content_hash FROM page ORDER BY id`)
      .all() as Array<{ file_relpath: string; content_hash: string }>
    assert.equal(pages.length, 2)
    assert.equal(pages[0]!.file_relpath, pages[1]!.file_relpath)
    assert.equal(pages[0]!.content_hash, pages[1]!.content_hash)

    // Exactly one content-addressed image file under library (thumbs may add more).
    const hashes = new Set(pages.map((p) => p.content_hash))
    assert.equal(hashes.size, 1)
  })
})

test('11. vCard import creates a contact item with parsed name and email', async () => {
  await withFx(async (fx) => {
    const vcf = await writeTestVcf(
      fx.fixturesDir,
      'person.vcf',
      [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'N:Roberts;Joshua;;;',
        'FN:Joshua Roberts',
        'EMAIL;TYPE=INTERNET:josh@example.com',
        'TEL;TYPE=CELL:+1-555-0100',
        'ORG:Boekel Scientific',
        'END:VCARD',
      ].join('\r\n'),
    )

    const result = await importFiles(fx.deps, { paths: [vcf] })
    assert.equal(result.rejected.length, 0, JSON.stringify(result.rejected))
    assert.equal(result.itemIds.length, 1)

    const row = fx.raw
      .prepare(
        `SELECT i.type, c.first_name, c.last_name, c.emails_json, c.org
           FROM item i JOIN contact_data c ON c.item_id = i.id
          WHERE i.id = ?`,
      )
      .get(result.itemIds[0]!) as {
      type: string
      first_name: string
      last_name: string
      emails_json: string
      org: string
    }

    assert.equal(row.type, 'contact')
    assert.equal(row.first_name, 'Joshua')
    assert.equal(row.last_name, 'Roberts')
    assert.equal(row.org, 'Boekel Scientific')
    const emails = JSON.parse(row.emails_json) as string[]
    assert.deepEqual(emails, ['josh@example.com'])

    // Contacts produce no page rows / OCR work.
    const pages = fx.raw
      .prepare(`SELECT COUNT(*) AS n FROM page WHERE item_id = ?`)
      .get(result.itemIds[0]!) as { n: number }
    assert.equal(pages.n, 0)
  })
})

// silence unused if tree-shaken
void waitForImportOcr
void after
