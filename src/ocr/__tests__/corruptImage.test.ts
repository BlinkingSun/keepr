/**
 * The crash the batch-2 execution audit found, pinned down.
 *
 * A corrupt image killed the WHOLE PROCESS: tesseract.js worker failures arrive
 * on `process.nextTick(() => { throw err })` (createWorker.js:247), so without an
 * errorHandler they are uncatchable by the caller. Live serve died mid-import
 * with an open WAL and unreaped jobs.
 *
 * The fixture matters as much as the fix. sharp (intake) and leptonica (OCR) are
 * INDEPENDENT decoders, and ocrPage hands tesseract the original file path — so
 * the dangerous input is not "a corrupt file" but specifically one sharp accepts
 * and leptonica cannot read. A JPEG with a shredded entropy segment is exactly
 * that: sharp decodes it with a "bad Huffman code" warning, leptonica refuses.
 * An intake-rejected file proves nothing about this path, which is why the first
 * repro attempt was not evidence.
 *
 * Two things are asserted, because containment without a usable reason is only
 * half of it:
 *   1. the failure is contained — ocrPage rejects, the process lives;
 *   2. it rejects with a real Error. tesseract rejects with a STRING, so
 *      `(e as Error).message` yields undefined; the provider seam normalises it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { createOcrProvider } from '../provider.ts'

/** Valid JPEG whose post-SOS entropy data is shredded, length and EOI intact. */
async function shreddedJpeg(): Promise<Buffer> {
  const clean = await sharp({
    create: { width: 400, height: 520, channels: 3, background: { r: 250, g: 250, b: 250 } },
  })
    .jpeg({ quality: 90 })
    .toBuffer()

  let sos = -1
  for (let i = 2; i < clean.length - 1; i++) {
    if (clean[i] === 0xff && clean[i + 1] === 0xda) {
      sos = i
      break
    }
  }
  assert.ok(sos > 0, 'fixture generator must find the SOS marker')

  const out = Buffer.from(clean)
  for (let i = sos + 200; i < out.length - 2; i += 3) out[i] = (out[i]! * 7 + 13) & 0xff
  out[out.length - 2] = 0xff
  out[out.length - 1] = 0xd9
  return out
}

test('an image sharp accepts but tesseract cannot read fails the page, not the process', async () => {
  const bytes = await shreddedJpeg()
  const dir = mkdtempSync(path.join(tmpdir(), 'keepr-corrupt-'))
  const file = path.join(dir, 'shredded.jpg')
  writeFileSync(file, bytes)

  // Precondition: this only tests the OCR path if INTAKE still accepts the file.
  // If a sharp upgrade starts rejecting these bytes, the fixture has stopped
  // reaching tesseract and must be rebuilt — hence an assertion, not a comment.
  const meta = await sharp(file).metadata()
  assert.equal(meta.format, 'jpeg')
  assert.equal(meta.width, 400)

  const provider = createOcrProvider({ workerCount: 1 })
  try {
    await assert.rejects(
      () => provider.ocrPage({ kind: 'file', absPath: file, generation: 1 }),
      (e: unknown) => {
        // Reaching here at all is the containment proof: with the errorHandler
        // removed, the worker error escapes as an uncaught throw on a later tick
        // and this process exits before the assertion can run.
        assert.ok(e instanceof Error, 'must reject with an Error, not a bare string')
        assert.ok(e.message.length > 0, 'and the message must be usable')
        assert.doesNotMatch(e.message, /^Error:/, 'without tesseract doubled prefix')
        return true
      },
    )
  } finally {
    await provider.dispose()
  }
})
