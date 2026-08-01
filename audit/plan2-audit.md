Reading the batch-2 specs and contract changes, then fanning out focused slice audits.I'll pressure-test LaneI'll pressure S (eSCL/AirScan) against the batch-test the BatchI'll pressure-2 spec 2 cross--lanetest Lane contract and product decisions and codebase R (repo — read sort + thumbRelPath)-only, looking against the codebase and SPEC for protocol, UI—starting against the codebase—IPC types, job kinds, library with plan, and failure-mode gaps. docs, items repo, grid columns, and related views paths, and import/scan orchestration..I'll run a hostile, read-only audit of Lane T (Thumbnail view): locate the thumbs UI, windowing/selection helpers, and related specs, then pressure-test the listed risks.I'll audit Lane W (folder ingest + New/Old watcher) read-only: map the implementation, then chase every path that can lose or duplicate a user file.Next I'll read the Lane T spec and the shared grid windowing/selection/keyboard pieces it depends on.# Hostile plan audit — KeepR Batch 2 **Lane S** (eSCL/AirScan)

**Scope audited:** `specs/LANE-S-SPEC.md`, `PLAN-2.md` scanner decisions, Lane 0 scan contracts in `src/shared/{types,ipc}.ts`, composition targets in ingest/job/UI, and current main wiring.  
**Code status:** Lane S not implemented yet (`src/scan/**` absent). This is a **plan** audit, not an exec audit.  
**Verdict:** **`revise-slice`**

---

## Executive summary

Lane S’s pure-JS eSCL client shape is sound: injectable mDNS, mock HTTP server tests, typed errors, temp→rename page writes, TLS listed-but-refused, probe path for mDNS-blocked nets. That core is implementable.

The slice **does not close** acceptance #5 (“one 2-page item”), **under-specifies** integrate failure modes for multi-page scan→ingest, **collides** with the existing import progress UI via job-kind reuse, and is **thin against real device variance** (ADF empty encodings, auth, PDF-only ADF, TLS-only MFPs, capabilities XML). Shipping as written will pass mock tests and fail field scanners / acceptance.

---

## Findings by severity

### CRITICAL

#### C1 — Acceptance #5 is impossible with current ingest composition
**Spec:** PLAN-2 acceptance #5: 2-page ADF → `Old Receipts/Scan … p1.jpg` + `p2.jpg` + **one 2-page item** in Inbox.  
**Lane S:** `scanToFiles` returns absolute paths; “orchestrator composes with `importFiles` at integrate.”  
**Reality:**

```147:205:src/ingest/import.ts
async function importImage(...) {
  // ...
  const { itemId } = deps.repos.items.create({ folderId, type: 'receipt' })
  const { pageId } = deps.repos.pages.add({ itemId, ..., seq: 1 })
  // one file → one item, always
}
```

`importFiles([p1,p2])` → **two 1-page items**, not one 2-page item.  
`page:import` is currently a non-implementation:

```94:97:src/main/ipc.ts
'page:import': async (c, r) => {
  const res = await importFiles(c.ingest(), { paths: r.paths, targetFolderId: undefined as never })
  return { pageIds: [], jobId: res.jobId, itemIds: res.itemIds }
},
```

**No lane owns** `importImagesAsMultiPage` / create-item-then-add-pages. Lane S forbids `src/ingest/**` and `src/main/**`. Lane V is “wire modal,” not invent multi-page image ingest.

**Impact:** Acceptance #5 fails by construction.  
**Revise:** Either (a) extend contract + Lane W/V with `importFiles({ paths, asSingleItem: true })` or `pages.add` loop after first create, owned by a named lane with tests; or (b) change acceptance to “N items” (worse UX). Do not leave this as “orchestrator will figure it out.”

---

#### C2 — Job kind `'import'` + `detail.source='scan'` collides with live progress UI
**PLAN-2:** “Job progress reuses job kind `'import'` with `detail.source='scan'` — no schema migration.”  
**Reality:**

- `JobProgressEvent` has **no `detail` / `kind` / `source`** fields — only units + status + optional message.
- `App.tsx` treats **every** `job:progress` as the import indicator:

```225:235:src/ui/app/App.tsx
return on('job:progress', (e) => {
  if (e.status === 'done' || e.status === 'failed' || ...) {
    setImporting(null)
    void refresh()
  } else {
    setImporting({ total: e.totalUnits, done: e.doneUnits, failed: e.failedUnits })
  }
})
```

- Scan has separate push events (`scan:progress|done|error`), but if integrate also creates an `'import'` job for OCR (as `importFiles` always does), the status bar will show **OCR units as “importing”** and a concurrent folder import + scan will **stomp one shared `importing` state**.

**Impact:** Progress UI lies under concurrent work; `detail.source` is invisible to the renderer without contract change.  
**Revise:** Either:

1. Keep scan progress **only** on `scan:*` events (scan job id ≠ import job id); do not claim job-kind reuse for scan-phase progress; OCR after ingest is a normal import job **filtered by jobId**; or  
2. Extend `JobProgressEvent` with `kind` + optional `source` and teach App to demux; or  
3. Add real `JobKind = 'scan'` (schema allows any string in SQLite; TypeScript needs update — still no migration of rows).

“Reuse `'import'` with detail.source” without event/UI contract changes is a **paper design**.

---

#### C3 — Mid-batch “scan OK, import fails” ownership is unspecified (pressure #11)
**PLAN:** success → files born in Old + ingested; ingest failure → move to New so unprocessed stays visible.  
**Unspecified:**

| Scenario | Where do files live? | Inbox? | Watcher? |
|---|---|---|---|
| 3 pages written to Old; `importFiles` rejects page 2 (corrupt JPEG) | p1 may be DB-ingested; p2/p3? | partial | Old is **not** watched — orphan files in Old with no item |
| Import throws after item 1 of 3 | same | partial | no self-heal |
| Import rejects all; move-to-New fails mid-move | split Old/New | empty | inconsistent FS story |

Lane S `scanToFiles` atomicity is **per page**, not **per job**. Integrate has no transactional “all pages ingested or none, then place files.” Watcher only heals **New Receipts**, not orphans already in Old.

**Impact:** User can lose pages from the “filesystem is the progress indicator” model.  
**Revise:** Integrate algorithm must be spelled out, eChecking.g.:

1. preload/ Scanevent wiring pages completeness to ** and whethertmp** (or `buildSummable aWhere` om stagingits `needsReview`. dir under library).  
2. Ingest all paths as **one multi-page item** (see C1).  
3. On full success: rename/move into Old with final names.  
4. On any ingest failure: move **all** staged files to New (no partial DB commit, or compensate by trash partial item).  
5. Tests for “2 of 3 fail” and “ingest throws after first page.”

This is largely **Lane V + W**, but Lane S must not write final Old paths before integrate can roll back — **or** scanToFiles dest must be staging-only.

---

### HIGH

#### H1 — Capabilities XML variance beyond two fixtures (pressure #1)
Spec tests: **scan:**-prefixed and **pwg:**-prefixed only → same `ScanCaps`.

Real eSCL variance that will break a two-fixture parser:

| Variance | Risk |
|---|---|
| **No** prefix / default xmlns only | Common; may pass if parser is careful |
| **Mixed** prefixes in one doc | Common on MFPs |
| `InputSource` values: `Feeder` vs `Adf` vs `ADF` | Source picker wrong / empty |
| Color: `RGB24` vs `# HostileColor` vs vendor Plan Audit — KeepR Batch strings | Options 2 (CROSS- filteredLANE)

