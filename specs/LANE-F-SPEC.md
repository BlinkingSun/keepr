# Lane F — Grid panel (editable, virtualized)

**Executor:** grok · **Wave:** 3 · **Depends on:** Lane 0

## You own exactly these paths

```
src/ui/grid/**
```

**Read** `src/shared/ipc.ts` (`GridRow`, `ListRequest`, `ItemPatch`, `PatchResult`,
`FilterTotals`), `src/ui/kit/tokens.css`, `design/DESIGN.md`,
`design/mockups/05-accent-teal.png`, and `src/ui/app/App.tsx` to see how you are
mounted.

**Do NOT touch** `src/ui/app/**` (the orchestrator composes the panes),
`src/ui/kit/**`, `src/shared/**`, `src/main/**`, `src/db/**`, `package.json`,
`tsconfig.json`. Lanes E and G are editing `src/ui/nav/**` and `src/ui/viewer/**`
in this same directory right now.

## Goal

The centre pane: a spreadsheet-style grid that stays fluid at 10,000 rows with
inline editing. This is the surface the user spends their day in.

## Hard requirements

**1. Virtualized.** Render only visible rows plus a small overscan. A 10,000-row
list that mounts 10,000 DOM nodes is the failure this requirement exists to
prevent. Implement windowing yourself against a scroll container — do not add a
dependency, `package.json` is frozen for this lane.

**2. Never present superseded split origins.** `GridRow` from `item:list` already
excludes them, so simply do not add an option that includes them. Listing a split
origin beside its own children makes the visible amounts sum to double the real
money, with a correct total underneath. This bug shipped once and was caught by
audit; do not reintroduce it.

**3. Money is right-aligned tabular numerals.** Use the `.num` class from
`tokens.css`. A column of proportional digits cannot be scanned.

**4. Never format money yourself from a float.** `GridRow.totalMinor` is integer
minor units. Divide by 100 for display only, at the last moment.

**5. Currency is per row.** Do not assume USD.

## Props contract — the orchestrator passes exactly this

```ts
export interface GridPanelProps {
  rows: GridRow[]
  totals: FilterTotals | null
  loading: boolean
  selectedIds: Set<number>
  onSelectionChange(ids: Set<number>): void
  onOpenItem(itemId: number): void
  /** Commit one field. Resolves with per-field errors rather than throwing. */
  onPatch(itemId: number, patch: ItemPatch): Promise<PatchResult>
  sort: Array<{ column: string; dir: 'asc' | 'desc' }>
  onSortChange(sort: Array<{ column: string; dir: 'asc' | 'desc' }>): void
  columns: ColumnState[]
  onColumnsChange(cols: ColumnState[]): void
  density: 'compact' | 'comfortable'
}
export interface ColumnState {
  key: string; label: string; width: number; visible: boolean; order: number
}
```

Export `GridPanel` plus `DEFAULT_COLUMNS`. The panel calls **no** IPC and imports
nothing from `src/main` — it is pure presentation over props, so it tests without
Electron.

## Features

- **Inline edit:** double-click or Enter opens an editor on the focused cell.
  Enter commits and moves down; Tab commits and moves right; Escape reverts.
  Show per-field errors from `PatchResult.errors` at the cell, in `--warn`.
- **Multi-column sort:** click cycles asc → desc → off. Shift-click adds a
  secondary sort. Show the sort index when more than one is active.
- **Columns:** show/hide, reorder by drag, resize by dragging the header edge,
  rename. All of it in `ColumnState`, surfaced through `onColumnsChange`.
- **Selection:** click, Shift-click for a range, Cmd/Ctrl-click to toggle,
  Cmd/Ctrl+A for all. Selection lives in the parent via `onSelectionChange`.
- **Keyboard:** full arrow traversal, Home/End, PageUp/PageDown, and
  `Cmd/Ctrl+Enter` to mark reviewed and jump to the next unreviewed row.
- **Status markers** per `design/DESIGN.md`: unreviewed rows visually distinct;
  `lowConfidenceFields` show a percentage badge in `--warn` at the field;
  `missingFields` mark the row and the empty cell; split children carry a badge.
- **Empty state** that says what to do, not just "no data".

## Styling

Every colour, spacing and duration comes from a `tokens.css` custom property. No
hard-coded hex. Dark mode only. **No emojis.** Compact default: 28px rows, 13px
type. Dark text (`--on-accent`) on any accent fill — white fails contrast on the
teal.

## Tests — `src/ui/grid/__tests__/`

`node --experimental-strip-types --test`. No DOM library is installed, so test the
**logic** you extract into pure modules, and keep the React component thin:

1. Windowing math: given scroll offset, row height, viewport height and overscan,
   assert the correct visible index range, including at the very top, the very
   bottom, and with an empty list.
2. 10,000 rows produce a visible window of well under 100 — assert the number.
3. Multi-sort comparator: stable, correct across strings, numbers, nulls-last.
4. Nulls sort last in both directions.
5. Selection: range select, toggle, select-all, and clamped ranges.
6. Column reorder and resize produce a valid `ColumnState[]` with unique orders.
7. Money formatting: `8437 -> "$84.37"`, `-8437 -> "-$84.37"`, `null -> "—"`,
   `123456789 -> "$1,234,567.89"`, and EUR renders with its own symbol.
8. Keyboard navigation reducer: Enter moves down, Tab moves right, both clamp at
   the edges rather than wrapping.

## Report

```
DONE | OPEN | BLOCKED
FILES: <paths>
TESTS: <command> -> <pass/fail>
DECISIONS: <judgement calls>
BLOCKERS: <anything you needed but could not touch>
```
Report real numbers. A truthful partial beats a claimed DONE that does not build.
