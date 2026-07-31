Auditing Wave 3 UI panels and App composition against the commit and the failure modes you listed.## VERDICT: **rework**

Panels are solid as pure presentation; composition and lifecycle around selection/edit/detail races are where this wave still fails. Virtualization math and geometry pure-math look real. Your three integration fixes are correct and not papering over deeper issues.

---

## DEFECTS

### 1. HIGH — Selection / open item go stale across list changes  
**Where:** `src/ui/app/App.tsx` (folder/filter handlers, `selectedIds`, `openItemId`, status bar).  

**Scenario:** Select 3 receipts → switch folder or smart filter.  
- `selectedIds` is **not** cleared (only cleared on `onDropItems`).  
- Status bar still shows `· 3 selected` though none of those rows are on screen.  
- `openItemId` stays; inspector can show an item **not in the current list**.  
- Any later bulk op wired to `selectedIds` would act on invisible IDs.  

Repo excludes superseded origins (`items.ts` + `includeSuperseded`); grid does not reintroduce them. Stale **selection of normal ids** is the hole.

### 2. HIGH — Inline edit is index-based; refresh can retarget the wrong row  
**Where:** `GridPanel.tsx` `editing: { row, col, draft }`, `commitEdit`; `App` `onPatch` → `refresh()`; `item:changed` / `ocr:pageDone` also call `refresh`.  

**Scenario:** User is editing total on list index 5 (item A). OCR finishes → `refresh` replaces/reorders `rows`. `editing.row` is still `5`, but `rows[5]` is now item B. Enter commits **B’s** total with A’s draft.  

No effect cancels edit when `rows` identity changes; commit keys by index, not `itemId`.

### 3. HIGH — Detail fetch has no request generation (list does)  
**Where:** `App.tsx` ~L110–120.  

**Scenario:** Open item A, quickly open B. Slow `item:detail` for A returns after B’s and `setDetail` shows A while `openItemId === B`.  

List path correctly uses `reqSeq`; detail path does not.

### 4. MEDIUM — Status bar is filter-only, not selection  
**Where:** `App.tsx` footer uses `totals` from `item:list` only.  

**Scenario:** User multi-selects a subset to check a partial sum. Footer still shows full filter sum; only a selection **count** updates. Design guidelines call for live totals of **filter/selection**. Not a double-count bug, but wrong for the hot path.

### 5. MEDIUM — Tab never leaves the grid  
**Where:** `GridPanel.tsx` `onKeyDown` — `Tab` always `preventDefault` and moves cell focus.  

**Scenario:** Keyboard-only user cannot Tab into nav, inspector, or titlebar controls without clicking. Escape only cancels edit. Spreadsheet-like, but focus is trapped.

### 6. LOW–MEDIUM — Geometry: pure math is real; DOM alignment untested  
**Where:** `geometry.ts` + `PageCanvas.tsx` (CSS `rotate` + centered `img-wrap` + pan on stage).  

**Tests:** Round-trips use real corners and **concrete** 90° expectations (`x=0,y=80,w=30,h=20`) — not tautologies. Floating-point is handled with tolerances.  

**Gap:** Nothing asserts that `PageCanvas` layout (margin centering + CSS transform origin) matches the pure model’s AABB origin. A mismatch would only show up as mis-aimed region assign at 90/270°. Residual integration risk, not a proven math bug.

### 7. LOW — Virtualization edge cases mostly OK; tests incomplete  
**Math (`windowing.ts`):** empty → empty window; 1 row and `rowCount < viewport` mount all rows; scroll past end clamps; 10k window &lt; 50.  

**Uncovered:** resize while scrolled to bottom (math reclamps on next render if `scrollTop` is re-read — ResizeObserver updates height but does not re-clamp DOM `scrollTop` until scroll event); density/rowHeight change with same pixel scroll jumps rows (App hardcodes `compact`, so low risk now).  

Not broken for the cases I probed; tests don’t lock few-row / single-row.

### 8. LOW — Double-click opens details **and** starts edit  
**Where:** `handleRowDoubleClick`. Grid unmounts when switching to details, so edit is wasted; odd UX only.

### Not defects for your hunts
- **Superseded double-count in grid:** default `item:list` adds `superseded_at IS NULL`; App never sets `includeSuperseded`. Totals from API views. No grid path resurrects origin shells.  
- **`reqSeq` for list:** correct; stale list responses discarded.  
- **Listeners:** `on(...); return () => { offItem(); offOcr() }` — no leak when `refresh` changes.  
- **Colours:** hex only in `tokens.css`; panels use tokens; accent fill uses `--on-accent` (dark). No emoji (sort uses ▲▼).  
- **Column widths 112/124:** present in `DEFAULT_COLUMNS`.

---

## TEST_QUALITY

| Test | Issue |
|---|---|
| `windowing.test.ts` | No single-row, few-rows-under-viewport, or density/rowHeight change. Bottom clamp exists. |
| `geometry.test.ts` | **Strong** for pure functions (concrete 90° + multi rot/zoom). **Silent** on PageCanvas DOM wiring. |
| `keyboard.test.ts` | Pure reducer only — no “Tab escapes grid”, no focus trap, no interaction with edit/commit. |
| `selection.test.ts` | Pure set math — no “selection pruned when `rows` shrinks”. |
| `confidence.test.ts` | Threshold only — fine after shared constant. |
| Nav `tree.test.ts` | Cycle guard (you verified) — good; not composition. |
| **Missing entirely** | App composition: reqSeq detail race, selection clear on folder change, edit-survives-refresh. Unit panel tests cannot catch these. |

---

## MY_FIXES

| Fix | Verdict |
|---|---|
| **1. Shared `LOW_CONFIDENCE_THRESHOLD = 0.85`** | **Correct.** Repo + viewer import it; 0.80 flags both. Matches mockup (78% flagged). Comment in `confidence.ts` still says “SPEC prose 0.75” — fine. |
| **2. Remove GridPanel footer** | **Correct.** Footer CSS remains unused; App status bar is sole strip. Not papering over totals logic. |
| **3. Date 112 / Total 124** | **Correct** for truncation; not a substitute for real min-width/flex later. |

None of the three hide the selection/edit/detail races above.

---

## REWORK (minimum)

1. **On folder/smart-filter change (and after list refresh):**  
   `setSelectedIds` ∩ current `rows` (or clear); if `openItemId` ∉ new rows, clear or keep intentionally with a “not in filter” affordance.  
2. **Key editing by `itemId`**, not row index; cancel or rebind edit when that id leaves `rows`.  
3. **Detail load `detailSeq`** same pattern as `reqSeq`.  
4. **Optional but cheap:** selection sum in status bar when `selectedIds.size > 0` (sum from listed rows only, still per-currency).  
5. **Tab:** allow Shift+Tab from first cell / Tab from last to leave the grid, or document intentional trap.  

1–3 are the rework bar; 4–5 polish.

---

## Hunt answers (short)

1. **Virtualization:** Math holds for empty/1/few/10k/bottom; density/resize poorly tested, App fixed compact.  
2. **Superseded:** Not resurfaced; list SQL excludes them.  
3. **Geometry:** Round-trip math is genuine; DOM not proven.  
4. **Selection stale:** Yes — folder switch and deleted/filtered items.  
5. **`reqSeq`:** Correct for list; detail lacks equivalent.  
6. **Inline edit + refresh:** Can clobber / wrong row via index.  
7. **Tokens / emoji / contrast:** Clean.  
8. **Listeners:** Cleaned up.  
9. **Keyboard:** In-grid operable (arrows, Enter, F2, Ctrl+Enter, Ctrl+A); Tab trapped.