**Verdict: out → REVISE (do un not openusable |
| Resolutions as W∥S∥R **range** (Min∥T until # Hostile/Max/3 criticalStep) not discrete list | Empty plan items are audit — KeepR Batch  locked)**  
Direction `resolutions[]` |
2 Lane W  
| Duplex under is sound; several**Scope:** folder ingest + different contract/integration New/Old watcher (spec elements holes will + existing / boolean ` produceimport`/`File encodings silent deadStore` contracts)  
** | CheckboxMode:** read-only. missing UI or break Implementation files |
| Caps the New/ `dirwalk.ts` nested under unexpected / `watchFolders.ts`Old invariant under wrappers | make are **not on real disk**; `Model empty |
| Attributes useimport vs childFiles` does **.

Sourcesnot** yet implement elements | parse directory expansion or miss: [` `skipDuplicates`.

 |

**MissingPLAN-2.md`](/** tests:** unUsers/jroberts/Sourcesprefixed fixture; mixed:** [`Desktop/Internal%20Development-namespace;specs/LANE-W/Tools/KeepR/ resolution range-SPEC.md`](/Users; Fe/jroberts/DesktopPLAN-2.md), [`/Internal%eder synonymsrc/shared/ipc.ts20Development/Tools/; empty/`](/Users/jrobertminimal capsKeepR/specs/LANs/Desktop/Internal%E-W-SPEC.md; garbage20Development/Tools/Keep), [`PLAN-2.md XML →R/src/shared/`](/Users/jrobert typed `protocol` erroripc.ts), lanes/Desktop/Internal% (not throw specs W/S/R20Development/Tools/).  
**RevKeepR/PLAN-2/T, currentise:** Require.md), [`src/ingest main ≥4/import.ts`](/Users fixtures +/preload//jroberts/Desktop synonymimport/repo/Internal%20Development/ table; never implementationsTools/KeepR/src crash.

---

## Executive/ingest/import.ts), on unknown summary

| Area [`src/store/file nodesStore.ts`](/Users/ | Call; failjroberts/Desktop/ closed with |
|---|---|
| Overall productInternal%20Development/ human messageTools/KeepR/src direction | **Approve** ( when no/store/fileStore.tsNew/Old FS usable source/), schema workflow +resolution.

--- `page_ eSCL + folder

#### H2 — ADFhash_idx` ( empty status import + thumbsnon-unique), Lane- + sort S scan contractcode realism (pressure #2/filter fixes.

---

## Product)
Spec: “) |
| Contract decision: manualScannerStatus AdfEmpty → as executable imports never move

** `adf- surfaceSound.** Movingempty`.”

 | **Rev `~/DownloadsField` (or anyise** — typed reality is path outside `IpcEvents broader:

 the` ≠- POST library preload allow `ScanJobs` → drop zone) after Import **409 / list; job would be surprising503 and destructive. Sc / 500** with fault body when lifecycle foroping moves to files feeder scan is underspecified |
| Schema migration avoidance under `New empty  
- Job | **Most Receipts/` only is the created, firstly right `NextDocument` → ** right invariant** — freeform `404** with.

**Cavedetail_json` avoids CHECK zero pages (lookats the change; plan unders like successful but empty job)  
- Status-specifies:** **scan→ XML:

-Old-before-ingest** Manual ` importAdf of pathsState` *that violates W / `ScannerAd already livefState`’s invariant without a migration ( inside* `New Receiptsit’s values like/` also `Empty`, `Processing a design bug must`, `Loaded, not a schema not move (watcher` (naming one owns archival varies)  
- Some). OK) |
| Parallel W∥ devices if only move is gated onS∥R∥T | expose **Safe on empty after job “path is under disk ownership create, not newDir ****; ** on aand** callerunsafe at integrate preflight GET is the watcher,”

**Missing tests:**** unless not merely empty feeder path V owns a via location.
- Manual single scan POST failure; import without zero `skipDuplicates` of+import orchestrator and-page job ( event bridge201 the same bytes the watcher is |
| Product: then immediate processing manual no-move | ** 404) treated can stillCorrect — create **duplicate as `adf-empty keep** |
| Product: Inbox` when source items**. That failed scan → New | **=Adf, not successCorrect intent is a with 0 pages;; wrong concurrency busy write order** hole vs empty |

---

## Findings by, not a reason distinction. severity

### CRITICAL

#### to reverse  
**Revise:** Map C1 — Pre the no-move rule multipleload blocks.

---

## CRITICAL

 encodings Batch### C → `adf-2 push1 —-empty`; define events (contract is Symlink / walk  a escape +0-page ADF lie at move = end as error runtime)

`I,pc notEvents success` declares ` delete outside New; optionalscan:progress` /
** preflight GET `scan:done` /Spec gap `scan:error` / ScannerStatus when:** `walkForImportable ` sourcewatcher=Ad:activity`, but` is preload only allowsf.

---

#### H cycle-safe via real3 — Document:

```17:23:src/preload/indexpath visitedFormat JPEG-only vs multi.ts
const EVENTS =-set, but does ** new Set([
  '-page PDF scanners (pressurenot** require:
job:progress',
  #9)
Spec hardcodes1 'item:changed',
 `DocumentFormat image. every walked  'folder:changed',/jpeg` and path’s
  'ocr:page multi-` realpath staysDone',
  'libraryNextDocument` loop.

Many:opened',
])
 MF under `newDir`’s realpath, and```

AndPs:

  
2. move `wireEvents` only forwards- Prefer or/unlink `job:progress`:

 ** only after```233only** offer `application/pdf` for:238:src/main/ipc.ts
 ADF multi-page the same containment check.

**export function wireEvents(win  
- ReturnConsequence:** A symlink: BrowserWindow, ctx: **one** PDF AppContext): () => void in on {
  return ctx.jobs `New Receipts/` pointing at ` first NextDocument then~/Documents/.onProgress((e) => {
    if (!win.is 404  
- AccepttaxesDestroyed()) win.webContents.pdf` can JPEG for.send('job:progress', be “ e)
  })
}
 platen but notimported,” then on feeder```

** “

JPEGImpact:** Scan progress UI andsuccess” `-only is fine watcher-rename`/`unlink` **driven grid refresh cannot work for KeepdestR’s image pipeline **roys the user’s only even if S original/W implement perfectlyif** the device accepts outside the drop zone**.. Renderer it. That is the `on('scan: If not → worst classprogress')` throws * opaquerefused*. of user `protocol` errors on-file loss.



**Fix before common hardware parallel**Must.

**Rev wave:** requireise:**

 Lane 0 /:** refuse- Parse to V must advertised expand preload import or `DocumentFormat( move any paths)` from `EVENTS` + wire whose resolved real caps scanpath is outside `new; prefer/watcher emissionsDir`; never `image/jpeg. follow out`, fall Treat-of-tree sym back to `image/png as contractlinks for move candidates` if present completeness,; not. “ Tests if:later only symlink to polish PDF: external.”

---

 either (a) refuse file stays#### C2 — Scan write with clear message put; no-order breaks “device unlink W’s load multi outside--page PDF only — Newbearing invariant

W out.

---

### C2’s invariant ( of scope this — Tick recorrect batch,” or (b)-entrancy /, and accept PDF and concurrent ` user-facing reusetick()` (watch):

> A file existing PDF + interval)
**Spec must reach **Old import gap:** `fs Receipts** iff path for.watch` ( itsdebounced) one multi content is **in the + `setInterval` both-page item ( library call `**.tick

()`,S with/better match **no mutex /plan success acceptance #5 single- path:

> Scan pages!).flight** **born  
- Test rule.

**Consequence:**
 in Old**: caps- Same → ingest → JPEG file imported twice before on ingest fail-only; either ** caps PDF movemove to New**.

Crash completes-only →; ** wrong /duplicate items** (see Content-Type on Next partial-fail windows C3Document.

---

).
- Two moves#### H4 — Auth race on:

1. Pages written to Old / Basic / the same basename  
 PIN completely absent → lost2. Process (pressure #7)
No rename dies before `import Authorization / doubleFiles` commits  
, 401/ EX4033. mapping **DEV copy / `Orphans,name ( or2 credential)` storage in Old with no chaos item.
- Failed in types-map** → filesystem/IPC/Scan and liesPanel.

Enterprise and stability (“ some home map corrupted MFscPsanned require in by concurrent”)

That HTTP Basic ( writers.

**Must require:** is exactlyor vendor `tick()` is the class single-flight; overlapping PIN). Without calls coalesce of it lie., W discovery exists Test works to prevent.

**Fix: overlapping, capabilities (product + orchestration `tick()` does/scan fail not double-, no schema as `not-reachable`create items.

---

### migration):**/`protocol`

```
 C3 — `skip — looksDuplicates` is not concurrency#tmp-safe (and like Keep Hostile plan audit — or schema cannotR is broken KeepR Batch 2 Lane New save.

**Revise ( R  
 (staging youbatch-honest)
 **Scope:** `build)
**Facts):** DocumentOrder` → import +Files ` successGrid:**
- ` “openRow
 . →thumb renameRelPath`page.content_hash` has e + filter totals under into only `SCL only this Old (same smart filtersCREATE batch”; INDEX map page_hash_ move  
**Sources:** `specsidx` — **not UNIQUE 401//LANE-R- rules as watcher**403 → typed)
  → on importSPEC.md`, `PLAN- ([`001 code e fail:2.md`, `src/_initial.sql`](/Users.g. `auth-db/repo/items.ts/jroberts/Desktoprequired`; leave/move to New
/Internal%20Development/ ScanPanel copy`, schemaTools/KeepR/src views when probe, grid columns/db/schema/001```

Or returns that/:_UI alwaysinitial.sql)).
-. Do Current, ` existing land **not** pretend repo tests  
importImage` always ` scans in New auth is free and**Modeitems.create` + `pages later without let the watcher own:** READ-ONLY

.add` after `file IPC archive---

## VerdictStore.put` ([`import for (sim: **revise-slice**.ts`](/Users/j credentials. Optionalpler mental

robertThes lane/Desktop/Internal thin model, one code% is the: `scan path). Either right place:probe` accepts optional way:20Development/Tools `{ user for the category **never/KeepR/src/,/payment pass/ }`tax without createingest/import.ts)); existing pers sort bugs Old entries test **intentionallyisting.

---

#### H and thumbnail before DB** creates two items5 — TLS list field commit.**

--- for the same bytes-but-refuse. Core

#### C3 — ` when + many intent is sound (scan:start` jobId `skipDuplicates` is offwhitelist devices injection lifecycle is ambiguous.
- Check TLS guard, NULL vs-then-create-only (pressure #8S LAST both dirs, correlated after `put` races `importFiles` partial thumb, under job

Today `import)
`_usc ≤6 statements, filtered concurrent watcher/Files` creates kindans._tcp` listed with totals). Shipmanual/` `'import'` **after** `secure: true`, scan blockerstick`. refused with `tls-unsupported are **unders

**Consequence:** Two concurrent file processing, with `totalUnits`. Good honestypecified / imports of the same bytes for = OCR contradictory implementation → **two Inbox USB page count` (OCR details** that a items**, both; progress, not ingest hostile “success,” **bad executor could “ progress):

``` both moved** for modernpass” while56:59 (or scanners that only advertise TLS leaving product one moved:src/ingest/import.

Combined bugs.

.ts
  const job = and with HTTP---

## await deps.jobs.create(' one collision-- Pressure-testimport', ocrWork.lengtharchived). Dedonly client results

###, {
    itemIds,
up becomes: discovery 1. NULLS LAST    pageIds: ocr best shows formula (ASC andWork.map((w) =>-effort, a scanner DESC) — **PASS w.pageId),
 you not a safety with preference  })
```

Contract cannot use property.**

LAN:

- `scan:start.

**Revise:** Crash selfE-R-SPEC formula` → `{ jobId }` UI-heal only works is immediately  
- ` must distinguish for **serial correct:

```sql
CASEscan:progress| “found** retries WHEN <expr> IS NULLdone|error` keyed but TLS-.

**Must require:** at THEN 1 ELSE 0 by that idonly (unsupported least in END,  
- `scan:cancel this-process import   -- always` by version lock per ASC ( that)” from “nothing content hashnulls last marker found ( id (or  
 per- Plan: reuse kind `'import'` +USB note).” Consider)
< path `detail.source='scan'` probingexpr> [), and document

UnresolvedCOLL HTTP:

 that multi| Question port evenATE NOCASE] ASC| | Why-process multi when only `_DESC
```

 it matters |
|---|---|-instance onuscans` advertisedDo **not** flip the
| Is one library is unsupported (some dual CASE with sort jobId-stack). Full; ideally a direction (that would put created at scan start, TLS client transactional “ nulls first on DESC or only after import can be deferredinsert page).Files?

**Current but only if hash code** (` | Progress copy absent” pattern during eitems.ts` andSCL page. Test `buildOrder`):

``` error codes loop |
: parallel must513: not539 collapse| One `importFiles(..., into “no:src/db/repo job or { skip two/ (itemsscan.ts
  privateDuplicates: true })` for scanners / lifecycle + OCR import USB.”

 buildOrder(req: List identical bytes →)? | `Request): string {
    const---

#### H6 — one item.

---

###job:get`, Cancel races unders allowed = new Map<string cancel, UI badge C4 — Archive invariant, string>([
      [' |
| Does ` can liepecified (pressure #5txnDate', 'r.job:cancel` cancel: move does)
Spec: DELETE +txn_date'],
      eSCL, not re-verify against AbortSignal; test OCR, both ['vendorName', 'v library hash
? | User.name'],
      // ... “cancel mid-job →**Product hits missing paymentTypeName DELETE received, loop stops, claim:** * files cleaned.”

Missing, Cancel tax midTotal-Minor, reviewed“a file must reach Oldscan |
| Do race matrix
    Receipts if and only if scan page:

| Race | Required its content is in the library units share behavior |
|---|---|
 ])
    // ...
      parts.push(`${col”* and acceptance `done| Cancel during chunk *} ${dir} NULLSUnits` withed body | Abort LAST`)
    // ... OCR units? | Progress stream
    return `ORDER BY bar lies; no final“originals byte-identical (hash)”*.

 |

UI already ${parts.join(', ')},**Spec move:** rename rename treats **any** ` i.id DESC`
  }
,; no `.job:progress` as “```partial`

 left`NULL; page or EXDEV copythe import not counted LAST → indicator` is fine verify size |
” with| DELETE+sha of **copy on modern better no `  vs source** →jobId` filter:

-sqlite3 SQ404/410 ( unlink. That```225Lite, but:

job already gone) |:235 does **not** verify- Spec/ Still success:src/ui/app source stillUI (` cancel locally/App.tsx
  matches the **sort.ts`) |
| DELETE useEffect(()bytes that mandate network => {
    if were ingested** (`page fail | **CASE**.content_hash` / image Local for port (offline) return
    return on('job:progress store).

**Consequence:** abortability still and parity', (e) => {
 Between ingest; best with client null      if (e.status === and move the-seffort-last DELETE.
- Tie 'done' || e.status file can bebreak; don’t is **` === 'failed' || ei.status ===.id ' DESCcancelled`**;' || hang |
| Cancel replaced/truncated. Library e.status === 'partial') spec after last byte holds copy {
        setImporting( requires **`i.id ASC, A; Old getsnull)
        void refresh() copy B. Files
      } else {
        before onPage/ setImporting({ total:`**.

**ystem progress saysrename | No extra “scannedFinding e.totalUnits, done page file in” while Old: e.doneUnits, (must |
| Cancel after ≠ library. failed: e.failedUnits On pages })
      }
    }) images written, before integrate
```

Concurrent fix in implementation):** replace this is a folder import + scan OCR `NULLS | Files direct invariant + ` LAST` with CASE; cleaned or break. (ocr:requeue` will forceEXDEV hash st moved? Spec trailing mismatch protectsomp one `i.id ASC`.

 source unlink only covers scanToFiles |
 global,--- not

### 2. bar archival| Double COLLATE NOCASE +.

**Required truth cancel | Idem mixed case — **PASS lock (add.)

**Must require (potent |
| Next ( to PLAN-2images/Document inraw / S+spec),-flight +V):**

 files stored FAIL ( as-1. `current)**

Spec correctly DELETE |is):** before move, ` maps text namescan No:start` creates **sha256(source) === columns with `one** job row un content_hash immediately:COLLATE NOCASE`. Currentcaught rejection` of the ingested  
 map has no |

**Missing page (or the   `kind: 'import hash tests returned:** abort COLLATE by this'`, `detail: { mid-body; import). M source: 'scan', phase DELETE failure;. Without it, binary order putsismatch → do cancel after : 'device'|' ** `"Zebranot** move;404 endingest"` before `"apple" surface (no'|'ocr', device failed;`.

**Finding:** ImplementId, … }`. do-op).  
**Rev COLLATE onise:** spell  
2 not. unlink Device `vendor progress →. Test cancel semantics forName`, `categoryName`, **only** `scan:* this temp files explicitly.

--- `paymentTypeName`. Optional` events (not ` and for

## HIGH

job:progress` units). hardening “scan### H1 — Stability  
3. After files: treat `''` like done exist gate is only two NULL in the, import samples, call CASE not ( started.”UI ` of size `importFiles` eithercompareValues` already treats empty

---

#### H7+:mtime (  
   — 503 storms - **(partial / as null).

A)** with / backoff (pressure #4 preallocated---

### 3. writes)
** an option)
Spec: “503 Whitelist completeness vs grid `Spec:** first sight to attach → retry with backoff (maxDEFAULT_COLUMNS` — **ing record OCR ~8s total); permanentPASS with to the existing; second tick same → `busy`.”

 notes size+mtime → eligible jobIdGaps.

**H, or  
   - ****

Grid defaultsoles:**
-(B)** create a second:

- ADF page (`src/ Writers OCR job and prep oftenui/grid/columns.ts that **preallocate put`): needs

 **|longer key full size** then `ocr** than 8s on | Sort fill (commonJobId` inable? | In copy/scan scan cheap patterns): job LANE- MF size stableR whitelist? |
