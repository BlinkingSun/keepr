# Lane E — Navigation panel

**Executor:** grok · **Wave:** 3 · **Depends on:** Lane 0

## You own exactly these paths

```
src/ui/nav/**
```

**Read** `src/shared/types.ts` (`Folder`), `src/shared/ipc.ts` (`ListRequest`),
`src/ui/kit/tokens.css`, `design/DESIGN.md`,
`design/mockups/05-accent-teal.png`, and `src/ui/app/App.tsx` for how you mount.

**Do NOT touch** `src/ui/app/**`, `src/ui/kit/**`, `src/ui/grid/**`,
`src/ui/viewer/**`, `src/shared/**`, `src/main/**`, `package.json`,
`tsconfig.json`. Lanes F and G are working in this directory right now.

## Goal

The left pane: Inbox with its unreviewed count, a hierarchical folder tree, smart
filters, and Trash. It is how the user moves around the library.

## Props contract

```ts
export interface NavPanelProps {
  folders: Folder[]              // includes kind 'inbox' | 'user' | 'trash'
  inboxCount: number
  selectedFolderId: number | null
  smartFilter: 'all' | 'recent' | 'unreviewed' | 'inbox' | 'trash'
  onSelectFolder(id: number | null): void
  onSelectSmartFilter(f: NavPanelProps['smartFilter']): void
  onCreateFolder(parentId: number | null, name: string): Promise<void>
  onRenameFolder(id: number, name: string): Promise<void>
  onMoveFolder(id: number, newParentId: number | null): Promise<void>
  onDropItems(itemIds: number[], folderId: number): Promise<void>
  collapsed: Set<number>
  onCollapsedChange(next: Set<number>): void
}
```

Export `NavPanel`. **No IPC calls, no imports from `src/main`** — pure
presentation over props so it tests without Electron.

## Features

- Tree with expand/collapse, indentation by depth, persisted collapse state.
- Inline rename (double-click), create child folder, delete when empty.
- **Drag and drop:** items onto a folder (`onDropItems`), and a folder onto
  another to re-parent (`onMoveFolder`). Reject dropping a folder onto its own
  descendant — that creates a cycle and orphans the subtree. There is a required
  test for this.
- Smart filters: View All, Recently Added, Unreviewed.
- Trash pinned to the bottom.
- Inbox count badge, hidden when zero.
- Keyboard: arrows to move, Right/Left to expand/collapse, Enter to select.

## Two token rules that are not preferences

1. **The Inbox badge uses `--accent`, never `--danger`.** A count of waiting work
   is not destructive. The first mockup got this wrong and it was corrected at
   review.
2. Dark text (`--on-accent`) on any accent fill. White text on the teal fails
   WCAG AA at roughly 2.4:1.

No hard-coded colours, dark mode only, **no emojis**, 28px rows.

## Tests — `src/ui/nav/__tests__/`

Test the pure logic; keep the component thin.

1. Flatten a nested folder list into render order with correct depths.
2. Collapsing a parent hides its whole subtree, not just direct children.
3. `canDrop(folderId, targetId)` refuses a folder onto itself.
4. `canDrop` refuses a folder onto any descendant — build three levels and assert
   the deepest is rejected as a target for its grandparent.
5. `canDrop` permits a legitimate re-parent to an unrelated branch.
6. Sibling ordering is stable and by `sortOrder` then name.
7. A cycle already present in malformed data does not cause infinite recursion —
   assert the flatten terminates.
8. Badge is omitted at zero and shown at one or more.

## Report

```
DONE | OPEN | BLOCKED
FILES: / TESTS: / DECISIONS: / BLOCKERS:
```
