# SPEC-U — Scan dialog folder route + ScanSnap docs

Owner: one executor. Writes ONLY `src/ui/scan/**`, `README.md`,
`docs/scanning.md`. No main-process or ingest changes.

## UI (extends the approved dialog — no new layout, dark mode, no emojis)
Current empty state blames "USB-only scanners". That is wrong for a Wi-Fi
ScanSnap and reads as a defect. Replace with:

- Heading stays "No network scanners found."
- Body: KeepR finds scanners that speak eSCL (AirScan). **ScanSnap, and many
  Brother and Canon models, do not speak it at all — including over Wi-Fi.**
  Those scan through their own software instead.
- Primary route, as a button: **"Open New Receipts folder"** — calls
  `invoke('shell:openPath', { target: 'newReceipts' })` (channel exists).
- One line under it: point your scanner's software at that folder and KeepR
  imports whatever lands there automatically.
- Keep "Add by IP" for genuine eSCL devices on mDNS-blocked networks.
- Do NOT imply ScanSnap support is coming.

Match existing button alignment/spacing in `scan.css`; no new colors.

## Docs — `docs/scanning.md` (new), linked from README
Sections:
1. **Which scanners work directly** — eSCL/AirScan (most modern network MFPs).
2. **Everything else: scan to a folder** — the New/Old Receipts model.
3. **ScanSnap Home setup (exact)**
   - Scan -> Add profile
   - **Type: `Mac (Scan to file)`** — NOT `Mac (Manage in ScanSnap Home)`
   - Send to / Application: `None (Scan to file)`
   - Save to: `<library>/New Receipts/`
   - Rename after scanning: **off**
   - File format: PDF, single multi-page file
   - Optional: **Convert to Searchable PDF** (opt-in; KeepR uses that text layer
     when present and OCRs the page itself when not)
   - **Why the Type matters:** with Manage-in-Home, ScanSnap tracks the file by
     path. KeepR moves it to `Old Receipts` after import, and ScanSnap then
     reports the file as removed or renamed outside its software; it does not
     re-create it. Scan-to-file avoids this entirely.
4. **ScanSnap Manager (S1300i, S1500, older iX500 setups)** — Quick Menu off,
   Application `None (Scan to File)`, image saving folder = New Receipts,
   rename-after-scan off, optional searchable PDF.
5. **Notes** — KeepR waits for a file to stop changing (3 checks, ~8s) before
   importing, so partially-written scans are never ingested. Avoid pointing New
   Receipts at a cloud-synced folder.

Wording: matter-of-fact, no marketing. State plainly that ScanSnap cannot be
driven over the network by any third-party app.