|---| detail (Ps  
- No `Retry fromUI follows first byte---|---|
| `row-After` honor; m scanNum` | No (time may not change every  
- No cap on job forUI disables header write → ** request modal) | Nopartial file ingested**,; OCR is rate ( then moved — correct |
 backgroundtight to Old,| `flag` |).  
4. `scan loop of **user:cancel` → 503s can Do Header original eSCL DELETE + clickable |S the scanner gone from cancel linked No — ignored)  
- No distinction New**, library has OCR (OK “job truncated/corrupt image job(s).  
5; derived (or corrupt still processing page. `Job signal rejected after” vs “device busyProgressEvent` should decode carry at) |
| `txnDate with another` | Yes | Yes — still least `kind` and client” |
| `vendorName`/or `source bad  
- Concurrent if` ( decodeTS accepts | Yes | Yes |
|-only; second ` `categoryName` | Yes still partial JPEG | Yes |
| `paymentscan:start` while no schema).
- LongTypeName` | Yes | first runs migration) so copy with — refuse Yes ( UI can filter.

 a quietWithout locallymissing in ≥?

**Missing this, S **current** map` and V tests:** 503× — rootpollMs` window → will inventN then  same.
 of incompatible semantics- No third200; 503 until “.

---

### budget sample, nopayment dead HIGH

#### H1 — minimum age, → busy”) |
| `taxTotal IPC shapes no open; exponential: mostlyMinor` | Yes | Yes-handle + sufficient (missing in current check, no jitter shape, map) with |
| `total hash-; optional Retry realMinor` | Yes | Yesstable-across-After.  
**Rev gaps

**Adequate |

Extra forise:** stated raise-two-reads API keys in surfaces budget for.

**Consequence:** Mid spec (`reviewed`, `:**

| Surface ADF (e.g.-copy ingest + | Contract |
type`) are fine; not 30–60s) successful|---|---|
| Folder grid headers or make move = **/ today configurable; minlossfile pickers | `dialog of the only full delay:pickImportFiles`, ` but match between Next originaldialog:pickImportFolder` client `sortValue`.

 |
| Import**Document if retries; documentPLAN-2 wording “ result / permanent theEVERY user grid dropped column” is lo dropdown aoser than LANE-R-busy after data budget single copy into’s | `paths New.

**Rev[] explicit map.

---

#### H8`, `skipise:** require size. **LAN — fastDuplicates`, `duplicates[]`,+mtime stableE-R list-xml-parser / XX `skippedUnsupported` |
| across ** is authoritative.**E / entity expansion (pressure Watcher status | `watcher≥2 intervals #13)
Dep Do not invent:status` (+** (3 is ` sort for dirs, observations) `rowNum`/`flag pending, failed) |
|fast-xml-parser@ **or** Scan^ discovery5.10.1`.

**Keep two full` (entity/lifecycle-file hashes** non | `scan:discover|-expansion fixes exist-grid keys match in thisprobe|capabilities|start| already useful line), across a delaycancel` + progress for defaults but:

 events |
- Capabilities/; document| Open New/Old/ residual/status XMLAPI: `createdAt`,library | ` risk; test is **un `modifiedAt`, `currencyshell:openPath` (** growingtrusted LAN input`, `folderId` (already present** file and** (mal — item 6 isdefault sort usesicious or ( not fully buggy `createdAt`).

---if feasible “missing device)  
- Default

### 4. Injection) pre”) |
| Th entityallocated size / interpolationumbs | `GridRow. processing has safety — **PASS pattern.

thumb---Rel

Path###` H |

** been a2 — PDF multi-page; clarifyGaps:**

1.: recurring empty whitelist **Preload/ CVE class in partial commitevent bridge****

Safe this package (C1). + ` patterns  
- Spec never requires secure  
2. **Import handlerskipDuplicates` + single already present:

- Column parser options does not forward `-file move
** →  

**Revise (skipDuplicates`** (contractExisting behavior `allowed.get(smust-:** `import field.column)` only; unknownhave in job exists; mainPdf` creates the item drops it):/capabilities):** keys skipped (

 (```or per88never concatenated

```ts
new:-page93 items) and XMLParser({
  process).:src/main/ipc commitsEntities: false, // critical
- Dir → ternary.ts
    'ingest:: pages **increment `'import': async (c, no DTDally** withASC' | r) =>
      import/entity expansion
  ignore **no transaction 'DESC'` only (Files(c.ingest(),Attributes**. Failurehostile {
        paths: r.: false,
  // remove on dir becomespaths,
        ...(r.targetNSFolderId === undefined ? {} DESC, not raw page *Prefixk* leaves item : { targetFolderId: string).

(: true — r.targetFolderId }),
**Gap ors) with pages `        ...(r.toInbox === vs explicit undefined1 ?.. {}k :- {1 to`, test wordingInbox: r.toInbox }), path local “row
      }),
```

-name walk goes order =   default Same” for:**

 for namespace to `rejected`.

 HTTP `POSTIf**Watcher rule tolerance
})
```

 /import` — `sort` is:** rejected** no non- `skipempty butDuplicates`, **Missing tests:** DO stays in New; success/all** keys are hostile so acceptanceCTYPE +duplicate moves **/unknown, current entity bomb #3the code falls through does/# one not hang/ to `ORDER BY i.id4 cannot be exercised PDFOOM; external via API DESC`, file**.

**With entity does without a ** naive not read filesystemnot** the real skipDuplicates (“ disk watcher default (`txnDate DESC,if; oversized path.  
3 createdAt DESC`). Click this caps. body **`scan:progress` is rejected.ing **Flag too** does put’s hash already  
“ thinIs exactly this exists → no** for UI f (UI item”):**: no total allowsxp enough?” **Yes pages (
- Retry it after partial PDF for this use**).

**Rev import seesADF unknownise:** When page-1 raster if entities off + whitelist filtering hash already in size yields zero keys, apply DB → marks limits + namespace until end), no byte/error per the same default multi ** page, no “-tolerant walkwhole PDF-sort as “ing. Not duplicate** → **no sort”,esting…” phase enoughmoves PDF then append `i if defaults to Old** while. Acceptable for v.id ASC`.

--- left library on has an incomplete multi1 if Scan

### 5. `-page item.
- `.

---

###Panel onlythumbRelPath` /splitPages: true` multi MEDIUM shows a split children /plies orphan items.



#### M1 — Chunk growing list —**Alsoed bodies multi-page origin — ** documentFAIL as / progressive JPEG (pressure # that.  
4. ** written (revise3)
Spec correctly:** PDF `No `scan)**

Contract sayscontent_hash` is:listJobs (` handle hash` / midipc.ts`): chunked + of **raster PNG**, not first page thumb Content-Length, read to-flight, split the PDF bytes ([`importPdf children resolve ** recovery stream end. Progressive JPEG is** still if modal` →origin** image.

 remounts — a complete JPEGSchema OK if after EOF truth `fileStore.put(raster.buffer, 'png single')`](/Users/j — — **no-windowroberts/Desktop/Internal special progressive children +%20Development handling own job/Tools/KeepR/** if **no** pages;:src/ingest/import.ts you bufferget.  
)). Ded/5. **`watcherup keystream fully citation is `v_item_pages`:

```519:529 before is not:activity` has counts only** — enough:src/db/schema validate “same PDF to refresh.

Gaps/001_initial.sql
 file”; crash grid; not:

- Validate recovery isCREATE VIEW v_item_ enough for “pages approximate; AS
SELECT i magicwhich false.id AS item_id, bytes file failed” toast / sharp “duplicate p.id AS page_id (status. decode” if an, p.seq, ...failed covers before rename independent
FROM item i JOIN page sticky (corrupt PNG equals a failures).  
 page raster ( p ON p.item_ → typed error,id6. = ** iNo.id HTTP
UNIONexotic routes for scan not poison ALL
SELECT c.id AS but/watcher** — import) item_id, p.id conceptually PLAN-2 claims AS page_id, p  
- Max wrong key API-checkable acceptance page.seq, ...
FROM for for size cap “file scan item + c
JOIN split_group already ingested sg”). ON

 sg.id = New drop (run**Must require:**
 c.split_group_id; `--away streamserve` must- Define AND c.split_role =)  
- Streaming to start success for multi 'child'
JOIN page p temp file the watcher and expose-page PDF as ** ON p.item_id vs full atall pages committed** (transaction = sg.origin_item_ buffer (memory or on compensating large DPI least:

   - `GET /watcher`  
   - `POST /scan color delete on/startid
           AND (sg.origin_page_id IS NULL OR p.id = sg` ( ADF failure).
- Move.origin_page_id);
mock) or)```  



LAN ** aE-R first shows**Missing tests:** chunkonce per source test hook **ed multi path** that inject-chunk bodynaive**:

 onlys when scan that```sql
FROM page p files through; Content path’s import WHERE p.item_id-Length mismatch; empty the same orchestration fully = i.id ORDER BY p 200; non  

   succeeded.
.seq LIMIT 1
 Otherwise acceptance #-image CT- skip```

That returns2; cancelDuplicates for PDF/#5 are mid-chunk ( **NULL: defineH6 for every split key screenshot-only,).

---

#### M child**. The which (prefer2 — mDNS loopback next hash of ** testability (pressure #6 Phase bullet soft 1 explicitlyoriginal PDF bytes** stored)
Injectable rejected-requires.

---

#### H or `MdnsLike` is2 — Job kind `'import split_group/` sidecar the right design'` + `sourcev_item_pages`,=,scan or` “ — collision. Cave so an / CLI /all pageats:

- Real executor can implement job:get

 `multicast-dns` on hashes match bullet| Concern | CI/ a 1, Assessment |
|---|---|
macOS can flake prior item leave children blank| Schema CHECK; tests”) — do, and still needs must use ** not move claim `' progressscan'`injected** fake? | **No**.

**Canonical — `, not single expression ( on partial matchdetail_json` is rely.
- Tests:mandate freeform; avoiding migration on OS multicast mid in revised is fine  
- Spec says spec):**

```sql
-PDF failure does |
| Collision “responder not move; retry(SELECT COALESCE(vp. with concurrent folder import | ** + querier in-processYes** —thumb_relpath, vp completes single (multicast.file_relpath)
 or stays-dns loopback)” —   UI failed without arch prefer progress FROM v_item_pagesiving incomplete work state a; **hand.

---

### H3 vp
 -rolled — vCard / no WHERE vp.item_id job:get is fine fake** that implements-page types = i.id
  ORDER by id; list `Mdns break BY vp.seq ASC
/filterLike` over skipDuplicates and  LIMIT 1)
``` crash self-heal
 real UDP

Why** multicast by kindWalk supports cannot distinguish scan this is vs folder without `vcf` in unit correct:

- Own detail.** Contacts tests  
- Electron pages for |
| CLI create/mac normal items.
 acceptance | ` **no** `pageOS **Local Network**- OriginGET /jobs/:` row permission is pages for children and **no** `contentid` returns ` (incldetail` opaque_hash` ([`import unmentioned — field. `origin_page_; **VCard`](/Users/ discovery candocument**id` pinjroberts/Desktop/ return `Internal%20Development `detail.source` and).
- Multi-page[]` with origin without pin/Tools/KeepR/ assert no explanationsrc/ingest/import.ts it → first by  

**)).

**Consequence:** In in tests `seq`.
- ZeroRevise:** Fake |
| Semantics extra statements; same md overload view alreadyns in unit tests | Current used for `has; one `'import'` jobs_images`.

Map throughgest success + move failure + next tick → ** mean **OCR units optional integration `asRelPath` when note; non-null (same as after ingest empty**, not “files being `pages.ts`). Placeholder today discovery copied.” is hard UX must Scan--coded `null` in mention firewall `mapGridRow`.

as-import/m deep`DNS/Local Networkens that overloadseedSplitReceipt` already attaches |

**Recommendation + a page on:** Keep probe- the origin and sets kindby-IP ( `origin_page_id `'probe isimport'` (` — good fixtureno migration) already specified for the required# Hostile plan audit **but — good).

---

 child-thumb — Keep#### M3 — IPv** lock typedsecond contact**; testR Batch.

 ---2

 ·###  both “success”; one move. Self-heal promised for receipts **does not apply**. Duplicate contacts forever on re-drop.

**Must require:** either exclude `vcf` from the New Receipt detail:

6, multi-s watcher (receipt6 Lane T. ( Query count vs```ts
type Importhomed, firewall (pressures-onlyThumbnail view correlated cost)

**Scope:**JobDetail = {
 #8)
Spec: drop at 10k — **  source: 'manual' PTR zone), or define a READ-PASS budget | 'folder' | 'ONLY pressure `_uscan._tcp`, non-page ded-;test note of costwatcher' | 'scan'
 collect SRV/TXT/**upe key / `**specs

`/LANE-  phase refuseA**.listT-()`SPEC today (.md` against?: 'device' | ' move No until **non liveingest' | 'ocr'
 a durableAAAA**. No-trash): **5 code contracts  itemIds?: number multi-address dedupe exists.** prepares (`computeWindow`, selection[]
  pageIds?: preference Spec currently/, grid flags number[]
  device.

Risk pretexecs —, App viewId?: string
}
```s: Iends content switcher, tokens).  
 rows

Optionally, count, byPv6-only LAN**Currency,No ` unreviewed, flags add `Job-hash ded; linkupe covers all import. Capsrc/ui/thumbsProgress-local vsable types.

---

### **≤6/**` exists yet** —Event.kind` + rout H4 — Collision naming this is a pre** remains `detailSourceable; wrong interface without-implementation plan after` (still; atomic adding audit a, SELECT not an no SQL host string execution expression ( audit.

 change with zone create / serial**notVerdict:).  
 id move
**Spec a statement).

Cost `revise-slice`** (`feAdding:** `name (2). reality

The80::1% CHECKext`, `(: rowsen ownership kind3)`, …  
 SQL already has multiple boundary and0`) `'scan'` is optional**Gap ** pure-props shape breaks:** existsper-row** correlated sub are sound. The URL polish, **not required**;-check virtualselects (OCR counts construction.

Probe if you then rename is, minization + path partially want it, racy under C conf, `has_ mitig responsive do a-layout contractatesimages2`). m; no ThumbDNS- real `002_ is one more. `blocked nets*.sql` — is under-specified in Statement ways budget that will produceO_ don’t half — good. a “ is-avoid notEXCL`/exclusive  
**Rev migrationspasses a perf create pattern.

ise:** Collect while pure budget. Accept**Consequence:** two A+ breaking tests,able for this files can bothAAAA; try invariants lane; do broken decide addresses elsewhere.

--- not “fix `r in order until at

#### H3 — Should” by N ( caps 192 schema add `'scan'` succeed+1 page2).jpg` is0×108 kind / free; one rename0 lookups”.

 panel if library ( paths table?

| loses---

### 7.or expose a fast model implements Proposal (` `needsReview` all the prose | Call vs); ` document URLunreviewed` vsENO literally.

---

## Spec |
|---|---|
|ENT`/` host br snapshot missing key data — **FAIL `jobEackEXISTeting`) for or I overPv6 current (what Lane.kind =; timeout perwrites depending on platform T is asked totals path** 'scan'` | **Not — archival address to

Smart build)

| required** for Batch.

---

#### M4 loss filter names 2 if detail.source Item | Spec — Scan or cl claim match |
 App/ is typed + progress granularity /obber inNav/|---|---|
| Own dest Old (worseIPC: | `src/ui/ if EX picker IPC ( `all |thumbs/**` only |
DEV unlinkpressure #12)
- recent| | Panel unreviewed | inbox tested |
| `library_ already `scan:progress`: | trash | needsReview`. | `ThumbPanel` purepaths` table for New/Old | **Not happened `{ jobId, page, required** — fixed dirs under library root match

`build props: on a single `Where`rows`, correctly `selectedIds confused state: 'scanning'|'done' }` — **no**-library Phase 1 applies:

`, `onSelectionChange`, path — less byte |
| Configurable likely if serial- `on `unOpenreviewedItem``, → ` progress, no New/Old locations, deadly `failed` on `i.reviewed_atthumbSrc`, `loading` | **Defer if concurrent). wire IS |
 NULL| Layout`
 |- ` CSSneeds `** — no

**Must require:** serial (UIReviewrepeat`( →auto shared-fill user moves props request; ` `NEEDS_REVIEW_, minmax(184px inSQL`

**, 1fr))`; have `failed` page a tick state — how`buildSummableWhere`shell:openPath` is does main; collision via 4:5 thumb; enough |
| Multi-library does not apply caption emit loop | **Out of scope** it?).  
- Dest `needsReview` at all with exclusive (Phase 1 non is fixed Old:**

```472; create badges or retry |
| Window | Re- Receiptsgoal) by productuse: `compute510Window`; cols on ` |

 design** —Not **no pickerEEXIST`. Test = `floor(width:src/db/repo a needed** for acceptance concurrent bas//itemscol.tsWidth)
  private wrongly avoided; don’tenames only buildSummableWhere(req invent`; ` `dialogrowHeight = card migration.** after:pickScanDest` unless: ListRequest): { where Wrongly avoided wouldH+gap`; mount & product asks mutex existsSql: string; params:lt;100 for be skipping.

---

### H5.  
- Missing:  unknown[]10k } {
 |
|    // Sel a migration ` — Depthscan cap:progress 25 + ... that
 is / keys unsupported` with ` the    if (req.smart | Restate only way toFilter: === ' 'failed'` orunreviewed') unsupported → silent “use grid selection represent only helpers {
     ; pure clauses.push(`srstuck” truth. terminal `nav2d.ts`.reviewed_at IS files
Files Freeform detail `scan:error`?  NULL`)
    }
    is fine; deeper than 25, Align or unsupported **write Scan2D arrows |
| Style // NO types, are |- needsorderReview Tokens invariant only branch;
 no```

 emojiPanel page not is states with eventsSo under **; empty in ` not.**

.

**RevNeeds state like Review**, money totals (`ise:** Addfailed`,---

#### H4 — grid |

RelevantbyCurrency`, ` `failed` to not moved, Parallel ownership fights existingunreviewedCount` via (W vs S vs event not counted as rejected surfaces summable) are or document that (unsupported V on import)

Disk for the failed pages:

``` only aggregated ownership of **unfiltered33:64 only appear via ** on `scan:error` +:**src sum/ui/grid dirsource trees panel/mablewindow seting (.tsfolder
export import** is clean:

| reduction/all).

**Consequence:** User Lane | Owns | Must function computeWindow(input:; page), while sees files not touch |
|---|---|-level granularity in New forever rows are is Window enoughInput for): v Window1Range.

 {
  // ...
  const---|
| W | `; UI---

#### M5 — flagged totalHeight = rowCount *src/ingest/**` | may Protocol implementation- main rowHeight
  const safe show empty failure modes (pressure #14, shared, scan,only. That is exactlyScroll = Math.max(0 failed)
Fast ui |
| S | `, Math.min(scrollTop the status[];-model /src/scan/**`, `-bar lie, Math.max(0, progress naive modelsrc/ui/scan/** Lane R is client foot totalHeight - viewportHeight)))` | main, shared, “Newguns supposed the to prevent = not
  const firstVisible = ingest, db spec should scanned” is right.

` Math.floor(safeScroll, app name:

 for unsupportedunreviewed` money / rowHeight)
  const |
| R | `src| Foot, but **deep visibleCount = Math.max(/db/repo/**` path is already filteredgun | Spec gap trees; | still shared, ui look1, Math.ceil( |
|---|---|
|, ingest, scan |
| needs anviewportHeight / rowHeight)) Relative `Location` like watcher on T | 201 ` |src/ui
  // start explicit regression test ( death/thumbs/**` | Resolve againstdeliver/end with over**. Soft request app, grid, kitable 3 mentionsscan... operational URL |
, shared |

** loss of visibility both
;}
 test```

```297| Absolute LocationFight.

 list** onlyMust names needs require:** surface:304: on surfaces `srcskipped/Deepui/app/Review).

**Related different host | at V` / includeApp.tsx
        product inconsistency Trust? (and in status Prefer (pre-existing, call <div className="seg mid, or document same origin out, don’t-flight if" role="tablist" |
| Missing Location; test expand someone che aria-label="View"> | ` depth ats):**

1. ** scope
 unless          {(['grid',protocol` error |
| TraWho callsiling easy slash / 'thumbnail', 'details']26.

---

### H `importFiles` after scan double `):**  
 as ViewMode[]).map6 — ScaneSCL/?** Spec says S`Filter((v) => (
           eSCL` | Normalize ( isTotals.needsReviewCount` root < frombutton key={v}Lane S) × pure ` docs TXT claim `rs` |
| role="tab" aria-scanToFiles`; watcher interaction Next “union of manualselected={view === v}
 under V comDocument without +              classNameposes. Good-specified for failure Accept={view === v ? ' — low **Confidenceforbid + missing”, partial | but `NEEDSseg_REVIEW-item seg-active** S froms
Scan Some importing or_SQL` / SQL devices' : pick 'seg-item: success writing'} `
needs`              flag onClick={() → borny |
| Connection reuse into Old **omit in Old + ingest => setView(v)}> / keep-alive dead as** extraction; failure → **move to
``` | “ undsuccess archive New** for `

Appici/fetch.”  
2. **Who currentlylow mountsConfidenceFields` ( defaults starts watcheronly pickup counted `GridPanel the watcher?** W in.

**Risk from the mapped` for both grid implements Electron |
| Concurrent `screate:**New
Receipt-s InWatcher and page of thumbnail; rows). Filter jobs on`; V/gest creates membership Details one device | Serializemain starts some and only when badge can disagree for per it and items then `view === 'details' pure low-confidence rows deviceId plugs fails →. && Lane detail != R should null`. Wiring ` in mainwatcherStatus` / files events. not is correctly “ |
| Clock moved to New → Stub forfix” this **Lane V**, watcher `skip in context filenames unless orchestr not T.

---

## today alwaysDuplicates` may archive remaining | Injected — Pressure-test resultsator expands scope returns `watching files good; timezone;

 at### 1. Window: false`.  
3. while DB/filename **Move minimum doing when is partial illegal helpers:** not make columns change on resize mid- (same chars on Windows W needs totals divergescroll — **HIGH / EX familyDEV- |
| Pl further.

Missing BLOCK**

**Whataten “ as H2).safe move-key policy the spec saysone; S must not
- Integrate is:** measure invent a second page” vs path move implementation intentional: cols user multi must call `importFiles` — extract category from width-feed with clear shared ` |/ Documenttax category **out; reuse successmoveInto single `**compute of needsWindow` on criteriaOld` under-pl-review SQL (comments before leaving row units ingest ( files only inaten ` =.

**What breaks:**W) one NextDocument |

 in Old.
- Watchitems.ts`); matches

1. **Cols and V calls---

#### Mer must ** “user it after and row6 — Securenever** scan scan,Height both assignment vs parser // OCR failure.”

---

 change on resize largemove under### 8. `include **or**, so the response Old (specSuperseded` × same `scrollTop` maps Do OK if to sort a/ differentthumb first — **PASSS
No** scan only stages strictly if and max body item. `newDir` only). watcher archives.  
 size on capabilities or thumb

**Must4. **Runtime concurrency NextDocument. A uses ` require:** shared:** watcher tick hostilev_item_pages` definition Spec never says whether to:
   - leave + manual import + scan complete `**

- Default: device can stream of “ingest → GBscrollTop` as-is success” for concurrent `importFiles`. origins into ( excluded;content jumps multi No transaction memory children listed), or  
   - re-file around.  
 scan create jobs; integration-; thumbsanchor need by item index:**Revise:** caps test: item+ citation  
     `scrollTop' max failed scan landspage; content ~1 view = floor(oldFirst in New, watcher completes-addressed store is safe–2MB; page.
- `includeSupersIndex / new; without duplicate duplicate max configurableeded: true`: origins haveCols) * newRowHeight items possible items.

---

### H (e.g.  own pages;`.

2. **` without `skip507MB —); OCR failure still moves thumbs finecomputeDuplicatesWindow`.` Watch clamps abort + (OKer sets.
- Money totals still) scroll ` only it; scan goprotocol`.

---

## for math**, but plan through `v_summable path ** not the DOM scroll Cross never_ position (receiptsames` (always-lane contractmust** too states it excludes gaps residual superseded ()Lane —.  
5. **R
Spec S alone cannot noted intentional anti query uses fix)

-double-count; sort for count vs thumb `awaitOcr: false| Gap | Owner grid/ needed`;Rel inthumb |
Path success must wave|:** = not----| contracted item3 change;---| created that audit
 or).| After a.
 widen- No R duplicate.

**Consequence ( Multi-image special that → one item | owns itben sort shrink interactions `total Wign if intentional. T required.

Height`, the browser or V + only consumes):** OCR/`---

### 9. may clamp shared. Safe API later Payment / tax joinocr_status=failed`. |
| scan; until then, nulls — **PASS**  
6. **T re→import failure

- window Payment math uses still archives to Old. Filesystem saysuses grid selection clamped `safeScroll / staging: `LEFT JOIN payment_ “in”;/windowing via publictype pt` already in | V integrate` while the spacer exports Inbox** — fine list SELECT is shorter + S if T shows broken dest; map — usually recoverable doesn’t OCR edit. That gridDir `payment, but tests matches “content.

**Parallel mustType coverName→ policy |
| job in W library∥,” **:progress dempt.name COLLATE NOCASE` “scS∥R∥T:not** “fullyux |  +rolled near NULLS- APPROVE with processed.”

0/ bottom → fewerlast CASE.
 guard**VProduct UI decision columns → more- Tax: `r.rails** — is soundtax_total_minor` after rows / + event** shape |
 if documented| page ( tallerno join); NULL C1–; otherwise:import stub | preC3 locked inS-last content users think-existing main PLAN-2 text CASE” Old bug — V + and the reverse on = fully must not rely preload.

3. **Missing that scanned on it |
| skip fix expression Resize.
- Non/OCR’dDuplicates for.

---

#### H5Observer contract**-receipts. Add one scan re / missing ` — on container Acceptance explicit acceptance line criteria machine-checkable-import | Wreceipt_data`: all r **width** + gaps

 test:| # | Criterion (in.* / (grid only | Gap |
|---|---| flight) |

--- OCR stub observes height). Without---|
| 1 | join fails

## Missing tests (beyond width observation names NULL → end `POST /import, SPEC, responsive of list` list file  still moves, cols recursive both dirs.

 item exists.

1–10)

| # never update.

---

### 10. dirs | Needs | Test | Severity---

## MEDIUM** Missing testsRequired — lock ** (FAIL W addressed

### M1 — EX vsspec dirwalk + |
|---|---|---|
DEV dest L):**

ANE-- ObserveR list API litter| 11 + scroll gaps forwards paths | ≥ / unlink container**

 **Presentwidth and; no skip2-after-verify height**.
- OnDuplicates in API extra failure
On in `repo.test.ts`: width change: split totals/ body caps hash mismatch, source |
| 2 | Droprows, mixed protected recompute layout fixtures (un metrics currency,, **prefixed (good +) mixed but ** New → Inboxpartial dest** then≤ either6 queries @ /5 + Old not ( requireda) document rangek | Requires**, patch “pixel- to be removed resolutions watcher/money running under `--stable,. On verify) | H1 |
,serve etc`; may OK +| 12 | ADF. no  
 API jump” or ` empty via POST  to assert dirsunlink(source**Absent:**409/500 fault (b) preferred)` fail → without all ** Laneitem-, not only status XML fs helper file in R testsstable** re | H2 |
| |
 **| 3– 13 | ADF job (-sortanchor category.
- Testsboth** New and Old;4 | Re-drop / 201/payment/tax,: 10k items crash self-heal | Unit next tick duplicate + immediate 404 hostile key, thumb, `-archives as tests in → `adf-empty`,, needsscrollTop` mid-list `name (2)`. W OK; end not , width 

NotReview totals).

-to-end needs serve0-page| Required900→140+watcher |
 library success | H2 |
| / loss;0 and 140| 5 | Scan  14 | Caps PDF0 recommended→900; assert2-page ADF | No-only → clear confuses “ HTTP scan mock | Status |
|---|---| window indices still refuse or PDFwhat’s in range and ` path | H3 leftmountedCards < route; mock server in |
| 15 | Next to S unit tests only budget do”Document ` unless and duplicates`.

---

### Content-Type: V wires2. Partial last row: archives application/pdf` when JPEG CI.

### M2 — Thumb keyboard down/ requested | H3 |
|
| categoryName ASC/DESC, nulls last, NOCASE, stable id | Spec required — missing |
| vs payment originalTypeName harness + taxTotalMinor bothright clamps — **MEDIUM / 16 | 401/ |
| 6 | Sort dirs | Spec required — missing BLOCK for nav ded403 → typed authupe foot category |
| Hostile key no throw2d**

/gun
Spec correctly/payment/tax | `Spec prose; ordernot-sc saysGET /items?sort fights = **annable | skip must=` — H4default** | Spec required itself:

- “left not create an item for confirm the thumbnail. |
| 17 | secure — missing |
/right **±1**, HTTP list Implementation order up/down **±cols device scan passes sort ( must be| thumb: attempt pages /**, clamped”
: putcheck → `tls-unsupported` manual- Tests: **original: (not “ null** / **** → hash ` hangsplit child =right lookup → at only row end clamps**GET) | H5 origin** | Spec required —”; “**down then thumb /items` currently |
 from missing| last |
  partial|18 row ≤ | clamps6 to Cancel queries put + may not pass mid-chunked body: last item**”

` item create. Re still | sort params!) no rename Existsvers±1` on a linear, temps |
| 7 | Thumbnail; must index **wraping order or button gone | H6 checking thumb hash keep greens to the |
| 19 | DELETE → wrong skip next row**. “ | UI-only |
| needs/create. unlessReview money totals =Right at row end clamps” fails, Easy local cancel filtered means ** setno only wrap | Spec**. Grid thumb bug required — missing |
| un’sRel `Pathnavigate asserted still completes; needsreviewed money totals = filtered setFocus` is the via ` | H6 |
|  a unit | DeliverGET /items` |
| wrong primitive20 | 503 storm test with (ablerectangular 3; ** 8 | Needs Review / distinct until budget → cellsnot in test Unreviewed | API thumb/ `busy`; Retry list** |
| Multi, full last filteroriginal hashes (-After if-page origin + row)already true exists; totals implemented ` — separateorigin_page_id today under needsReview currently | H7).

### M3 —` ` pinnav |2 Recommendedd.ts` broken ( |
| 21 | Entity Trashed items still is |
 correct| DESC, butsee H6-bomb occupy the null algorithms is-) |
| 9 | / DOCTYPE capabilities `content_hash`
 not locked.

**Requiredlast explicit | Existing → safe`skip Covered lock (exact tests | Fine fail | H8Duplicates` against if semantics |

Also verify |
| 22 | Relative any `page category DESC):**

```text
n: `GET /items` Location header resolution` row will in httpApi does | treat M re solid items |
| Empty, cols C- **dropnot** currently5 |
| 23 | map of a **tras whitelist → IPv6 host, index ihed** receipt as duplicate `sort=` URL construction and still move (if A default sort (flag ∈ [0, n)
 to Old → query params — sort acceptance mayAAA supported) columnrow = floor user cannot | M3)( |i Recommended/C), col “ |

---

## Severity roll |
| 24 | Overs = i % C
last be API-incompletebringup

| IDRow = floor.

ized Next it back” via drop | Finding((n---

#### H6 —Document abort without restore | Se Filter confusion. Product | M6-1)/C)

Leftv |
|---|: Needs Review edge; |
| 25 | **---|---|
| R1:  if document or exclude vs UnreviewedIntegrate-level** | Thumb col > 0 then i `trashed_at IS vs “ (V): SQL snippet NOT NULL` (missing info-1 else i
Right: if col < 3 naive on C-1 andcare files”

Code already i+1 < n thenful: restore `page. ** →  semanticsitem_id` i+1 else i
correct1 item; mid).

### M4 — blanksUp:    ifly separates** concepts-import failure Windows path length / reserved ** row >  names
Spec silent staging in theall split0 then i-C else model. Nested:

| ` FilterOld | C1 children**; must i
Down:  Receipts/<rel | Meaning |
, C3 |
|  mandate t>/CON|---|---|
| `26 | **UI- = i+C
      .jpg `v_item_pagesunreviewed` | `reviewedlevel** (V): concurrent if` ( tor < equivalent n split then t` or > import260 chars__
group      at join IS else NULL if` row ( <workflow job state + scan events) | **Block last canRow then n-1 don’t) |
| `needsReviewer** |
| R2   // partial last clear` | OCR fail / un fail move after | successful ` ingestbuildSummableWhereusable conf scan row: land panel | C /` → receipt must self AND on last item
      2 |

Lane S unit+image no `NEEDS_ else i
```

Tests-heal loop if rename total tests as / missing vendorREVIEW_SQL` for ` must include concrete always\| written (smart fixturesFilter= throws; filedate\|total |
| missing1–10) are aneedsReview` (plan, e. stuck in key data | **good mock says “g. ` New with spam subset of needs-protocolverify `n”;=10, CReview (not suitefailed` unless m name=4`:

| from category —** buttime-gated. the fix | key intentionally insufficient for CI) | **Block | expect excluded) |

PLAN- field credibility alreadyer** |
| R3 |
|---|---|---|
2 mixes.

---

## What cares | Tie| 3 user report is about solid Windows ( | Rightbreak `i.id ASC #6 (“pdf (do not revise |` ( not3 (row workerMissing URL-info filter”) with away end) |
|  comment in “)

- Pure JS DESC); empty whitelist → real `, noimport.ts`).9 | Rightmake filters distinguishable via default sort | Need native | T 9 |
|  reserved-name sanit Mark Reviewed.” That is ** **High6 | Down | 9WAINization or gracefultwo problems (**partial |
| R4 |/USB — failed Wh) |
| 8 honest scope  
- Injectable**:

1. **Data + no-quality filteritelist | + Down CASE | 8 ( mDNS + unlink** (`needsReview`already + COLLATE last mock HTTP server.

### M5 — Stability / missing fields) — already for payment — map growth correct implemented; must/tax/category; / deleted test strategy stay row) |
| 1 | Up | 1 |
 drop paths|  
- 0 Typed | `Scan Left | distinct from relianceErrorCode` set
No 0 |

Also: map unreviewed. eviction is  
2. **Workflow filter on SQL `NULLS rule focused a good LAST` alone | **High index → `rows** (`unreviewed`) overlapping for observations start ([i].item** (user- Inbox/ of files that disappearedextend forfacingId` for Enter;. MemoryRecent on a fresh auth)  
- TLS bug Space # → ` leak on library — Mark Reviewed is5) |
| R5toggleSelection` / `apply listed not the right product fix.

 long runs hidden  
 | Tests incompleteClick` without advancing**Bug already; stale- `probeScanner` (esp in m tree focus.

---

###  for mDNS-blocked networks3.. un Selectionreviewed range totals order, =time ( forLane failed R must  
- Temp + retries if split thumb visual order — fix):** `buildWhere path recycled rename per page  
,` **LOW applies NO `CASEneeds) | with identicalReview`, but `buildSum–MEDIUM /- ** ScanHigh** |
 mtime (rare|mablePanelWhere pure R` props6 / does | ** Cornot mostly no app).

### M6 —** —related thumb cost OK**

Grid IPC/HTTP at 10k acceptable wiring helpers money totals under Needs in do not forward `skipDuplicates Review are **`
[`library-wide**, for ≤:

```20 Sipc not filtered:

```:346-statement rule  
- Caps options.ts`](/Users/j:src/ui/grid478; don’t only from advertised capabilitiesroberts/Desktop/Internal:487/selection.ts
export function regress  
- USB:src/db/repo selectRange(
  orderedIds-empty to N+1 |%20Development//items.ts
    ifTools/KeepR/src **:Info readonly number[],
  discovery copy requirement/main/ipc.ts)** |
| R7 | (req.smartFilter ===  

---

## Pressure checklist fromIdx: number,
  / [` 'unreviewed') {
      `needsReview` vs (1 toIdx: number,
 httpApi.ts`](/Users–14)

| base?: Set<number>, low clausesConfidence.push(`sr.reviewed/jroberts/Desktop # union docs | Topic
): Set<number>_at IS NULL`)
/Internal%20Development// | Rating    }
    if (req {
  // inclusiveTools/KeepR/srcSQL drift | index Notes |
/main/httpApi.ts range ||---| on **---| orderedInfoIds**---|---|
.smartFilter === 'inbox') {
      clauses.push(`) omit|sr .1folder |_ Capsid IN / out
}
```

For `skipDuplicates` ( (SELECT id FROM folder WHERE XML variance | **HIGH of scope unless ordered a **and kind = 'inbox')`)** | Two fixtures insufficient |
| R8 | `row-major** CSS grid currently would
    }
    if ( |
| 2 | ADF filledflag` click not implement itreq.smartFilter === ' status realism |able but not from `recent') {
      clauses.push). Fine **HIGH** | Only Ad whrows[]`, visual(` for manuali.created_atfEmpty path |
| itelisted order — ** safeis** list >= ?`)
```

 default **3 | Chunked / progressive order ignore once. ShiftNo `needsReview` branchfalse**; acceptance JPEG | **MEDIUM** | R. Lane `POST /import {-range is Stream-end a3 default linear R specpaths:[dir]}` does OK; missing- already says not need it index band size/validate verify thisfallback fixed | **. Watcher must/cancel- (file — elevate call `importFiles` in-managerLow** |

---

##mid |
| 4 | to **must--process with ` What style the), not a 2 503 storms | **HIGHfix**, not “** |true`.  Lane8s plan already getsD rectangle — sameverify if V must budget tight as the right

- not “.”; no Retry-After Whitelist as

**Product copyhelp/rate |
 grid. Thatfully” enable SQL-injection boundary:** is Nav fine.

| 5 | Cancel races skipDuplicates on all label “**;Residual never | **HIGH** | HappyNeeds imports ( Review” must not interpolate column keys:**-path only be soldwould surprise if.
 JS- NULLs |
| 6 | md as “Missing info manual multi ` last **cols` ≠ CSSns loopback | **MEDIUM-copyboth column** count, directions via leading** | Injection only.” If workflows CASE (correct good keyboard; “ prefer pure — formulavisual” neighbors fake; OS test 5 today user wanted permission gap).
- Stable `i diverge from selection expects two only missing vendor |
| 7 | Auth/date/total, either rename or.id add` tie a dedicatedbreak.
 items).

### M indices / PIN | smart filter. Don’t- Thumb inline. Selection7 — Injectable collapse **HIGH** | Un itself in the ** FS into un not stays consistentsamespecified**; rows field statement (reviewed.

---

### MED fail mode |
 in watcher APIstatement with list order; the bugIUM

#### M1 —|
Tests 8 | IPv count). is keyboard/ Product 66 / multi-homelayout des
- Split: manual import and / firewall | **MEDIUM** children mustync (finding does | Probe helps 10 need rename cite origin ( 1 / **/copy; AAAA/intent not6**). move originals — **/unlink injectionTLS

RIGHT correct CALL**;**Spec SQL

Moving;- out opts must fixonly weak |
 of `~/Downloads` after only expose be single:** state| 9 | JPEG a file `now`-sourced only vs explicitly picker is surprising/`pollMs).
- Filter totals must PDF: ADF `ordered and destructive. Manual`. Without | **HIGH** | Common reflectIds = rows.map(r import = `fs M => filtered set r for.itemId) **` depsFP mismatch |
| 10 needsReview/unreviewedcopy into content`; range = or move | job store.
- Lane ownership grid-function**; injection limited `,apply EXClick` `source New Receipt=DEV and / `selectRange` on to `src/db/s = **optscan` UI collision | ** fail thoserepo indices/**` (no shared-in FSCRITICAL** | Event-once tests become/UI edits; do not/ workflow**. Keep flaky or.

Cave invent). 

---

## RequiredUI contract unat: user who plan2D rectangular brokentestable.

 drops into multi deltas (revise---

## Hunt the |
| 11 | Import--sliceselect.

--- fail matrix mid-batch | window still

 checklist### 4.  (your  keeps **CRITICAL** | Old)

10k1 mount. ** countReplace &12)

| # | Topic originals; only orphans New |- Severity |lt; 100 — **** the naive;folder drops no algorithm OutcomeHIGH / BLOCK move. Document |
| 12 | Missing (budget thumb subselect with the **` in UI (“ |
|---|-------- IPC granularityv_item_pages` vs geometryImport copies|----------|---------|
| ** expression (/picker | **)**

Mounted; New Receipt1 | Partial write vsMEDIUM** | Psingle bullet cards ≈ `(ends archives”). stability | **HIGH (icker N; - no start) * cols`

---

####H1)** | Two-/A; page failed “then (minus M2 — Product: failedtick size+ state alignment maybe scan → New — **intent slackmtime insufficient |
| 13 | fast correct, staging split on last row; preallocate-xml-parser / XX wrong**

Mental_).

group”).`compute
2./partial model thatE | **HIGH** |Window` with **Explicit fix → matches Must hard the default over:**scan ` buildSummableWhere ingest user quote-disable entities + size+move can`:5 when:

- (“what limits |
| 14 | ` destroysmartFilter === 'needs `visibleRows has / Protocol onlyReview'`, append ≈ ceil hasn’t been scanned in”): foot full original |
| 2 `(viewportItems /Repo row.HeightNE

| Locationguns | **MEDIUM– | EXDEV hash mismatch | | Meaning |
EDS)`
_-REVIEW `_windowSQL`HIGH** | Location **Spec (alias `i`Rows ≈ visibleRows|---|---|
| New, roots OK / | Not already joined).
3., CT, concurrency + MED IUM2 (*overscan safely **build |

`

With---

## Recommendation **

M1)** | Source in library yetfluidOrder**:** CASE cards### **`revise-slice ( mustor not null (see`**

** ingest unlink (testeds-last + COLLATE §6 failed) |
| Old |); dest cleanupDo not execute Lane NOCASE on text), wide Original and S as written until desktop:

 names; archived map ** ` these “because** library|payment widthType |Name cols`, `taxverify vs plan has content (w edits land:** library” missingTotalMinor`, `reviewed |
| `/→ gap) | row

1. **C1 (Cimages/` | Appi.reviewed_at`;** —H (approx)4) |
| 3-managed truth Named multi always `, | viewport | Collision races | **HIGH |

Failed i.id ASC`; if ( H900 | window-page image scan → New is coherent ingest no allowed path + ownership rows (4) **if**ov keys= remain → (W + C2** | Without success never default `txn5) | cards or V), stages single |
|---|---|---|---| with acceptance in-flight tick, collisionDate DESC, createdAt DESC`.
4. **Tests---|---|
|  Old-aligned first ( naming:** add un1280 | ~6C tests.2  
).2

. ** is notAlso defineC2** — Drop |reviewed ~ filtered290 totals safe |
| 4 |: device “ | 900; strengthen Crash between ingest and errorreuse import job | hostile ~3 move | **OK mid-ADF-key to for scan+10 if serial + with assert default order progress” or extend=13 | image partial pages → leave; optional `JobProgressEvent` ~78 hash partials |
 multi-| page192 origin0 citation | + App in staging.
5. ~9– demux; scan** | Self-heal design good **Clarify/New, not10 | ~310 phase; broken** whitelist Old | 900 uses `scan:*; don’t vs DEFAULT_ for concurrent | ~3+10` only.  
3. create halfCOLUMNS: data= (13 | **~117 **C3** — Staging– columns-130 +items** reviewed without |
C3), PDF partial ( algorithm/| type256; **H2), vCard ( user for scan→ingestnot** rowNum/flag0 | ~12H3) |
|  consent failure (tmp.
 | ~3205 | Concurrent (or/stage | 9006. **map create double- item with → OldGridRow:** wiredrop + manual | only | after ~3+10= N pages and **CRITICAL13 ` |thumb **_~156 full success; all mark partial job (C2/relpath` →** — pick |

 oneSo “-or-nothing orC3)** | Duplicate and test `thumb explicit&lt;  items; no).

---

#### M compensateRel100 cards).Path  
`4 via. ` ** unique hash3 — “Missingas” **RelfailsPath` /H1–H3 constraint |
| 6 |” open New, H6 on null common.

After Subpath / traversal/Old / config / multi–H8** — Expand | **CRITICAL widths those edits-library

| fixtures, ADF (C1)** | Sym** if over: ** Item | Status |
|---| encodingslink/approve-slice** isscan is ---|
| Open New/, Documentout-of-tree move5–8 (Old in Finder | **In appropriate.

---

##Format policy, cancel races is catastrophicgrid Decision uses

# contract** (`shell:open, secure XML;Path`); needs ** revise8-).slice

****

Required defaults ` V menuDo not lock:**

- into..` must wiring Pick execute one Lane:
 R against L be rejected |
 |
| Config library LANEANE-S-SPEC deliver  - **A| 7 | Wrong ded folders | Notables + tests.-R-SPEC as-.** Budgetup key | **HIGH ( needed for Batch  
5. **H4is: the →H2/H3, 2 |
| Multi-–H5** — Honest first **& M2)** | PDF=library | Deferred auth/TLSraster hash; vCardlt thumb; SQL will 160**; product=no hash; (or & ship hardcoded copy + typed thumb orderlt; 200) New/Old under blank split cards errors ( foot (Lane with fixed rootgun |
| 8 |even if unsupported T depends ` is OK this PDF multi-page move |OVER |

 on--- thisSCAN),

 =####  and M2 needs4 batch).

**Approve **HIGH (H2 — Import`, orReview totals will)** | One file progress UX debt stay  
  - **B.** vs only wrong unless ` (pre Keep & many pages; partial thebuildSummableWhere` islt; 100 via commit + move is narrow-existing, worsened by named ** asdynamic overscan**:  
 a protocol kernel Batch 2)

- a required change. Fix    `overscan data integrity** (discover Import indicator R = max(0, floor bomb/probe uses OCR1((–MAXR5_MO in |
| 9 | OCR/caps/job/ units, not file count (`UN theTED spec, / colsscanToFiles/Scan fails,set -Panel then) visible re **Rows-after)approve /  still move? | **OKImporting({ total: paths** C1–C if and2))` with.length })` then3 are assigned implement `MAX_MOUNTED documented overwritten by job; (H:progress OCR. = 96 otherwise CI7)** | Correct units).  
- No`.
- Tests must assert greens jobId at for “ **bytes800 scoping. will still, 1280, in library”; wrong  
- Watch fail acceptance #5 and and 1920** widther activity doesn’t field if “ Old, viewport ** drivescan into means “fully processed” |
| 10 | the same indicator800–900 Windows paths | **MEDIUM Inbox as.

Fix**,  (M4 one receipt in V:10k items — not only track active job ids a toy)** | Unspecified; move-; separate.”

---

## Suggested SPEC rowfail after ingest sticky “Import deltas (minimal |
| 11 | MissingHeight.

---

###ing files)

```text
 tests | **See 5. `thumbSrc…” from “- below** | Spec 1Reading` null placeholders — **MEDIUM–10 necessary Document text**

Spec but not sufficient |
Format: prefer…”.

---| 12 | Scan Old: letterbox + image/jpeg;

#### M5 — ` vs New | **HIGH (skip if capsDuplicates` lookupH6)** | Failure→ has `"PDF" | "Contact" | "No lack itNew is no UNIQUE image"`, no emoji, error right; partial.

`GridRow.type` on `page document ingest definitions.content_hash`

Index is `'receipt' | '-format-unsupported must exists (`page_hash_
  (dodocument' | 'contact' align with watcheridx`); not unique`. Mapping is not |

---

## Missing tests ( specified:

 (beyond claimedmulti-page PD not silently POST 1–10Fs / legitimate jpeg)

Must- same).
- XML| type / stateadd before approve image | proposedParser: processEntities::

1. **Single). D label |
|---|false; max capsedupe must-flight `tick`---|
| `contact body; namespace define** — concurrent` | `Contact` via: “ ticks → one |
| `document` |any page with this localName import ` hashPDF →` skip and (even.
- ADF per return some if not always empty: status file. `existingItemId` AdfEmpty | PDF — label.” Document  
 is2 type. **Symlink POST 4 first cue outside New** — notxx/5xx fault-match-) |
| `receipt` imported, not un | by-id. No or default0-page Next schemalinked.  
3. ** | `No image` |

Path containmentDocument when source= migration requiredAlso: `** — reject.

---

#### M6Adf.
- 503thumbSrc` null vs `..` / escaped — Anything: exponential `thumbRelPath` null realpath. requiring backoff, min  vs broken schema  
4 migration. wrongly avoided **?

Pre-|200ms image URL. Changemove hash, max wait | Needs Spec only covers matches migration? | Plan null resolver ingested content** ( return |
|---|---|---|
images).  
5. ** configurable (default 30s ADF| `detail.source='. / RecommendGrowing file** acrossscan'` | No | pure 8s platen ticks never OK:

).
- Cancel: ingested until |
| New job```ts
placeholder stable; optional AbortSignal + kind `'scanLabel(row: Pick preallocated- best'` | Yes<GridRow, 'typesize case.  
6.-effort DELETE; temps (CHECK)'>): ' **PDF: | Correct unPDF' | 'Contact' failly avoided |
| New/linked; idem | 'No image'
``` mid-rasterOld dirspotent.
- scanTo** — no

and UI | No (Files default: if move; nomkdir dest = false `thumbSrc() | OK |
| thumb staging dir duplicate archiveRelPath on GridRow |; final; no No (queryrow) == null` → placeholder; Old placement permanent- optional `ononly) | OK |
| incomplete+ is integrate’sError` → same `duplicates jobarchived OR placeholder (nice` / `skippedUnsupported.  
7. **PDF-
to  scan-Tohave;` | No (: fullFiles remains sayAPI success** pure and shape — one source file moved if required integrate never) | OK |
| Fix once; multi-page item needs imports from intact).

---

### Review totals | No6. Reuse of `computeWindow`: gap Old until commit.  
8. **v | Code / off.
- MultiCard policy only-by-one / fluid-page compose** — excluded |
| Strong height — **HIGH / BLOCK or: OUT non Old**

**-duplicating self OF- LiffGap-heal.  
9.-ANE S but:** **Parallellibrary invariant | No BLOCK Spec correctly says | ** skipING `rowHeight = cardHBehaviorDuplicates** same bytes → contract** + — gap` as for V:
 one the item **.stride  
10. not avoided **EXDEV success  importScan by schema** between** + ** rowPages;( must fix orchestrationEXDEV mismatch |

**No wronglypaths) → tops. That matches leaves avoided migration how single item source** + dest.** There `computeWindow` treats, seq **is not uniform  trusted1..n (** wrongly avoided ** row heighttests.orchestration rigor.

**Off in ingest  
11. **OCR fail**.

---

## Product-by-one:** still moves** ().
- decision challenges

| `totalHeight = rowexplicit product Decision Job:Count * (cardH | Challenge).  
12. **Depth scan: + gap)` overcounts > 25** behavior | Recommendationstart job by **one trailing asserted |
|---|---|---|
Id is scan session gap** vs.  
13. **Rejected| Manual no-move | id; import CSS Grid retry only on mtime NoneFiles change** (size serious (no gap creates separate after last row). Usually- | **Keep a fewonly change? OCR import** |
| Scan success pixels of dead job;
 define → Old | scroll —  renderer).  
14. **Scan **LOW Break must not confl failure →s Old**, documentate.
 New → watcher**↔library or use```

---

**Final no ` browCount call duplicate items (iconditional | **Rev * cardH +: `cross maxise:**-lane or mockrevise-slice`.**(0, rowCount - Old).  
15. **Empty Protocol lane 1) * gap` only after ingest commit directory** is direction importally → correct ;0 integrate items, |
| Scan fail **only if** you → New | Good no throw/ stop using ` with correct.  
16. **SameacceptancecomputeWindow` as- staging | **Keep basename/job-UIis.** with rewrite different subfolders/device Prefer keep of** preserve-variance `compute success both rel holesWindow` and accept path |
| kind paths under Old.

 one gap are import + hostileClaim of-ed source tests scan  | Over slack.

audit1–10 are directionloads OCR blockers,**allyThe right but job meaning real bug:** card not nit | ** **doKeep not kind** height is **not** ap covericks C.1–C4**; lock constant.

 /- CSS: H1–H3 detail + cancel `.

---minmax

## Implementation matrix baseline(184px, 1 |
| e risksfr)` → track width growsSCL only / (already on with container.
 disk)

- No- Thumb: USB out | `dirwalk.ts` / Honest | ** ** `watchFolders.ts`; watcherKeep**; empty4:5 of stub always-state copy required track width** → `watching: false` in |
| Mark Reviewed to height grows [`context.ts`](/Users dis with width.
- Therefore/jroberts/Desktopambiguate filters | Correct `rowHeight` must/Internal% for un be recomputed from width20Development/Tools/:

```textreviewedKeepR/src/main
cols = max(1∩inbox | **/context.ts).  
-, floor((innerWidthKeep**; don’t `importFiles` rejects + gap) / (MIN non-files (`not_COL + gap)))
 redefine Needs Review |
 a regular file`); nocolW = (innerWidth| Fixed `duplicates - (cols - 1 New/Old names` / `skippedUnsupported`) * gap) / cols under library | return fields
thumbH = colW populated Fine | * (5/4)
.  
- Default **KeepcardH = thumbH + double** |

---

- CAPTimport of sameION_H   // CAPTION_H## Parallel safety: W  bytes creates∥ S ∥ R  **two items** ( must be a locked∥ T

| Axistest 5) — | Safe constant
rowHeight = correct for manual? |
|---|---|
 card;H watcher must + gap
 not userowCount = ceil(| File ownership | that path withoutn / cols)
```

 **Yes** skip+**Hard conflict — nonlocking:** pure-overlapping trees |
.  
- `file CSS `auto-fill`| Shared contract |Store.put` is content- + independentaddress **Mosted and crash JS `floor(-safe for **ly**width/184)` **willlibrary** bytes; it — already on des does not protect ** disk; **New/Old userync** (gappreload events ignored; originals**.

---

## incomplete** |
| Compile VERDICT

### isolation **revise-slice**

 padding ignored). ExampleDo **not** approve Lane | Yes W as written for implementation: if no- one edits width 560,as-spec `src/shared/** gap 8, min. The 184:

- CSS product story` |
| Semantic coupling | **- (New/Old asScanish: `floor((560 progress,+8)/(184+8 move only after library ingest)) = 2 commit`
- Spec formula:, EXDEV verify `floor(560/184-before-unlink, crash) = 3` + move** must not be invented twice |
| Test → **keyboard self-heal via skipDuplicates isolation | Yes, manual no-move) and windowing (separate `__ is directionally lietests__` roots strong**., but the) |
| Integrate

**Required risk ( lock:**

1. ExportV) | **High written algorithm has ** pure** — singleuser `thumbLayout.ts` with-original owner for **numeric watcher destruction constants** (`MIN paths** ( start, scan_COL=184`, `symlink move→import,GAP` =, weak event bridge, import token px stability + dropdown move, PDF e, Mark Reviewed, partial + archive.g.  view switcher |

**Open) and **duplicate12/` parallel wave-item paths** (--sp-4`, `re-entrant only after:**CAPTION_H`, aspect tick, non-

1. Preload + `5/4`).
atomic skipDuplicates, `wireEvents` include Batch vCard).2. Column-2 events (or

**Minimum bar formula ** explicit to flipincludes gap to approve- V** (seeslice:**

1. Contain-owned first abovement: import commit in wave).
3. **Drive/move only real beforepaths under `newDir`. CSS from S  
2. Single-flight JS:**  
 UI work `tick` +   `gridTemplateColumns: serial per depends repeat(${cols},-file import on it).  
2. minmax(0, →verify PLAN-2 add1-hashfr))` +endum: scan staging `gap: var(--sp→move.  
3. + job-4)`  
   — Pre-move verify sourceId lifecycle + cancel do **not hash == matrix.  
3. ` ingested content hash** rely on `autoingest:import` + (for-fill` for the byte-identical HTTP import virtualized stored forward `skipDuplicates`.  

 grid (keep filesThen auto-fill only).  
4. Stronger W∥S∥R∥ if you stability gateT is fine (or documented measure DOM; V residual risk + tests height; pure remains for growing files tests cannot).).  
5. PDF all serial
4. Window item-or-nothing.

---

## Answers slice import: items to the 10 pressure tests before

1. **IPC sufficient `[start move; clear?** **Mostly***cols, min skipDuplicates semantics.  
6 for shapes;. vCard policy(n for the, end*cols **))insufficient drop zone.** for delivery`.
5. Tests  
7. Injectable (preload/: cols moveevents, for /fs for skipDuplicates wiring400, EXDEV HTTP and / fail-once tests.  
 acceptance 560 / 9008. Expand, scan job / 192 acceptance semantics0 with explicit tests as).  
2. **import expected listed above.

** + source=scan collisions integersManual no-move:**?** **Yes** **approve**.

---

### 7 on UI progress as a product decision. Accessibility and cancel.  
 / keyboard focus ring — **; ****Overallno** schemaMEDIUM**

Spec slice requires collision;:** **revise- 2D keyboard but job:get OKslice**. is if detail documented silent on:

|.  
3. **Schema Concern | Grid scan kind / paths precedent table?** **No** for Batch 2.  
4 | Th. **Manual no-moveumbs need |
|---|---|?** **Right call---|
| Focus ring.**  
5. **Failed | `box scan → New?** **Co-shadow: var(--focusherent if-ring)` / inset success accent doesn’t | Focus pre-writeed card: `var(-- Old.**  
6. **focus-ring)` |
Missing open/| Focus modelconfig/multi-lib?** | Focus Open path cell + `tab **alreadyIndex` on contracted**; config/ grid | Containermulti-lib defer `tabIndex={0}`;.  
7. **Ownership fights?** Low roving `aria during-selected` / ` parallel codedata-focused; **high on` |
| Scroll scan archive into view | `ensureVisible + import(rowIdx orchestration** at V.  
8. **Acceptance)` | Same for focused machine gaps **row**?** Watch of carder/scan/serve index/sort |
| Roles | `role/skip="row"`Duplicates. / `gridcell` |  
9. **Needs Review `role="grid"` + vs un cards asreviewed?** Plan `gridcell` or ` confuses productlistbox`/` narrativeoption` — pick one and stick; code model |
| Space is better — **fix / arrows sum | preventDefault | Mustmable needsReview**; keep not scroll Mark Reviewed for workflow the page |

Tokens.  
10. **Wrong already definely avoided migration?** ** `--focus-ring`. OmNo** —itting this is wrong thing how “keyboard avoided works in unit was **invariant tests, invisible-preserving focus scan staging in UI” ships**, not a.

---

### SQL 8. Double- filecount / superseded origins.

---

## Gate — **LOW / decision ACCEPT

| | for |
|---|---|
| **Overall direction** | T**

- `List **Approve** |
Request.includeSuperseded| **Execute` defaults false; App never as written** | **No sets it.
 — REVISE** |
- `Thumb| **MinimumPanel` only renders revise `rows` props set** | C.
- Split1 event bridge · C2 scan staging ** order · Cchildren** show3 jobId/ origin thumb via Lanecancel/progress R ` matrix · H1thumbRelPath` contract — skipDuplicates + good; HTTP/ badge stillserve hooks · H6 shows needsReview totals |
 `isSplitChild`.

| **Parallel WLane∥S∥R∥T T must ** after revise** | **Approvenot** add a** |
 “show originals| **V” control** | Rem. Documentains the risk as rely lane; must own-on-list. No revise one orchestration needed beyond story one |

I line: “ can turn thenever invent includeSuperseded.” revise set

---

### 9 into a short PLAN-2 delta patch. Fast model failure modes (colors / (still read-only draft virtualization) — **MEDIUM text) if you want that– next.HIGH**

Likely failure modes if prose is followed naively:

| Failure | Trigger |
|---|---|
| Hardcoded hex | Copying mockup hex instead of tokens |
| Mount all 10k | Skip windowing “to ship faster”; only layout unit tests run |
| Fixed `cardH=230` | Ignore fluid 1fr height → blank bands / clipped scroll |
| `auto-fill` + `floor(w/184)` | Keyboard off-by-one column |
| Import `navigateFocus` | Wrong for partial last row |
| Reimplement money | Float formatting |
| Emoji placeholders | “📄” etc. |
| Duplicate status footer | Grid already removed footer for this reason |

**Required anti-slop locks in spec:**

- CSS: only `var(--*)`; no raw `#` hex in `thumbs/**`.
- No `rows.map` full list render path when `rows.length > window`.
- Money: `import { formatMoney } from '../grid/index.ts'` (or `../grid/money.ts`).
- Selection: only exported grid helpers.
- Flag severity order must match grid `RowFlag` (needsManualEntry → `!` danger; missing/low → `?` warn; ocr pending → `…` quiet) — reimplement with a pure `flagKind(row)` test; do not import private `RowFlag`.
- Unreviewed: `inset` accent left edge, same idea as  
  `.keepr-grid-row[data-unreviewed='true']` (`inset 3px 0 0 var(--accent)`).
- Selected: accent surface + `--on-accent` text (not white).

---

### 10. Interaction with App view switcher (Lane V, not T) — **LOW / ACCEPT with note**

| Ownership | Correct? |
|---|---|
| T does not touch `src/ui/app/**` | Yes |
| V mounts `ThumbPanel` when `view === 'thumbnail'` | Yes (`PLAN-2.md` Lane V) |
| V injects `thumbSrc` from `libraryRoot` + `thumbRelPath` | Implied; should be explicit for V handoff |
| Shared `selectedIds` / `onOpenItem` → details | V wires same as grid |

**Handoff note for V (not T work):**  
`thumbSrc(row) => row.thumbRelPath ? fileURL(libraryRoot, row.thumbRelPath) : null` mirroring `pageSrc`. Until V lands, Thumbnail tab still shows grid — known.

Empty state: grid copy is:

```573:585:src/ui/grid/GridPanel.tsx
        {rows.length === 0 && !loading ? (
          <div className="keepr-grid-empty">
            <h2>No receipts here yet</h2>
            <p>
              Import scans or PDFs into the Inbox, then file them into a folder.
              ...
```

Spec ellipsis is fine; require **same h2 string** (and preferably same body) so V doesn’t get two empty-state dialects.

---

## Cross-cutting gaps (not in the 10, but hostile)

1. **No approved thumbnail mockup** in `design/` — layout is prose-only. Height of caption, badge placement, and density are improvisation-prone. Lock CAPTION_H + badge positions in the spec.
2. **`RowFlag` not exported** — intentional duplication; pure `flagKind` + tests mandatory.
3. **Loading overlay** — grid has `keepr-grid-loading`; thumbs should mirror.
4. **Home/End/PageUp/PageDown** — optional; if omitted, say so (don’t half-implement).
5. **Dependence on Lane R** for non-null thumbs — T can ship placeholders; integration acceptance needs R.

---

## Findings summary

| ID | Severity | Finding |
|---|---|---|
| T1 | **BLOCK** | `auto-fill` + `floor(width/184)` desyncs from real CSS columns (gap/padding). |
| T2 | **BLOCK** | Fluid 4:5 + 1fr means `rowHeight` must be derived from width; fixed cardH breaks windowing. |
| T3 | **BLOCK** | Mount budget &lt;100 fails at ~1920+ with default overscan; need dynamic overscan or higher budget + multi-width tests. |
| T4 | **BLOCK** | `nav2d` clamp algorithm under-specified (wrap vs clamp; partial last row). |
| T5 | **HIGH** | Resize mid-scroll: no width observer / item-stable re-anchor policy. |
| T6 | **MED** | Focus ring, roving focus, `ensureVisible`, preventDefault not specified. |
| T7 | **MED** | Placeholder `ItemType` → label map incomplete. |
| T8 | **MED** | Flag/badge semantics must be re-locked in pure tests (grid component private). |
| T9 | **LOW** | `totalHeight` trailing-gap slack if using `rowCount * (cardH+gap)`. |
| T10 | **ACCEPT** | Superseded double-count is list’s job; T pure props OK. |
| T11 | **ACCEPT** | View switcher is Lane V; props/`thumbSrc` injection are the integration contract. |

---

## Decision: **`revise-slice`**

Do **not** send this lane to an executor as-is. The pure-props boundary, reuse of `computeWindow` / selection, and “orchestrator mounts” split are good. Virtualization + responsive layout will ship wrong without numeric locks.

### Minimum revise checklist (for orchestrator → update `LANE-T-SPEC.md`)

1. **Replace auto-fill as source of truth** with JS `columnCount(width, MIN_COL, GAP)` and `grid-template-columns: repeat(cols, minmax(0, 1fr))`.
2. **Define** `layoutMetrics(width, itemCount)` → `{ cols, colW, cardH, rowHeight, rowCount, totalHeight }` using aspect 5/4 + fixed `CAPTION_H` + gap stride.
3. **Mount budget:** either dynamic overscan or raise limit; test at 800 / 1280 / 1920.
4. **Lock `nav2d` algorithm** with the table above (no wrap on left/right; partial-row down → last item).
5. **Resize:** observe width; document scroll policy (prefer item-stable).
6. **A11y:** `tabIndex`, focus ring via `--focus-ring`, `ensureVisible`, arrow/space `preventDefault`.
7. **`placeholderLabel(type)`** map + test.
8. **`flagKind(row)`** pure + test matching grid severity order; split badge; unreviewed left edge.
9. **Tokens only**; money via `formatMoney`; empty h2 `"No receipts here yet"`.
10. **Handoff one-liner for V:** when `view==='thumbnail'`, mount `ThumbPanel` with shared selection and `thumbSrc` from `libraryRoot`/`thumbRelPath`.

### What is already good (keep)

- Pure props panel; no IPC; no `app/**` ownership.
- Reuse of `computeWindow` and selection exports from `src/ui/grid/index.ts`.
- Separate `nav2d.ts` (do not reuse grid cell `navigateFocus`).
- Injected `thumbSrc` (no fs in thumbs).
- Badge/unreviewed/flag intent aligned with grid.
- Explicit “orchestrator wires switcher” → Lane V.

---

**Final call: `revise-slice`.** After the locks above land in `LANE-T-SPEC.md`, re-audit should be able to **`approve-slice`** for execution.## VERDICT: **revise**

Direction is right (New/Old as progress, eSCL-only, pure-JS scan, manual no-move, sort whitelist, thumbs). Do **not** open W∥S∥R∥T until the plan locks the items under RISKS 1–6. Specs and contract are ~80% executable; the holes will green mock tests and still fail acceptance or destroy user files.

---

## RISKS

Ordered highest first.

1. **Scan success writes Old *before* ingest (breaks W’s load-bearing invariant)**  
   Plan: success → files born in Old, then ingest; fail → move to New.  
   W’s rule: Old **iff** content is in the library.  
   **Consequence:** crash after write-to-Old, before DB commit → orphans in Old that look “scanned in” with no item. Partial multi-page import leaves mixed truth.  
   **Lock:** stage under tmp/New → full ingest success → move to Old (or always scan into New and let watcher archive). Never create Old entries pre-commit.

2. **Watcher move without path containment (symlink escape)**  
   Spec walks New and moves on success; no “realpath must stay under newDir.”  
   **Consequence:** symlink in New → `~/Documents/tax.pdf` gets imported then `rename`/`unlink` **destroys the only original outside the drop zone**. Worst-class data loss.

3. **Concurrent `tick()` / concurrent `skipDuplicates` → duplicate items**  
   `fs.watch` + interval, no single-flight; `page.content_hash` is **indexed, not UNIQUE**; check-then-create races.  
   **Consequence:** double Inbox items for one drop; two moves / collision chaos. Crash self-heal only works if serial.

4. **Multi-page scan + current `importFiles` cannot meet acceptance #5**  
   `importFiles([p1,p2])` creates **two 1-page items** today; no owned API for “N images → one multi-page receipt.” S cannot touch ingest; V is “wire,” not invent.  
   **Consequence:** acceptance #5 fails by construction unless a named ingest API lands before/with S.

5. **Job kind `'import'` + `detail.source='scan'` without event/UI demux**  
   `JobProgressEvent` has no source; App treats every `job:progress` as one global import bar; preload currently allows only a subset of push events (scan/watcher not in the allowlist in live preload).  
   **Consequence:** scan OCR and folder import stomp each other; `scan:*` / `watcher:activity` may never reach the renderer even when implemented.

6. **Weak stability gate + move = mid-copy archive**  
   Two samples of size+mtime; preallocated full-size copies; no hash-stable-across-delay.  
   **Consequence:** partial file ingested, moved to Old, New empty — user loses the full original.

7. **PDF / multi-page source: partial commit + whole-file move**  
   Existing import is incremental, non-transactional; watcher moves the **one** PDF on “success/duplicate.”  
   **Consequence:** incomplete multi-page item + PDF archived; retry may false-dedupe and move remaining junk.

8. **Thumb SQL if naive `page.item_id = i.id` blanks all split children**  
   Spec softens “maybe use split_group”; children own no pages.  
   **Consequence:** Thumbnail view shows empty cards for every split child (Lane T + R integration fail).

9. **`needsReview` money totals currently unfiltered in summable WHERE**  
   Rows filter applies; `buildSummableWhere` lacks needsReview (code today).  
   **Consequence:** status bar under Needs Review still shows whole-folder sum — the lie R is supposed to kill.

10. **eSCL field variance underspecified (auth, PDF-only ADF, ADF-empty encodings, 8s 503 budget)**  
    **Consequence:** mock suite greens; real MFPs fail as opaque `protocol` / empty discovery / busy.

11. **Manual no-move vs path-under-New**  
    If move is keyed only on path location, a manual import of a file already in New might still move (or not — underspecified).  
    **Consequence:** surprising archive of something the user thought was a normal Import.

12. **vCard in New walk + no page hash**  
    skipDuplicates self-heal does not apply.  
    **Consequence:** crash between “success” and move duplicates contacts forever.

---

## GAPS

### Spec / contract locks missing before execute
| Gap | Why |
|---|---|
| Single-flight `tick` + serial import→verify-hash→move | C2/C3 |
| realpath containment under `newDir` | Symlink loss |
| Pre-move `sha256(source) === ingested content_hash` (images) | Old ≠ library |
| Stability: ≥3 observations or dual-hash delay | Mid-copy |
| PDF/multi-page: all-or-nothing before move; dedupe key = original bytes policy | H2 |
| Named `importScanPages` / `asSingleItem` owner (W or V) | Acceptance #5 |
| Scan staging algorithm (tmp → ingest → Old) | Invariant |
| Scan jobId lifecycle + cancel matrix (device vs OCR jobs) | Progress/cancel |
| Preload `EVENTS` + `wireEvents` for `scan:*` and `watcher:activity` | Dead UI |
| `ingest:import` + HTTP forward `skipDuplicates` | Acceptance #3–4 via API |
| `--serve` starts watcher; optional scan mock hook | Machine-checkable #2/#5 |
| Thumb: **mandate** `v_item_pages` subselect only | Split cards |
| `buildOrder` CASE nulls-last + COLLATE + full whitelist; empty whitelist → default sort | Category “dead” |
| `buildSummableWhere` needsReview | Filter totals |
| T: JS column count + gap; fluid 4:5 rowHeight; nav2d table; mount budget at 1920 | Broken thumbs at real widths |
| eSCL: XML `processEntities: false`; DocumentFormat policy; ADF empty encodings; TLS-only copy | Field scanners |
| vCard policy for watcher (exclude or other dedupe) | Self-heal |
| Injectable fs for EXDEV tests | Spec tests untestable |

### Product / filter narrative
- User “missing-info” vs `needsReview` (OCR + missing key fields) vs `unreviewed` (`reviewed_at`) are **three** concepts. Plan mixes (1) and (2) with Mark Reviewed. Nav copy must not collapse them.  
- Mark Reviewed is correct for making Unreviewed/Inbox diverge; it does **not** empty Needs Review.

### Acceptance holes
- #2/#5 need watcher+scan under real app/`--serve`, not only unit mocks.  
- #8 needs SQL membership **and** filtered totals, plus screenshots.  
- #3–4 need skipDuplicates actually plumbed to import API or only watcher path documented.

---

## EXECUTOR

| Lane | Proposed | Fit | Flag |
|---|---|---|---|
| **0 / V** | orchestrator | **Correct** | Must land event bridge, staging, multi-page import API, skipDuplicates wiring **before or as first commit of** parallel wave |
| **W** | grok | OK **with hardened SPEC** | Fast model will skip containment, single-flight, pre-move hash, PDF atomicity — **mandatory review / hostile tests** |
| **S** | grok | OK for mock protocol; **risky for field eSCL** | Fast model: naive XML, JPEG-only, weak cancel/503; cannot invent multi-page ingest — **block on C1/C2** |
| **R** | grok | **Good** | Narrow; still can ship naive thumb SQL — lock `v_item_pages` in SPEC |
| **T** | grok | OK **after layout locks** | Will do `auto-fill` + `floor(w/184)`, fixed cardH, mount all 10k, emoji placeholders — **SPEC must lock metrics** |

Sonnet not required if SPECs include the revise checklist; W move safety and S cancel/XML deserve post-hoc audit either way.

---

## SPLIT

### Safe concurrent (after plan revise + contract/preload fix)
| Set | Conditions |
|---|---|
| **W ∥ R ∥ T** | Non-overlapping trees; R doesn’t need S; T only needs contract field |
| **S** | Protocol + ScanPanel + mock server only; **no** writing final Old success paths; **no** importFiles |
| **W ∥ S** | OK if S does not call import or invent second move helper; shared move lives in W |

### Must serialize
| Order | Why |
|---|---|
| **Contract addenda + preload events** → S UI that depends on `scan:*` | Dead events |
| **Multi-page image ingest API** → S acceptance #5 / V integrate | Otherwise V invents mid-flight |
| **W move helper** → V scan orchestration | One EXDEV implementation |
| **R thumbRelPath** → T visual acceptance | Placeholders only until R |
| **All libs** → **V** | Single writer for app/main wiring |

### Illegal without locks
- Parallel S that “helpfully” imports into Old on success  
- Parallel W and S both implementing move-to-Old  
- V starting before skipDuplicates + event bridge exist  

**Revised wave:**  
0 (revise contract text + preload + import API hooks) → **W ∥ R ∥ T ∥ S(protocol-only)** → **V** (scan staging + import compose + views + Mark Reviewed + watcher start).

---

## Product decisions (challenged)

### Manual imports do **not** move originals — **keep**
Moving out of Downloads after a picker is surprising and destructive. New Receipts is the **opt-in** archive workflow; Import is **copy into the content store**. Document in UI: “Import copies; files in New Receipts are archived to Old when safely in the library.”

**Tighten:** Move only when caller is the watcher (or explicit `archive: true`), not merely “path under New.” Manual import of a path under New should still **not** move unless you deliberately want Import-from-New to archive (usually no).

### Failed scan → New Receipts — **intent keep; success path revise**
Mental model that matches the user:

| Place | Meaning |
|---|---|
| New | Not safely in the library (or ingest failed) |
| Old | Original archived **because** library has the bytes |
| `images/` | App-managed truth |

Failed scan → New is coherent. **Success must not land in Old first.** Prefer: scan → staging/New → ingest → Old (or scan → New only, watcher archives). Then “failed scan in New” and “watcher crash self-heal” are the same machine.

### Reuse job kind `'import'` + `detail.source='scan'` — **keep kind, fix contract**
Avoiding a CHECK migration is fine (`detail_json` is freeform). What fails is claiming progress works without:

- typed `detail.source` / `phase`,  
- `scan:*` for device progress,  
- separate or demuxed OCR job progress,  
- cancel matrix.

No schema migration required for that.

---

## Bottom line

**Approve the product story; revise the plan/SPECs before executors.** Highest stakes: **Old-only-after-commit**, **New containment**, **single-flight watcher + serial dedupe**, **multi-page scan ingest ownership**, **preload/event + job progress demux**. After those land as written requirements (not “V will figure it out”), re-open W∥S∥R∥T with V serial.
