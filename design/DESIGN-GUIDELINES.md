# KeepR — Design Guidelines

Binding for every agent that touches KeepR UI. Written at plan time so the next
agent does not have to guess. Update this file rather than diverging from it.

## Non-negotiables (team charter)

1. **Dark mode by default.** Light mode is opt-in only, and only if the user asks.
2. **No emojis anywhere in the UI.** Icons are line glyphs from one set.
3. **Consistent button alignment, colour, and spacing.** Primary action right-most
   in a row; destructive actions separated and never adjacent to a confirm.
4. **Animation only where it earns its place** — view transitions, filmstrip
   paging, panel open/close. Never on data rows, never blocking input.
5. **Approved mockup is the contract.** Build to it; do not improvise layout.

## Layout — three-pane, because this is a library tool

```
+----------------+------------------------------------+------------------+
| Navigation     | Grid / Thumbnail / Details         | Inspector        |
|                |                                    |                  |
| Inbox (n)      | editable spreadsheet grid,         | large page image |
| Cabinet        | virtualized, multi-sort,           | filmstrip below  |
|  > Folder      | column mgmt                        | form fields      |
|    > Subfolder |                                    | comments         |
| Smart filters  |                                    |                  |
| Trash          | [ status bar: live totals ]        |                  |
+----------------+------------------------------------+------------------+
```

- Navigation pane collapsible. Inspector collapsible. Grid never collapses.
- **Live totals in the status bar** (§7) — sum of the current filter/selection,
  always visible. This is the number the user is actually chasing.
- View switcher (Grid / Thumbnail / Details) is a segmented control, top-right.

## Density

This is a data tool for someone processing hundreds of receipts. Default to
**compact**: 28px grid rows, 13px base type. Ship a Comfortable toggle. Do not
pad it out like a consumer app — wasted vertical space is wasted work.

## Colour (dark)

| Token | Use |
|---|---|
| `bg-base` | window background, deepest layer |
| `bg-panel` | navigation + inspector panes |
| `bg-elevated` | grid header, dialogs, menus |
| `border-subtle` | pane dividers, grid lines |
| `text-primary` / `text-secondary` / `text-muted` | three-step hierarchy only |
| `accent` | selection, focus ring, primary button |
| `warn` | low OCR confidence, missing key data |
| `danger` | destructive actions, trash |
| `ok` | reviewed / reconciled |

Rules: exactly one accent hue. Semantic colours (`warn`/`danger`/`ok`) never used
decoratively — if it is coloured, it means something. Financial figures are
tabular-lining numerals, right-aligned, always.

## State the user must never have to hunt for

- **Unreviewed** items visibly distinct from reviewed ones.
- **Low OCR confidence** on a field marked inline, at the field, in `warn`.
- **Split receipts** carry a persistent split badge linking to their siblings.
- **Missing key data** (no vendor/date/amount) flagged in the row, not only in a report.

## Keyboard first (§11 "keyboard-centric bulk edit")

Full keyboard traversal of the grid; Enter commits and moves down; Tab moves
right; `Cmd/Ctrl+Enter` marks reviewed and advances to the next unreviewed item.
Every bulk operation reachable without the mouse. The Inbox review loop is the
hot path — it must be fast enough to clear 50 receipts without touching a mouse.

## Icon

Custom icon generated with Grok Imagine: dark, modern, suggests a *kept archive
of receipts* rather than a generic folder or dollar sign. macOS `.iconset` → `.icns`
and Windows `.ico` both produced from the same master.
