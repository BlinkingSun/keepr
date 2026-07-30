# Developing KeepR

## The one thing that will confuse you

`better-sqlite3` is a native addon, and **Node and Electron have different ABIs**.
A build for one cannot be loaded by the other:

```
NODE_MODULE_VERSION 130  <- Electron 33
NODE_MODULE_VERSION 137  <- Node 24
```

There is a single `node_modules`, so the addon is compiled for exactly one of them
at a time. Rebuild for the runtime you are about to use. Every npm script already
does this for you, so prefer the scripts over raw commands:

| Command | Rebuilds for | Does |
|---|---|---|
| `npm test` | Node | Unit tests |
| `npm run test:schema` | Node | Adversarial schema assertions |
| `npm run serve` | Node | Headless backend + test API on 17915 |
| `npm start` | Electron | Build all three bundles and open the window |
| `npm run abi:check` | — | Native + offline gate **under Electron** (the release gate) |

If you see `NODE_MODULE_VERSION`, you ran something directly instead of through a
script. `npm run rebuild:node` or `npm run rebuild:electron` fixes it; nothing is
broken.

## Layout

```
src/shared/    contract: types + IPC map. Frozen — changes ripple into every lane.
src/db/schema/ migrations, forward-only. Copied to dist/schema at build.
src/db/repo/   repositories (Lane A)          src/rules/    rules engine (Lane A)
src/ocr/       OCR + parsers (Lane B)         src/workers/  image/pdf pool (Lane B)
src/store/     content-addressed file store   src/main/     Electron main, IPC, HTTP API
src/preload/   the entire renderer surface    src/ui/       renderer
spikes/        executable proofs of the invariants
specs/         per-lane build specs           audit/        audit transcripts
```

## Three bundles, two toolchains

`scripts/build.mjs` bundles main and preload with esbuild, keeping the native
modules **external** — bundling a `.node` addon produces an app that builds and
then dies on first import. Vite builds the renderer. The migrations are copied
into `dist/schema` because they are runtime assets the bundler will not carry.

## Rules that are not style preferences

These came out of a three-cycle plan audit and a wave-2 execution audit. Each has
a test that fails if you break it.

1. **Money is integer minor units.** Never a float, never a formatted string.
2. **Never `SUM` from `receipt_data` or `item`.** Money comes from
   `v_summable_receipts`, tax from `v_summable_tax`, folder figures from
   `v_folder_totals`. A naive sum double-counts split receipts.
3. **Never list superseded split origins in a view the user reads totals from.**
   The grid does not sum — it displays, and the user does the arithmetic. Listing
   an origin beside its own children made the visible amounts add to double.
4. **Totals are always per-currency.** A blended USD+EUR figure is a lie with a
   currency symbol in front of it.
5. **Do not write `item_search_src`.** Triggers own it; writing double-fires FTS.
6. **Word bboxes are in stored-master pixel space.** Rotation is metadata-only and
   is never also baked into the file. A crop invalidates OCR and bumps the
   generation.
7. **Do not nest worker pools.** `tesseract.js` already spawns its own threads;
   one scheduler, plus a separate sharp/pdf pool.
8. **No network at runtime.** The wasm core and `eng.traineddata` are bundled.
9. **Empty-trash has a mandatory order:** children before origin. Origin-first is
   refused with an explicit message.
10. **The renderer gets no fs, no db, no raw ipcRenderer.** Only declared channels.

## Verifying

```bash
npm test              # 74 unit tests
npm run test:schema   # 64 schema assertions, 22 of them attacks
npx tsc -p .          # must stay clean
npm run serve &       # then: curl -s localhost:17915/integrity | python3 -m json.tool
```

`/integrity` is the honest health check: foreign keys, split reconciliation, tax
drift, currency consistency, relative media paths, and both FTS indexes. Backup
verification asserts these rather than comparing bytes — identical bytes are
neither necessary nor sufficient for a correct library.
