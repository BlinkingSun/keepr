/**
 * Lane E — pure nav-tree logic tests.
 * Run: node --experimental-strip-types --test src/ui/nav/__tests__/*.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Folder, InstantMs } from '../../../shared/types.ts'
import { canDrop, compareFolders, flattenFolders } from '../tree.ts'
import { shouldShowInboxBadge } from '../badge.ts'

const NOW = 1_700_000_000_000 as InstantMs

function mkFolder(
  partial: Pick<Folder, 'id' | 'parentId' | 'name'> &
    Partial<Pick<Folder, 'kind' | 'sortOrder'>>,
): Folder {
  return {
    id: partial.id,
    parentId: partial.parentId,
    kind: partial.kind ?? 'user',
    name: partial.name,
    template: null,
    periodEnd: null,
    comments: null,
    labels: [],
    sortOrder: partial.sortOrder ?? 0,
    createdAt: NOW,
    modifiedAt: NOW,
  }
}

describe('Lane E navigation tree', () => {
  // 1. Flatten a nested folder list into render order with correct depths.
  it('1. flattens nested folders into render order with correct depths', () => {
    const folders = [
      mkFolder({ id: 1, parentId: null, name: 'Tax Year', sortOrder: 0 }),
      mkFolder({ id: 2, parentId: 1, name: 'Q1', sortOrder: 0 }),
      mkFolder({ id: 3, parentId: 1, name: 'Q2', sortOrder: 1 }),
      mkFolder({ id: 4, parentId: 2, name: 'Materials', sortOrder: 0 }),
      mkFolder({ id: 99, parentId: null, name: 'Inbox', kind: 'inbox' }),
      mkFolder({ id: 98, parentId: null, name: 'Trash', kind: 'trash' }),
    ]

    const flat = flattenFolders(folders, new Set())
    assert.deepEqual(
      flat.map((r) => [r.folder.id, r.depth, r.folder.name]),
      [
        [1, 0, 'Tax Year'],
        [2, 1, 'Q1'],
        [4, 2, 'Materials'],
        [3, 1, 'Q2'],
      ],
    )
    // inbox/trash are excluded from the cabinet flatten
    assert.ok(!flat.some((r) => r.folder.kind !== 'user'))
  })

  // 2. Collapsing a parent hides its whole subtree, not just direct children.
  it('2. collapsing a parent hides the whole subtree', () => {
    const folders = [
      mkFolder({ id: 1, parentId: null, name: 'A' }),
      mkFolder({ id: 2, parentId: 1, name: 'B' }),
      mkFolder({ id: 3, parentId: 2, name: 'C' }),
      mkFolder({ id: 4, parentId: null, name: 'Sibling' }),
    ]

    const expanded = flattenFolders(folders, new Set())
    assert.deepEqual(
      expanded.map((r) => r.folder.id),
      [1, 2, 3, 4],
    )

    // Collapse A — B and C (entire subtree) must vanish; Sibling remains.
    const collapsed = flattenFolders(folders, new Set([1]))
    assert.deepEqual(
      collapsed.map((r) => r.folder.id),
      [1, 4],
    )
    assert.ok(collapsed[0]?.hasChildren, 'collapsed parent still reports hasChildren')
  })

  // 3. canDrop refuses a folder onto itself.
  it('3. canDrop refuses a folder onto itself', () => {
    const folders = [mkFolder({ id: 1, parentId: null, name: 'A' })]
    assert.equal(canDrop(1, 1, folders), false)
  })

  // 4. canDrop refuses a folder onto any descendant — three levels.
  it('4. canDrop refuses grandparent onto deepest descendant (3 levels)', () => {
    // A → B → C
    const folders = [
      mkFolder({ id: 10, parentId: null, name: 'A' }),
      mkFolder({ id: 20, parentId: 10, name: 'B' }),
      mkFolder({ id: 30, parentId: 20, name: 'C' }),
    ]

    // Grandparent A must not drop onto C (would cycle and orphan B/C).
    assert.equal(canDrop(10, 30, folders), false)
    // Parent B must not drop onto C.
    assert.equal(canDrop(20, 30, folders), false)
    // A must not drop onto B either.
    assert.equal(canDrop(10, 20, folders), false)
  })

  // 5. canDrop permits a legitimate re-parent to an unrelated branch.
  it('5. canDrop permits re-parent onto an unrelated branch', () => {
    const folders = [
      mkFolder({ id: 1, parentId: null, name: 'A' }),
      mkFolder({ id: 2, parentId: 1, name: 'A-child' }),
      mkFolder({ id: 3, parentId: null, name: 'B' }),
      mkFolder({ id: 4, parentId: 3, name: 'B-child' }),
    ]

    // Move A-child under B.
    assert.equal(canDrop(2, 3, folders), true)
    // Move A under B.
    assert.equal(canDrop(1, 3, folders), true)
    // Move A-child under B-child.
    assert.equal(canDrop(2, 4, folders), true)
    // Move to cabinet root.
    assert.equal(canDrop(2, null, folders), true)
  })

  // 6. Sibling ordering is stable and by sortOrder then name.
  it('6. sibling ordering is by sortOrder then name', () => {
    const folders = [
      mkFolder({ id: 1, parentId: null, name: 'Zulu', sortOrder: 2 }),
      mkFolder({ id: 2, parentId: null, name: 'Alpha', sortOrder: 2 }),
      mkFolder({ id: 3, parentId: null, name: 'Middle', sortOrder: 1 }),
      mkFolder({ id: 4, parentId: null, name: 'First', sortOrder: 0 }),
    ]

    const flat = flattenFolders(folders, new Set())
    assert.deepEqual(
      flat.map((r) => r.folder.name),
      ['First', 'Middle', 'Alpha', 'Zulu'],
    )

    // Direct comparator: same sortOrder falls back to name.
    assert.ok(compareFolders(folders[1]!, folders[0]!) < 0) // Alpha < Zulu
    assert.ok(compareFolders(folders[3]!, folders[2]!) < 0) // sortOrder 0 < 1
  })

  // 7. A cycle already present in malformed data does not infinite-recurse.
  it('7. flatten terminates when folders contain a parent cycle', () => {
    // Reachable back-edge via duplicate id (malformed): root→1→2→1.
    // Two rows share id 1 with different parentIds so byParent has 1 under
    // both null and 2. The ancestor set must cut the second visit.
    const folders: Folder[] = [
      mkFolder({ id: 1, parentId: null, name: 'A' }),
      mkFolder({ id: 2, parentId: 1, name: 'B' }),
      mkFolder({ id: 1, parentId: 2, name: 'A-cycle' }),
      // Disconnected pure cycle (no null parent) must also not hang.
      mkFolder({ id: 10, parentId: 12, name: 'X' }),
      mkFolder({ id: 11, parentId: 10, name: 'Y' }),
      mkFolder({ id: 12, parentId: 11, name: 'Z' }),
      // Self-parent.
      mkFolder({ id: 20, parentId: 20, name: 'Self' }),
    ]

    const start = Date.now()
    const flat = flattenFolders(folders, new Set())
    const elapsed = Date.now() - start

    assert.ok(elapsed < 1000, `flatten took too long (${elapsed}ms) — likely infinite recursion`)
    // Visits A once, then B; the back-edge to A is cut.
    assert.deepEqual(
      flat.map((r) => r.folder.id),
      [1, 2],
    )
    assert.ok(flat.length < 100)
    // Self-parent alone (no null path) also terminates empty.
    assert.equal(
      flattenFolders([mkFolder({ id: 5, parentId: 5, name: 'OnlySelf' })], new Set()).length,
      0,
    )
  })

  // 8. Badge omitted at zero, shown at one or more.
  it('8. inbox badge omitted at zero and shown at one or more', () => {
    assert.equal(shouldShowInboxBadge(0), false)
    assert.equal(shouldShowInboxBadge(1), true)
    assert.equal(shouldShowInboxBadge(17), true)
  })
})
