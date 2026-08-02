# Scanning with KeepR

KeepR can drive some network scanners directly. Everything else scans through
its own software into a watched folder. This page covers both paths.

## 1. Which scanners work directly

KeepR discovers and drives **eSCL (AirScan)** devices on the local network —
most modern network multifunction printers (many HP, Brother, Canon, Epson
models that advertise AirScan / eSCL).

Discovery uses mDNS. If your network blocks multicast, use **Add by IP** in the
Scan dialog and enter the scanner's address (optionally `host:port`).

KeepR does **not** drive scanners over TWAIN, WIA, ImageCaptureCore (ICA), WSD,
or vendor-only protocols. That includes every Fujitsu/PFU **ScanSnap** model
(iX1600, iX1500, iX1300, iX500, iX100, S1300i, SV600, and similar). Wi-Fi on
those units serves ScanSnap Home, ScanSnap Connect, and ScanSnap Cloud only —
not eSCL, AirScan, WSD, or ICA. No third-party app can scan them over the
network. Use the folder path below.

## 2. Everything else: scan to a folder

Each library has two folders next to the database:

```
<library>/
  New Receipts/    drop or scan files here
  Old Receipts/    KeepR moves a file here after a successful import
```

Point your scanner's software (or any save-to-folder tool) at **New Receipts**.
KeepR watches that directory, imports stable files, and moves them to
**Old Receipts** so the filesystem still shows what has and has not been
processed.

Open **New Receipts** from the app: Import menu, or the button in the Scan
dialog when no eSCL devices are found.

## 3. ScanSnap Home setup (exact)

Use this for current ScanSnap models managed by ScanSnap Home (iX1600, iX1500,
iX1300, and similar).

1. Open **ScanSnap Home**.
2. **Scan** → **Add profile** (or edit an existing profile).
3. Set:

| Setting | Value |
|---|---|
| **Type** | **`Mac (Scan to file)`** — not `Mac (Manage in ScanSnap Home)` |
| Send to / Application | `None (Scan to file)` |
| Save to | `<library>/New Receipts/` |
| Rename after scanning | **off** |
| File format | PDF, single multi-page file |
| Convert to Searchable PDF | optional (opt-in checkbox; not the default) |

4. Scan with that profile. Files appear in New Receipts; KeepR imports them.

### Why the Type matters

With **Mac (Manage in ScanSnap Home)**, ScanSnap tracks each file by path.
KeepR moves the file to **Old Receipts** after import. ScanSnap then reports
the file as removed or renamed outside ScanSnap Home and does **not** re-create
the entry. The receipt is still in KeepR, but the Home library entry is broken.

**Mac (Scan to file)** is a clean handoff: ScanSnap writes the file and is
done. KeepR owns the rest of the lifecycle.

### Searchable PDF

**Convert to Searchable PDF** is an opt-in checkbox in ScanSnap Home, not the
default. When the PDF has a usable text layer, KeepR can use it; when it does
not, KeepR OCRs the page itself. Either way, import works.

## 4. ScanSnap Manager (S1300i, S1500, older iX500 setups)

Older units that still use **ScanSnap Manager** (not Home):

1. Open the ScanSnap Manager settings for your profile.
2. Turn **Quick Menu** off.
3. Set **Application** to **`None (Scan to File)`**.
4. Set the **image saving folder** to `<library>/New Receipts/`.
5. Turn **rename after scan** off.
6. Optional: enable searchable PDF if the Manager build offers it.

Same New → Old Receipts flow as above.

## 5. Notes

- **Stability gate.** KeepR does not import a file the moment it appears. It
  waits for **three stable observations** of size and mtime (about **8 seconds**
  total) so a scan that is still being written is never ingested mid-write.
- **Do not point New Receipts at a cloud-synced folder** (iCloud Drive, Dropbox,
  OneDrive, Google Drive, and the like). Sync clients rewrite, lock, or replace
  files after KeepR has already seen them; that races the watcher and can
  corrupt or duplicate imports. Keep the library on a normal local disk.
- **No network ScanSnap driver is planned.** The folder path is the supported
  path for those devices.
