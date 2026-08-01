/**
 * Lane W — dirwalk tests (directory expansion, hidden/unsupported, symlink containment).
 */
import assert from 'node:assert/strict'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import { walkForImportable } from '../dirwalk.ts'
import { writeTestJpeg } from './harness.ts'

test('1. nested subfolders + .txt + .DS_Store → correct set, skippedUnsupported=1, hidden ignored', async () => {
  const root = await mkdtemp(join(tmpdir(), 'keepr-walk-'))
  try {
    await mkdir(join(root, 'sub', 'deep'), { recursive: true })
    await writeTestJpeg(join(root, 'sub'), 'a.jpg')
    await writeTestJpeg(join(root, 'sub', 'deep'), 'b.png')
    await writeFile(join(root, 'notes.txt'), 'stray note')
    await writeFile(join(root, '.DS_Store'), 'hidden')
    await writeFile(join(root, 'desktop.ini'), 'win')
    await writeFile(join(root, 'Thumbs.db'), 'win')
    await mkdir(join(root, '.hidden_dir'), { recursive: true })
    await writeTestJpeg(join(root, '.hidden_dir'), 'secret.jpg')

    const result = await walkForImportable(root)
    assert.equal(result.skippedUnsupported, 1, 'only notes.txt counts as unsupported')
    assert.equal(result.files.length, 2)
    const names = result.files.map((f) => basename(f)).sort()
    assert.deepEqual(names, ['a.jpg', 'b.png'])
    // Deterministic sort (absolute paths sorted).
    assert.deepEqual(result.files, [...result.files].sort())
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('walk refuses directory symlink that escapes the walk root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'keepr-walk-root-'))
  const outside = await mkdtemp(join(tmpdir(), 'keepr-walk-out-'))
  try {
    await writeTestJpeg(outside, 'secret.jpg')
    await symlink(outside, join(root, 'escape_dir'), 'dir')
    await writeTestJpeg(root, 'local.jpg')

    const result = await walkForImportable(root)
    const names = result.files.map((f) => basename(f))
    assert.ok(names.includes('local.jpg'))
    assert.ok(!names.includes('secret.jpg'), 'must not follow escaping dir symlink')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('file symlink under root is listed as the in-tree path, not the outside realpath', async () => {
  const root = await mkdtemp(join(tmpdir(), 'keepr-walk-sl-'))
  const outside = await mkdtemp(join(tmpdir(), 'keepr-walk-sl-out-'))
  try {
    const target = await writeTestJpeg(outside, 'only-original.jpg')
    const linkPath = join(root, 'link.jpg')
    await symlink(target, linkPath)

    const result = await walkForImportable(root)
    assert.equal(result.files.length, 1)
    assert.equal(result.files[0], linkPath)
    assert.ok(!result.files[0]!.startsWith(outside), 'must not return outside realpath')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('empty directory returns 0 files, not an error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'keepr-walk-empty-'))
  try {
    const result = await walkForImportable(root)
    assert.deepEqual(result.files, [])
    assert.equal(result.skippedUnsupported, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
