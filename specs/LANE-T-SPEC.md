# Lane T — Thumbnail view

**Executor:** grok · **Depends on:** Lane 0 (GridRow.thumbRelPath in contract)

## You own
```
src/ui/thumbs/**
```
Do NOT touch src/ui/app/**, src/ui/grid/**, src/ui/kit/**, src/shared/**,
package.json. The orchestrator mounts your panel at integration.

## The bug you are half of
The Grid/Thumbnail/Details switcher has three buttons; Thumbnail renders nothing
because the view was never built. You build the panel; the orchestrator wires the
switcher.

## Deliverables — `ThumbPanel` (pure props) + logic modules
Props:
```ts
{ rows: GridRow[]; selectedIds: Set<number>;
  onSelectionChange(ids: Set<number>): void;
  onOpenItem(id: number): void;                    // dblclick / Enter
  thumbSrc(row: GridRow): string | null;           // resolver injected; no fs here
  loading: boolean }
```
- Responsive card grid: CSS grid `repeat(auto-fill, minmax(184px, 1fr))`,
  card ≈ thumb (4:5 box, object-fit cover, --bg-elevated letterbox) + caption:
  vendor (or "—"), total right-aligned `.num` with per-row currency via the
  existing grid formatMoney, date muted. Flag badge top-right reusing the same
  severity semantics as the grid's RowFlag (! danger / ? warn / … pending);
  split badge; unreviewed = accent left edge, same as grid rows.
- **Windowed by rows**: reuse computeWindow from src/ui/grid/windowing.ts —
  columns = floor(containerWidth / colWidth), rowHeight = cardH+gap,
  rowCount = ceil(items/cols). 10k items must mount well under 100 cards; test
  the math (pure module `thumbLayout.ts`).
- Selection: click = single, Cmd/Ctrl = toggle, Shift = range over visual order
  (reuse selection helpers from src/ui/grid/selection.ts via the grid's public
  index — they are exported).
- Keyboard: arrows move in 2D (left/right ±1, up/down ±cols, clamped),
  Enter opens, Space toggles selection. Pure `nav2d.ts` + tests.
- Missing thumb (thumbSrc null) → letterbox placeholder with the item type
  glyph-free label ("PDF" / "Contact" / "No image") — no emojis.
- Empty state consistent with the grid's ("No receipts here yet…").
- Tokens only; dark only; no emojis.

## Tests — src/ui/thumbs/__tests__/ (pure logic; no DOM lib installed)
1. Layout math: cols for widths (e.g. 900px/184min+gap), window bounds at top /
   middle / bottom for 10k items, mounted cards < 100.
2. 2D nav: right at row end clamps; down from last partial row clamps to last
   item; up from first row stays; Enter index → id mapping.
3. Range selection over visual order matches grid semantics.
4. thumbSrc null → placeholder branch (pure classifier fn).

Run: node --experimental-strip-types --test src/ui/thumbs/__tests__/*.ts

## Report
DONE|OPEN|BLOCKED / FILES / TESTS / DECISIONS / BLOCKERS
