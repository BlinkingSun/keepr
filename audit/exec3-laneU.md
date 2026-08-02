I'll read the Lane U spec and plan context, then implement only the allowed files.Next I'll inspect the current scan UI and README so the empty-state and docs match the existing patterns.I'll check how `invoke` and `shell:openPath` are used so the folder button wires up correctly.Implementing the empty-state UI, docs, and README link. ScanPanel will call `invoke` via the bridge so App.tsx stays untouched.Writing `docs/scanning.md` and linking it from the README.## DONE
- `src/ui/scan/ScanPanel.tsx` — empty state no longer blames USB; eSCL copy + **Open New Receipts folder** via `invoke('shell:openPath', { target: 'newReceipts' })`; footnote updated
- `src/ui/scan/scan.css` — `.scan-empty-route` / `.scan-folder-btn` / `.scan-empty-hint` (existing tokens, 30px height, full width)
- `docs/scanning.md` — new: eSCL path, folder model, ScanSnap Home exact profile, Manager path, stability gate + cloud warning
- `README.md` — scanner rows, Scanning section link, status/contributing wording

## OPEN
None.

## TEST
- `npx tsc -p tsconfig.json` — clean (exit 0)
- `npm run build` — success (pre-existing `import.meta` CJS warnings only)

## BLOCKERS
None.
