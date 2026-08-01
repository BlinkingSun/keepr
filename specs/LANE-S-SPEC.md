# Lane S — Scanner support: eSCL (AirScan) over the network

**Executor:** grok · **Depends on:** Lane 0 (deps + contract on disk)

## You own
```
src/scan/**       protocol client, discovery, orchestration, tests + mock server
src/ui/scan/**    ScanPanel (pure presentational component over props)
```
Do NOT touch src/main/**, src/shared/**, src/ingest/**, src/db/**, src/ui/app/**,
package.json. The orchestrator wires IPC and the modal at integration.

## Scope honesty (goes in code comments too)
eSCL is the driverless scan protocol behind Apple AirScan/Mopria — effectively
every network-capable scanner and MFP of the last decade speaks it over HTTP.
Pure JS, no drivers. USB-ONLY scanners need native ImageCaptureCore/TWAIN work
and are explicitly OUT of this lane; the UI copy must say that plainly when
discovery finds nothing, not imply the feature is broken.

Dependencies already installed by Lane 0: `multicast-dns` (discovery),
`fast-xml-parser` (capabilities/status XML). No other new deps.

## Deliverables

### 1. `src/scan/discovery.ts`
`discoverScanners(opts?: { timeoutMs?: number; mdns?: MdnsLike }): Promise<ScanDevice[]>`
- Query PTR `_uscan._tcp.local`; collect SRV/TXT/A per responder until timeout
  (default 3000ms). TXT `rs` = resource root (default `eSCL`). Dedupe by
  host:port. `_uscans._tcp` (TLS) responders: list with `secure: true` but the
  client refuses to scan them this batch (clear error) — do not silently skip.
- `MdnsLike` injected so tests run a responder + querier in-process
  (multicast-dns loopback) with zero real network.
- Also export `probeScanner(host, port, root)` — manual-IP path for networks
  that block mDNS: GET capabilities, return a ScanDevice on success.

### 2. `src/scan/capabilities.ts`
GET `http://{host}:{port}/{root}/ScannerCapabilities` → parse → `ScanCaps`
(makeModel, sources Platen/Adf, colorModes, resolutions, duplex). Namespace-
tolerant parsing (scan:, pwg:, or none — vendors differ; fixtures below prove it).

### 3. `src/scan/job.ts` — the eSCL job lifecycle
- POST `{root}/ScanJobs`, ScanSettings XML (pwg/scan 2.6): InputSource,
  ColorMode, XResolution/YResolution, DocumentFormat `image/jpeg`.
  Expect 201 + Location.
- Page loop: GET `{Location}/NextDocument` → 200: one page's bytes → callback;
  repeat. 404 → no more pages (normal end). 503 → retry with backoff (max ~8s
  total). Non-image Content-Type or empty 200 body → typed error.
- Handle BOTH chunked responses and Content-Length; read to stream end.
- `cancel()` → DELETE job URL; in-flight GET aborts via AbortSignal.
- ADF empty at start: ScannerStatus AdfEmpty → typed `ScanError('adf-empty')`
  with a human message, not a crash.
- Every failure is a typed ScanError{code, message}: not-reachable, busy,
  adf-empty, canceled, protocol, tls-unsupported.

### 4. `src/scan/scanner.ts` — orchestration
`scanToFiles(device, options: ScanOptions, io: { destDir, tmpDir, baseName, onPage })`
→ writes `Scan 2026-08-01 14.32.07 p1.jpg`… (timestamp from injected clock),
temp-write + rename per page, returns absolute paths. No DB access here — the
orchestrator composes with importFiles at integrate (spec'd: success → files
born in Old Receipts + ingested; ingest failure → files MOVED to New Receipts so
an unprocessed scan stays visible as unprocessed).

### 5. `src/ui/scan/ScanPanel.tsx` — pure props, tokens only, no emojis
Props: `{ devices, discovering, selectedId, caps, capsLoading, scanning,
pages: Array<{n, state:'scanning'|'done'|'failed'}>, error, onRefresh, onSelect,
onScan(options), onCancel, onClose }`.
- Device list (name + host) with a Refresh button; manual "Add by IP…" input.
- Options from caps only (source, color mode, dpi; duplex checkbox when
  capability present) — never offer an option the device did not advertise.
- Primary action `Scan` (accent, dark text); progress list as pages arrive;
  summary line on completion ("3 pages -> Inbox"); typed-error display with the
  honest USB note on empty discovery.
- Modal styling consistent with the existing drop-overlay (dark scrim, panel,
  --radius-lg); Escape = onClose; focus lands on the primary control on open.
- Logic (option derivation, filename preview, page-state reduction) in pure
  modules with tests; keep the component thin.

## Tests — src/scan/__tests__/ (mock server; NO real network)
1. In-process mock eSCL server (node http): serves capabilities (TWO vendor
   fixture variants: scan:-prefixed and pwg:-prefixed), accepts ScanJobs, serves
   N pages then 404, honours DELETE.
2. Capabilities parse: both fixtures → identical normalized ScanCaps.
3. 2-page job: two page callbacks, correct bytes, clean end on 404.
4. 503 then success → retried; permanent 503 → ScanError('busy').
5. Cancel mid-job → DELETE received by mock, loop stops, files cleaned.
6. ADF-empty status → typed adf-empty error.
7. Chunked response body page handled identically to Content-Length.
8. Discovery over mdns loopback: responder announces, discoverScanners returns
   the device with parsed rs path; timeout with no responder → [].
9. probeScanner against mock server → ScanDevice; against closed port →
   not-reachable.
10. scanToFiles: names, temp->rename atomicity (no .partial left), onPage order.

Run: node --experimental-strip-types --test src/scan/__tests__/*.ts

## Report
DONE|OPEN|BLOCKED / FILES / TESTS / DECISIONS / BLOCKERS — include which fixture
vendors you modeled and any protocol corners you had to guess.
