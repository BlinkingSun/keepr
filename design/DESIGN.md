# KeepR — APPROVED design (UI gate passed 2026-07-30)

The user signed off on the layout in `design/mockups/01-main-grid.png`,
`02-details-filmstrip.png`, and `03-inbox-review.png`. **Build to these.** If you
believe a screen needs to differ from the approved mockup, stop and raise it with
the orchestrator — do not improvise. Re-litigating layout in shipped code is
exactly what this gate exists to prevent.

Read `DESIGN-GUIDELINES.md` alongside this file: that one states the rules, this
one records what was approved and decided.

## Approved decisions

| Decision | Value |
|---|---|
| Layout | Three-pane: navigation / content / inspector |
| Details view | **Navigation pane stays visible.** Details replaces the center+right panes only. |
| Icon | **K monogram integrated with a receipt edge.** No wordmark in the artwork. |
| Accent hue | **TEAL** — approved 2026-07-30 against the blue alternative. Read it from `--accent`; never hard-code a colour. |
| Density | Compact: 28px rows, 13px base type |
| Theme | Dark only in Phase 1 |

## Required patterns (approved — keep these)

**1. Confidence as an explicit percentage.** Uncertain extracted fields show the
number (`78% match`), not a generic warning glyph. The percentage is what tells
the user whether to bother opening the image. Source it from
`OcrResult.confidence` per field via `receipt_data.extraction_json`.

**2. Primary actions print their keyboard shortcut.** `Accept & Next  Ctrl+Enter`
on the button face. The Inbox is the hot path; it should teach its own shortcuts.

**3. Drag-selectable region over the page image.** Draw a box, assign it to a
field (§3 of the functional spec). Coordinates are in **stored-master pixel
space** — see the geometry invariant in `PLAN.md`.

**4. Live totals in the status bar.** Sum, tax, and unreviewed count for the
current filter or selection. Must be fed by the canonical summable-receipts view
so a split receipt never double-counts.

## Fixed defects — do not reintroduce

- **Form inputs are dark elevated surfaces** with subtle borders. The first Inbox
  mockup used white-filled inputs on a dark panel; that is a light-mode form in a
  dark shell and it is wrong.
- **No sync or "last synced" indicator anywhere.** KeepR Phase 1 is strictly
  offline. Advertising a cloud feature that does not exist is worse than omitting
  it.
- **Color tokens are never UI content.** An early render leaked `#141417` and
  `#FFCA4D` into grid tabs and a date field.
- **No emojis.** Line glyphs from one set, everywhere.

## Colour tokens — APPROVED VALUES

Defined once in Lane 0 as CSS custom properties. **No lane hard-codes a colour.**

```css
--bg-base:        #0F1113;  /* deepest window background                      */
--bg-panel:       #16191C;  /* navigation + inspector panes                   */
--bg-elevated:    #1E2226;  /* grid header, dialogs, menus, FORM INPUTS       */
--border-subtle:  #2A2F35;  /* pane dividers, grid lines, input borders       */

--text-primary:   #E8EBED;
--text-secondary: #A3ACB4;
--text-muted:     #6B747C;  /* three steps, no more                           */

--accent:         #14B8A6;  /* selection, focus ring, primary btn, active seg */
--accent-hover:   #2DD4BF;
--on-accent:      #0F1113;  /* see note — text ON accent is DARK, not white   */

--warn:           #E8A33D;  /* low OCR confidence, missing key data           */
--danger:         #E05252;  /* destructive actions, trash                     */
--ok:             #4DA167;  /* reviewed, reconciled                           */
```

**Text on the accent is dark, not white.** The mockups show white label text on
the teal primary button; that lands near 2.4:1 contrast and fails WCAG AA.
`--on-accent` at `#0F1113` gives roughly 9:1. Use `--on-accent` on every
accent-filled surface — primary buttons, the active segmented item, selected
rows.

Amber `--warn` sits far enough from teal to be unambiguous at a glance, which is
part of why teal was chosen over blue.

Financial figures: tabular-lining numerals, right-aligned, always.

### Token discipline — two misuses found in the mockups, do not reproduce

1. **The Inbox count badge must not be `--danger`.** The mockup renders it red.
   Nothing destructive is happening; it is a count of work waiting. Use
   `--accent` with `--on-accent` text.
2. **The "n unreviewed" figure in the status bar must not be `--warn`.** Amber is
   reserved for low confidence and missing key data. An unreviewed item is not a
   problem, it is a queue depth. Use `--text-secondary`, or `--accent` if it
   needs to be clickable.

If a colour does not carry the meaning its token names, it stops being a signal
and the user learns to ignore all of them.

## Status semantics the user must never hunt for

| State | Treatment |
|---|---|
| Unreviewed | Visibly distinct row; counted in the Inbox badge and status bar |
| Low OCR confidence | Percentage badge at the field, in `--warn` |
| Missing key data | Row marker plus a `--warn` cell marker on the empty field |
| Split child | Persistent split badge linking to siblings |
| Reviewed | `--ok`, understated — the absence of a warning is the reward |
