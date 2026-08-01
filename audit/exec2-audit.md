Auditing the batch-2 diff and probing the paths you named; then exercising the headless API where possible.## VERDICT: **rework**

Core batch-2 design (staging, source-file dedupe, single-flight tick, multi-page import, scan cancel by active id) is largely in place. Live headless run hit a **process-killing OCR path** and a few residual races; those block “pass.”

---

## DEFECTS

### CRITICAL

**1. OCR worker errors kill the whole process**  
`tesseract.js` worker throws on corrupt images; uncaught → Node exits.  
**Scenario:** `POST /import` with a bad/minimal JPEG (or watcher picks one up) queues OCR → process dies mid-serve; library left with open WAL and unreaped work until next open. Observed on `/tmp/keepr-lib-test` (import OK, then crash; restart reaped 1 job).  
**Fix:** trap worker/process errors in OCR path; mark page `failed`; never rethrow to top-level event loop.

**2. `scanService.start` race on same device**  
`liveScans` check, then `await jobs.create`, then `set`.  
**Scenario:** two concurrent `scan:start` for the same device both pass the check → two live scans.  
**Fix:** reserve device id synchronously (set placeholder before await) or mutex per device.

**3. `sweepTmp` vs second app instance**  
`scanService.sweepTmp` deletes entire `.scan-tmp` at startup.  
**Scenario:** two instances on one library; B starts while A is scanning → A’s staging pages deleted mid-job.  
**Fix:** lock file on library open, or only delete tmp dirs older than N minutes / not matching live job ids.

### HIGH

**4. `importPagesAsItem` provenance blob leak on mid-batch failure**  
`putOriginalSource` runs **before** the try; `rollbackItem` only releases **page** blobs.  
**Scenario:** pages 1–2 stored, page 3 put/add fails → item rolled back, but first-page **source** object remains in the content store forever.  
**Fix:** release `sourcePut.rel` in the catch (or put source inside try after item create with full rollback).

**5. `status().pendingCount` understates work**  
Counts only stability streak &lt; 3; ignores in-flight eligible files mid-import/move.  
**Scenario:** large New batch mid-tick → UI shows pending 0 while still importing.  
**Fix:** include “processing” count or `inFlight !== null` flag in status.

**6. 503 budget resets after every successful page**  
`busyElapsed = 0` on each 200 body.  
**Scenario:** N pages each preceded by ~20s of 503 → total wait ≈ N×20s (not one 20s budget for the job).  
**Fix:** job-level budget, or cap total 503 wait separately from per-gap wait.

**7. No HTTP `watcher` status (headless gap)**  
`GET /watcher` / `/watcher/status` → no route.  
**Scenario:** CI cannot assert watching/pending/failed without FS sniffing or IPC.  
**Fix:** `GET /watcher` mirroring `watcher:status` (and optional `POST /watcher/tick` for tests).

### MEDIUM

**8. Watcher toast timer not cleared on unmount**  
`setTimeout(() => setWatcherNote(null), 6000)` with no cleanup.  
**Scenario:** unmount App during toast → setState on unmounted component (leak/warning). Same for 30s `scanJobIds` prune timers.

**9. File replaced with same size+mtime**  
Stability is only (size, mtimeMs)×3.  
**Scenario:** overwrite in place without mtime bump (some tools) → can ingest earlier observation (rare). Content-hash after read mitigates wrong library bytes if read is final; still racey if content changes between last stability check and `readFile`.

**10. Symlinked *file* still imported; archive renames the link**  
Move-safe allows archiving the symlink entry (not the target).  
**Scenario:** usually OK; if import followed target bytes and “success” archives the link, New loses the link while target outside New remains (not loss of target). Directory cycles: walk uses realpath visited-set — **OK**.

**11. Cancel-during-backoff**  
`sleepWithAbort` honors signal — **OK**.  
**Location re-host** — `resolveJobUrl` forces device base host — **OK**.  
**Partial page on connection drop** — body read fully before write; no `onPage` on throw — **OK** (temps cleaned in `scanToFiles` catch).

