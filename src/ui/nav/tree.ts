/**
 * Pure folder-tree logic for the navigation panel.
 *
 * Kept free of React and Electron so the cycle-prevention and flatten
 * behaviour can be unit-tested with node:test alone.
 */
import type { Folder } from '../../shared/types.ts'

export interface FlatFolder {
  folder: Folder
  depth: number
  hasChildren: boolean
}

/** Sibling order: sortOrder ascending, then name localeCompare. */
export function compareFolders(a: Folder, b: Folder): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  return a.name.localeCompare(b.name)
}

/**
 * Group folders by parentId. Only `user` folders participate in the cabinet
 * tree; inbox and trash are pinned elsewhere in the panel.
 */
export function groupChildren(folders: readonly Folder[]): Map<number | null, Folder[]> {
  const byParent = new Map<number | null, Folder[]>()
  for (const f of folders) {
    if (f.kind !== 'user') continue
    const key = f.parentId
    let list = byParent.get(key)
    if (!list) {
      list = []
      byParent.set(key, list)
    }
    list.push(f)
  }
  for (const list of byParent.values()) {
    list.sort(compareFolders)
  }
  return byParent
}

/**
 * Depth-first flatten of the user-folder tree into render order.
 *
 * - Indentation depth is returned per row.
 * - A collapsed parent hides its entire subtree (not only direct children).
 * - Cycles in malformed data are cut: a folder already on the ancestor path
 *   is emitted once and not re-entered, so the walk always terminates.
 */
export function flattenFolders(
  folders: readonly Folder[],
  collapsed: ReadonlySet<number>,
): FlatFolder[] {
  const byParent = groupChildren(folders)
  const out: FlatFolder[] = []

  const walk = (parentId: number | null, depth: number, ancestors: ReadonlySet<number>): void => {
    const children = byParent.get(parentId)
    if (!children) return
    for (const f of children) {
      // Cycle cut: do not re-enter a folder already on this path.
      if (ancestors.has(f.id)) continue

      const rawKids = byParent.get(f.id) ?? []
      // Expandable if any child is not already on the path (and not a self-ref).
      let hasChildren = false
      for (const c of rawKids) {
        if (c.id !== f.id && !ancestors.has(c.id)) {
          hasChildren = true
          break
        }
      }

      out.push({ folder: f, depth, hasChildren })

      if (hasChildren && !collapsed.has(f.id)) {
        const next = new Set(ancestors)
        next.add(f.id)
        walk(f.id, depth + 1, next)
      }
    }
  }

  walk(null, 0, new Set())
  return out
}

/**
 * True when `nodeId` is the same as `ancestorId` or lies strictly under it
 * in the parent chain. Walks upward with a seen-set so a cycle cannot loop.
 */
export function isSelfOrDescendant(
  nodeId: number,
  ancestorId: number,
  folders: readonly Folder[],
): boolean {
  if (nodeId === ancestorId) return true
  const byId = new Map<number, Folder>()
  for (const f of folders) byId.set(f.id, f)

  const seen = new Set<number>()
  let current: Folder | undefined = byId.get(nodeId)
  while (current) {
    if (seen.has(current.id)) return false
    seen.add(current.id)
    if (current.parentId === ancestorId) return true
    if (current.parentId == null) return false
    current = byId.get(current.parentId)
  }
  return false
}

/**
 * Whether folder `folderId` may be re-parented onto `targetId`.
 *
 * Refuses:
 * - drop onto itself
 * - drop onto any of its own descendants (would create a cycle and orphan
 *   the subtree under the target)
 *
 * `targetId` null means move to the cabinet root (always allowed for a
 * non-null folder id).
 */
export function canDrop(
  folderId: number,
  targetId: number | null,
  folders: readonly Folder[],
): boolean {
  if (targetId == null) return true
  if (folderId === targetId) return false
  // Refuse if the target is under the dragged folder.
  return !isSelfOrDescendant(targetId, folderId, folders)
}
