## CONFIRMED

**2. Device reservation before await**  
`src/main/scanService.ts` L64–78: synchronous `liveScans.set('reserve:'+deviceId, …)` before `await jobs.create`, deleted in `finally`, then real `job.id` entry. Seals the dual-`scan:start` gap across the await.  
*Residual micro-window:* `delete(reservation)` then `set(job.id)` are not one atomic swap; another `start` could slip between those two lines. Practical risk is tiny; optional polish only.

**3. Age-gated `sweepTmp`**  
`src/main/scanService.ts` L135–155: only dirs with `mtimeMs < now - 15min` and not in `liveScans`; no full wipe.

**4. Provenance release on rollback**  
`src/ingest/import.ts` L295–306: catch calls `rollbackItem` then `fileStore.release(sourcePut.rel)`.

**6. Watcher HTTP**  
`src/main/httpApi.ts` L196–202: `GET /watcher`, `POST /watcher/tick`. Your live New→Old drive matches.

**7. Job-level 503 budget + App timer cleanup**  
`src/scan/job.ts` L14–21, L167–168, L192–214, L232: `busyTotal` vs `RETRY_BUDGET_TOTAL_MS` (60s) plus per-gap 20s.  
`src/ui/app/App.tsx` L71–72, L275–276, L284–285, L304–305, L362–367: toast/prune timers tracked and cleared on unmount.

---

## NOT_SEALED

**5. `pendingCount` includes in-flight — incomplete**  
`watchFolders.ts` declares `processingCount` (L135), resets it in `tick().finally` (L334), and adds it into `status().pendingCount` (L405–407), but **never increments it** in the per-file import loop.  
So `pendingCount` is still only “stability streak &lt; 3”. Mid-batch import still reports 0 processing.  
**Hole:** add `processingCount++` before each eligible import/move and `--` in a `finally` for that file (or set to remaining eligible while looping).

---

## Item 1 — OCR containment (with honesty)

**CONFIRMED sealed for the crash you hit**, by code path, not only by your live repro.

| Layer | Evidence | Role |
|---|---|---|
| `errorHandler` on workers | `src/ocr/tesseract.ts` L351–359 | `tesseract.js` `createWorker.js` L241–248: on reject, **without** handler it `throw Error(data)` (your stack); **with** handler it only rejects the promise + calls handler. That is exactly the kill path. |
| Process nets | `src/main/serve.ts` L50–55, `src/main/index.ts` L32–37 | Last resort if something still escapes as unhandledRejection/uncaughtException. |

Your corrupt fixture dying at **sharp decode** never reaches Tesseract; that only proves intake + process nets, not the worker handler. That does **not** leave the original hole open: the handler is wired to the same reject branch that used to throw.

**Stronger fixture (optional empirical exercise of `errorHandler` only):**

You need bytes that **import accepts** (decode/metadata OK) so a page is queued for OCR, but **Tesseract’s load/recognize rejects**.

Practical recipe:

1. Write a **valid** 100×100 JPEG via sharp (clean SOF/SOS/EOI).  
2. Confirm `sharp(buf).metadata()` succeeds.  
3. Corrupt **only after SOS**: flip ~50–200 bytes in the entropy segment (between SOS and EOI), keep file length and EOI (`FF D9`).  
4. If sharp still opens (it often does with “corrupt JPEG” warnings), put that file through import with OCR enabled — worker should reject with something like “Error attempting to read image” and hit `errorHandler` instead of process death.  
5. If sharp rejects the bit-flipped file, try: valid JPEG + **append 4–16 random bytes after EOI** (trailing junk). Sharp often still decodes; Tesseract’s pipeline sometimes still fails depending on version — less reliable than mid-scan corruption.

You do **not** need that fixture to treat item 1 as sealed; use it only if you want a live log line `[keepr] tesseract worker error (contained):`.

---

## VERDICT: **rework** (one line)

Six of seven sealed; **item 5 only** — wire `processingCount` up/down around each in-flight file. Everything else, including OCR containment for the original crash path, is good enough to pass after that one fix.