**12. Import menu vs scan modal z-index**  
menu scrim 60, modal 70 — scan wins — **OK** (not a defect).

**13. `reapOrphans`**  
On open, stuck `running`/`queued` → `failed`/`partial` — **OK** for single-instance crash. Does not stop multi-instance tmp wipe (#3).

**14. Cancel targets active job**  
`activeScanJobId.current` used (post-a97ab69) — **OK**; earlier “pop Set” concern fixed. `scanJobIds` pruned after 30s, not unbounded for the window lifetime (still unmount timer leak as in #8).

---

## TEST (PLAN-2 acceptance)

| # | Criterion | Result |
|---|---|---|
| 1 | `POST /import` directory recursive + skip junk | **pass** — `itemIds` length 2, `skippedUnsupported: 1` |
| 2 | Drop New → Inbox + Old within ~10s | **fail / not completed** — file stayed in New; process crashed on OCR before archive completed |
| 3 | Re-drop already-ingested → no new item, still archives | **not-checkable** here (blocked by #2/crash) |
| 4 | Kill between ingest and move → self-heal | **not-checkable** this run (unit coverage may exist; live not driven) |
| 5 | Scan 2-page ADF → one item, Old files, progress | **not-checkable** via HTTP (no scan route); unit tests exist |
| 6 | Sort category/payment/tax NULLs-last | **pass** (your verification + R tests); API list has no sort query params in `GET /items` — **API sort not exposed** |
| 7 | Thumbnail / Details empty / view switcher | **pass** (you verified UI; not HTTP) |
| 8 | needsReview / unreviewed distinct | **partial** — `filter=needsReview` works on restart if server stays up; crash prevented full recheck |
| 9 | Existing tests green | **pass** (your 355) |

**Headless note:** No `GET /watcher`; OCR crash makes long-lived serve unreliable for watcher acceptance.

---

## REWORK (minimum)

1. **Contain OCR failures** so corrupt images cannot take down main/serve (highest priority for field use).  
2. **Device mutex** before `await jobs.create` in `scanService.start`.  
3. **Library single-instance lock** or safer `sweepTmp` policy.  
4. **`importPagesAsItem` catch:** release provenance blob on rollback.  
5. **`GET /watcher`** (and optionally test-only `POST /watcher/tick`) for headless acceptance #2–4.  
6. **Job-level 503 budget** (or document page-gap budget).  
7. **Clear watcher/scan timeouts on unmount.**

After 1–5, re-run serve drop test with a **valid** JPEG (or OCR disabled in serve) to green acceptance #2.

---

### Hunt answers (short)

| Hunt | Result |
|---|---|
| Single-flight + watch during poll | **Safe:** concurrent `tick()` shares one `inFlight`. Next tick after complete can run immediately. |
| File replaced between stability obs | Size/mtime change resets streak; same mtime+size content swap is a residual edge. |
| Deleted mid-tick | Import fails → failed/retry path; no move. |
| Symlinked dir loop | Walk realpath set — **OK**. |
| `pendingCount` during tick | **Lies low** while processing eligible files. |
| `importPagesAsItem` partial page 3/4 | Item + pages rolled back; **source blob may leak**; combined hash only kept if item survives. |
| 503 budget | Bounded **per gap** (20s), not whole job; cancel during sleep **works**. |
| Location other host | **Re-hosted** to device base. |
| Chunked drop mid-body | No page file written. |
| Dual `scan:start` | **Race** around `jobs.create`. |
| `sweepTmp` + second instance | **Unsafe**. |
| Dead mid-scan job | **reapOrphans** on next open. |
| App cancel wrong job | **Fixed** via `activeScanJobId`. |
| scanJobIds leak | Pruned after 30s; timers not cleared on unmount. |
| Import vs scan z-index | Modal higher — **OK**. |
