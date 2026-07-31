# Lane G — Viewer panel (details, thumbnail, filmstrip, image tools)

**Executor:** grok · **Wave:** 3 · **Depends on:** Lane 0

## You own exactly these paths

```
src/ui/viewer/**
```

**Read** `src/shared/types.ts` (`ResolvedPage`, `BBox`, `Word`, `Rotation`,
`ExtractionRecord`, `FieldProvenance`), `src/shared/ipc.ts` (`ItemDetail`,
`ItemPatch`, `PatchResult`), `src/ui/kit/tokens.css`, `design/DESIGN.md`,
`design/mockups/02-details-filmstrip.png`, `design/mockups/03-inbox-review.png`.

**Do NOT touch** `src/ui/app/**`, `src/ui/kit/**`, `src/ui/nav/**`,
`src/ui/grid/**`, `src/shared/**`, `src/main/**`, `src/ocr/**`, `package.json`,
`tsconfig.json`. Lanes E and F are working here right now.

## Goal

The right pane and the Details view: large page image, filmstrip for multi-page
items, the extracted-field form, and image tools.

## Props contract

```ts
export interface ViewerPanelProps {
  detail: ItemDetail | null
  loading: boolean
  activePageIndex: number
  onActivePageChange(i: number): void
  /** Absolute file URL for a page. The orchestrator resolves it; you never
   *  touch the filesystem or join paths yourself. */
  pageSrc(page: ResolvedPage): string
  onPatch(itemId: number, patch: ItemPatch): Promise<PatchResult>
  onRotate(pageId: number, rotation: Rotation): Promise<void>
  onReorderPages(itemId: number, pageIdsInOrder: number[]): Promise<void>
  onDeletePage(pageId: number): Promise<void>
  /** Region drawn over the image, in STORED-MASTER pixel space. */
  onAssignRegion(pageId: number, field: string, box: BBox): Promise<PatchResult>
  variant: 'inspector' | 'details'
}
```

Export `ViewerPanel`. **No IPC, no fs, no path joining.** Pure presentation.

## The geometry invariant — read twice

Word boxes and any region you emit are in **stored-master pixel space**: the
pixels of the file as it sits on disk, *before* display rotation.

- `page.rotation` is metadata. You apply it as a CSS transform for display.
- When the user drags a region on a rotated or zoomed image, you must map screen
  coordinates **back** through zoom and rotation into stored-master space before
  calling `onAssignRegion`. Getting this wrong makes the searchable PDF text layer
  and field assignment drift while still looking approximately right, which is
  the worst kind of wrong.
- There is a required round-trip test for this.

## Features

- Large image with zoom (fit, 100%, pinch/wheel) and pan.
- Filmstrip below for multi-page items, active page highlighted, drag to reorder.
- Field form: Transaction Date, Vendor, Total, Payment Type, Tax, Category, Tax
  Category, Project. Inline editable, committing through `onPatch`.
- **Confidence as an explicit percentage** next to any field whose
  `FieldProvenance.confidence` is below 0.75, in `--warn` — `78% match`, not a
  generic icon. The user needs to know *how* unsure it is. This was specifically
  approved at the UI gate.
- Drag a region over the image, then assign it to a field.
- Rotate left/right, delete page, reorder — grouped in one consistent toolbar.
- `variant: 'inspector'` is the narrow right-pane form; `'details'` is the wide
  view with the large image and filmstrip.

## Styling

Tokens only, dark mode, **no emojis**. Form inputs are **dark elevated surfaces**
(`--bg-elevated`) with subtle borders — the first mockup used white-filled inputs
on a dark panel and that was rejected as a light-mode form in a dark shell. Dark
text on accent fills.

## Tests — `src/ui/viewer/__tests__/`

1. **Coordinate round-trip:** for each rotation in 0/90/180/270 and zooms 0.5/1/2,
   map a stored-master box to screen and back; assert it returns to the original
   within a pixel.
2. A region drawn on a 90°-rotated image maps to the correct stored-master box —
   assert concrete numbers, not just that it runs.
3. Zoom fit calculation for a portrait image in a landscape viewport and the
   reverse.
4. Filmstrip reorder produces a correct `pageIdsInOrder` for a move from index 4
   to index 1.
5. Confidence display: 0.78 renders "78%", 0.9 renders nothing (above threshold),
   null renders nothing.
6. Page navigation clamps at first and last rather than wrapping.
7. Rotation cycling: 270 + 90 wraps to 0, and 0 - 90 wraps to 270.

## Report

```
DONE | OPEN | BLOCKED
FILES: / TESTS: / DECISIONS: / BLOCKERS:
```
