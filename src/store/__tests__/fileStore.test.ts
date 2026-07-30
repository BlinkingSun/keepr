import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DiskFileStore } from '../fileStore.ts'
import { asRelPath } from '../../shared/types.ts'

const mk = async (citations = 0) => {
  const root = await mkdtemp(path.join(tmpdir(), 'keepr-fs-'))
  let n = citations
  const store = new DiskFileStore({ libraryRoot: root, countCitations: () => n })
  return { root, store, setCitations: (v: number) => { n = v } }
}

test('put is content-addressed and dedupes identical bytes', async () => {
  const { store, root } = await mk()
  const a = await store.put(Buffer.from('receipt-bytes'), 'jpg')
  const b = await store.put(Buffer.from('receipt-bytes'), 'jpg')
  assert.equal(a.rel, b.rel, 'same content must map to the same path')
  assert.equal(a.hash, b.hash)
  assert.match(a.rel, /^images\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.jpg$/)
  // exactly one file on disk despite two puts
  const lvl1 = await readdir(path.join(root, 'images'))
  assert.equal(lvl1.length, 1)
})

test('different content yields different paths', async () => {
  const { store } = await mk()
  const a = await store.put(Buffer.from('one'), 'png')
  const b = await store.put(Buffer.from('two'), 'png')
  assert.notEqual(a.rel, b.rel)
})

test('rejects unsupported extensions', async () => {
  const { store } = await mk()
  await assert.rejects(() => store.put(Buffer.from('x'), 'exe'), /unsupported extension/)
})

test('resolve refuses to escape the library root', async () => {
  const { store } = await mk()
  assert.throws(() => store.resolve('../../etc/passwd' as any), /traversal|escapes/)
  assert.throws(() => asRelPath('/etc/passwd'), /library-relative/)
  assert.throws(() => asRelPath('C:\\Windows\\win.ini'), /library-relative/)
})

test('release does NOT unlink while citations remain', async () => {
  const { store, setCitations } = await mk()
  const { rel } = await store.put(Buffer.from('shared-split-image'), 'jpg')
  setCitations(3)
  const r1 = await store.releaseWithResult(rel)
  assert.equal(r1.unlinked, false, 'must not unlink an image three children still cite')
  assert.equal(await store.exists(rel), true)

  setCitations(1)
  const r2 = await store.releaseWithResult(rel)
  assert.equal(r2.unlinked, false)
  assert.equal(await store.exists(rel), true)

  setCitations(0)
  const r3 = await store.releaseWithResult(rel)
  assert.equal(r3.unlinked, true, 'last reference dropped, bytes should go')
  assert.equal(await store.exists(rel), false)
})

test('releasing an already-missing file is not an error', async () => {
  const { store } = await mk(0)
  const { rel } = await store.put(Buffer.from('gone'), 'jpg')
  await store.releaseWithResult(rel)
  const again = await store.releaseWithResult(rel)
  assert.equal(again.unlinked, false)
})

test('verify catches silent corruption that an existence check would pass', async () => {
  const { store, root } = await mk()
  const { rel } = await store.put(Buffer.from('original'), 'jpg')
  assert.deepEqual(await store.verify(rel), { ok: true })
  await writeFile(path.join(root, rel), 'tampered')
  assert.equal(await store.exists(rel), true, 'file still exists...')
  const v = await store.verify(rel)
  assert.equal(v.ok, false, '...but its content no longer matches its hash')
  assert.match(v.reason!, /content hash mismatch/)
})

test('verify reports missing files distinctly', async () => {
  const { store } = await mk()
  const v = await store.verify(asRelPath('images/aa/bb/' + 'a'.repeat(64) + '.jpg'))
  assert.equal(v.ok, false)
  assert.equal(v.reason, 'missing')
})

test('libraryRoot must be absolute', async () => {
  assert.throws(() => new DiskFileStore({ libraryRoot: 'relative/dir', countCitations: () => 0 }), /must be absolute/)
})
