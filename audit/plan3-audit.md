I'll audit PLAN-3 against house rules and the five research questions. First I'll load the plan docs and spin up focused research on ScanSnap, text-layer geometry, and extraction risk.Found an existing plan3 audit file and the key ingest/OCR paths. Next I'll dig into geometry/Word types and spin research agents for ScanSnap and text-layer questions.I'll research how KeepR handles embedded PDF text vs tesseractI'll research ScanSnap Home/, and how pdfManagerjs scan/-ABtoBY-Yfolder text behavior item from Fujitsu docs and forumI'll research PDF.js reports, and granularity can break those text-item geometry and how check any assumptions. it maps to  KeepR notes200 DPI top-left raster already space, including in the repo. KeepR's current handling.Digging into the parser's line-building and how pdfjs shapes `getTextContent` items.I'll research text-layer quality detection for KeepR: existing project signals, open-source/commercial tool heuristics, and what separates misaligned vs junk layers.# RESEARCH Q4 — Detecting a USELESS text layer

**Scope:** KeepR receipts (1–3 pages, typically narrow thermal or letter-size scans). Context is Lane P in [`PLAN-3.md`](PLAN-3.md): extract embedded text via pdf.js `getTextContent()`, map to `Word[]`, fall back to Tesseract when the layer is useless. Current plan gates only:

> no text layer · whitespace-only · implausibly low item count

Those catch **(a)/(b)** and a slice of **(c)**. They systematically miss **(d)** (good strings, bad geometry) and many **(c)** cases (junk that still has “enough” tokens).

---

## 1. Target states (what you must separate)

| Code | State | User-visible symptom | KeepR impact |
|------|--------|----------------------|--------------|
| **(a)** | No text layer | Image-only PDF | Must OCR |
| **(b)** | Whitespace-only | Empty `extract_text` / only `\s` | Must OCR (plan already covers) |
| **(c)** | Junk / partial layer | Few garbage tokens, logo-only OCR, incomplete pass | Search + field extract wrong; may look “OK” by count |
| **(d)** | Correct words, **wrong positions** | Copy/search works; click-to-assign / highlights land off glyphs | **Silent disaster** for region assignment (acceptance #4) |
| **(e)** | Good ABBYY / ScanSnap layer | Dense, aligned, searchable | Prefer over Tesseract; skip OCR |

Commercial/open-source tools almost never separate **(c)/(d)/(e)**. They mostly answer “is there any text?”

---

## 2. What tools actually do

### OCRmyPDF (open source, most sophisticated “already OCRed?” logic)

Source of truth# RESEARCH: ` Q2: ScanSnap Home / Manager — Scan-to-Folder for KeepR

**Focus:** macOS primarypageinfo.has_text`, `; Windows noteshas_corrupt_text`, where docs visible vs invisible. differ.  
**KeepR context:** watcher at[[1]](https://apps.apple.com/sn/app/finereader-pdf-scanner-ocr/id534203582) `/

| SignalUsers/jroberts/ | How |Desktop/Internal Development/Tools Quality/KeepR/src/ingest/watchFolders.ts` awareness — 3 consecutive? |
|--------|-----|---------------- identical `(size, mtime----|
| **Ms)` observations, defaultAny ` textpollMs = operators** 4000`.

 | Content----

## 1.stream walk (` ExactTextMarker`) profile setup steps

### A | Binary. ScanSnap Home (current only |
| **Interior text) — **recommended boxes for KeepR: direct** | pdf file dump**

Official Ricminer boxes intersecting centeroh/PFU FAQ: save 75 to a folder **without**% of page (12 the ScanSnap Home main library.5% margin strip ignored) | Still UI. presence, not quality |
| **Corrupt Unicode

**mac** | First char of textOS (KeepR targetbox is U):**

1. Launch **ScanSnap Home**.
2+FFFD (`\uff. Clickfd`) when ToUnicode fails | Detects un **Scan** (top left) → Scanm window.
3. Clickappable glyphs only **Add new profile**.
4. Pick |
| **Visible a template (e vs invisible** | Render.g. Business → mode ≠ 3 vs **Save documents**).
 =5.  Set3 | Used a clear **Profile by name** (e.g `--redo-ocr` to. `KeepR New strip OCR Receipts`).
6.# RESEARCH sandwich Under **Managing options → Q1: ScanSnap e Type**, select only |
| **TaggedSCL / Driver **`Mac (Scan to PDF / structureless Network Reality Check

## file)`** tree** | Catalog Bottom-  
   -line answer

**No.** flags | Windows equivalent Across Tre: **`PC (Scan the models you to file)`**.
7ated as “born listed, **there. **Save digital, probably is no confirmed native e to** → **Browse**SCL / AirScan / `_ skip → choose Keep” |
| **Non-R’s **New Receipts**embedded CID folder fonts →** | Refuseuscan._tcp` support**. Wi‑Fi Scan Open.
 PDF/A soSnaps8. **Application Ghostscript doesn’t use a ** / destroyproprietary ScanSnap stack Send to:**** (Scan CJK text | Protect **`None (Scan toSnap Home / Managers existing file)`** (no post / Connect / layer; doesn’t-scan dialog; pure Cloud), not driver write score Englishless network to folder quality |

**Not scan.

).
9. Optional: done:****Should KeepR build ANY Detailed density, alphanumeric ScanSnap-specific network support settings for?**  
 ratio, bbox**NO** coverage, reading order, — no position–image agreement. open, stable, documented driver PDF, quality, file naming.
10. **Add** / **less network protocolSave** the Modes exists on profile; select: error these devices; supporting it before / them scanning.

**Alternate skip / force / redo would mean Home — never reverse-engineering a modes closed “text (not vendor protocol looks junk ideal (or partner, re for KeepR automationing for-OCR.”

** a commercial Scan):**

| Mode | HowImplication for | BehaviorSnap SDK), which is high risk |
|------|-----|---------- KeepR:** Do not|
| **Verify and save copy OCRmyPDF’s/cost and** (“ binary gate not equivalentScan to Folder” style). You to eSCL support need | * Application for generic = **Scan to Folderquality* gates MFPs.

** / **Verify and save;---

## Manufacturer** | Post they-scan preview; rename position then only need *presence (ap Save.* gates.

### Paperplies to the Stillless-ngx

Uses whole ScanSnap line)

 often**Confirmed ( **pdft **managed**primary docsotext length** if Type is Manage):**

1. **- (“ifNo TWAIN / ISISin-Home. |
| sufficient text,** — **Managed skip OCR” library official via `--skip-text`).** | Type = ScanSnap FAQ:  
 **`Mac (Manage Known failure:   > in ScanSnap Home)`** garb “The ScanSnap series does | Content not support TWAIN driversled existing layers are data records in SSH or ISIS drivers. ScanSnap **kept** because UI; Home must be installed as the a layer exists driver.”  
   Source. “Save to” is SSH: [PF-controlled libraryU ScanSnap FAQ –[[2]](https://docs.paperless-ngx.com/configuration/)

### TWAIN path. |

Official pdfplumber / pdfminer/ISIS](https://scansnap-faq.pf Type definitions (from / pu.ricoh.com/ ScanSnap Help —ypdf

- Emptyhc/en-us/ Edit profiles):

 extractarticles/276108586747- **`Mac/13 →- imageDoes--only orthe-ScanSnap-Series-support emptyPC (Manage in ScanSnap Home)`**-TWAIN-or layer — managed-ISIS) content data.
- Missing/ records inbroken To[[1]](http://www.sane-project.org/lists/sane-mfgs-cvs.html) the SSHUnicode → `(cid:N

2. **Cannot library.
- **)` or replacement`Mac/PC (Scan scan without ScanSnap software chars to ( fileclassic)`** — “** (images …PC garbage)./mobile are **not managed):** in ScanSnap Home …  
   > “To scan not displayed in the content data[[3]](https://discourse.devontechnologies.com/t/ocr-issues-persisting/56780)
- No built documents with the ScanSnap, record list …-in “is this OCR you need to install ScanSnap open the folder in Home useful?” on your computer or mobile Finder.” device.”  
   Source: API Explicitly for [PFU FAQ. using – Can I scan without Scan files Coordinates availableSnap Home?](https:// in ** if you digother apps/scansnap-faq.pf into charsu.ricoh.com//wordshc/en-us/services**.
- **Network folder** — direct to NAS —articles **/250574986896 (iX25089-Can-I-you** implement0/iX1600scan-documents-without- quality classinstalling-ScanSnap-); other.

### TesserHome)

act

- Pro3. **Spec sheets models save via theduces text- uniformly label PC.

--- driver asonly PDFs with

### B. ScanSnap proprietary Tr Manager (legacy::**  
   S1300i / S=3 invisible `ScanSnap Home1500 / iX500 text when (ScanSnap specific driver)` used-era)

Two  
   - Windows: Does common patterns from not support TWAIN as PDF renderer.
- Does **not Fujitsu Advanced Operation Guide +/ISIS  
   - macOS integrator** inspect: Does not support TWA pre guides:

#### BIN  

  -existing PDF layers Conf1. Direct folder.
- Confidenceirmed on iX1600 save (best scores for automation, iX1500, / apply iX500, i KeepR)

1. Right only when **X100, SV600 product-click Scanyou** re-OCR.

 specs/Snap Manager traybrochures./menu### Adobe / AB bar  
   ExampleBYY / ScanSnap ( icon → **Scan Button Settings: [iX1600produc Ric**.oh
 product2. **Uncheck** **Useers of good layers page](https://www)

 Quick- Menu AB**.
3..ricoh-usa.comBYY FineReader for/en/products/pd **Application** tab → Application ScanSnap is the engine/equipment/scanners/ = **`scansnap-ix1600 behind manyNone (Scan to File ScanSnap searchable PDFs.-scanner) + official)`**.
4. SpecSheet (“ **Save** tab → **ScanSnap driverImage saving folder** = Keep for local scanning”).[[4]](https://www.oit.va.gov/services/trm/ToolPage.aspx?tid=15508)
- TypicalR **New Receipts**. good layer traits:
5. **Save[[2]](https://www.documentsnap.com/scansnap-sv600-review/)** tab → file full-page image name format (

4. **No e + **date/time orSCL / Airinvisible** text ( custom);Scan / WSD claimsTr  leave3), proper ToUnicode, word** appear in ** manufacturer connectivityRename language file after scanning** **unchecked** for fully/. Wi handsline bboxes that track‑Fi is framed-off (checked ink, as: = post fonts Access-scan Point rename dialog Connect). Mode,
6. **File option Direct Connect Mode, ScanSnap often glyph** tab → PDF Cloud,less; ScanSnap Connect App — **/CID optionally with working **Convert to Searchable PDF** (seenot** AirPrint scanning / eSCL / Unicode maps §2).
7. WSD. **Apply** → **.
- **Metadata (OK**.  
soft prior8. Optional  
: save   iX1600: Wi‑Fi IEEE802.11a only):** as a ** Creator often like/b/g/nprofile** ( `ScanSnap Home #i/ac (2.4AddX500`;/5 GHz), USB Profile from Producer/Creator may profile dropdown / Left 3.2/2.0 —-Click Menu) mention ABBYY. for multi-profile driver Useful still “ use.

#### as a *bonus B2. QuickScanSnap specific.”

*, never Menu “Scan to Folder”

**Implication a sole1. After for KeepR:** accept. scan, Quick There Menu →[[3]](https://discourse.devontechnologies.com/t/ocr-issues-persisting/56780)

### Industry is no manufacturer-documented path **Scan to Folder**.
2. Preview window for a third: rename /-party mac, choose researchOS app to drive destination, optional pattern for ScanSnap “ garbage OCR over the networkstate path in e-mail strings like a generic”.
3. Click **

Without eSCL device.

 re-OCR,Save** → file written---

## Per-model to chosen / grouped practical filters used in pipelines folder.

This is interactive and **worse findings for

### Group A — Modern Wi‑Fi desktop ADF:

- Min a: **iX length vs page watcher** (see1600, iX150 size (“0, iX1300 §5if text <** (same protocol race notes N chars).

---

##  stack)

| Question for multi | Finding2. Searchable PDF (-page, | Confidence |
|---|---|---|
|OCR) — DEFAULT fail or OPT-IN?

| **1. Protocols”).
- High Product** | **USB non-alphanumeric ratio | Setting** + / encoding location **Wi‑Fi** ( noise.
- Dictionary | Default for folderinfrastructure / word-save +-shape direct/ profiles | Confidence |
ad filters‑hoc).|---------|------------------| **Proprietary Scan (con-----------------------------------|------------Snap driversonant runs|
| **ScanSnap Home/app, no** | PDF ** only.** No T vowels, rareOption** → **`WAIN char[Convert to/ISIS. classes Searchable PDF]`** No manufacturer).
- Confidence claim checkbox | **OPT-IN only of eSCL, WSD** — FAQ when re-, or ICA language. No Ethernetrunning OCR. is “select on the checkbox”; these models. | ** YouConfirmed** |
| **[[5]](https://github.com/paperless-ngx/paperless-ngx/discussions/12344)

NoTube/2. mac mainstreamofficialOS Image Capture (ICA)** tool solves | **Does walk **( not appear as a nativethroughs showd)** without geometry enabling it and ICA/Image analysis Capture scanner.** Vendor accepting or requires a visual a “may ScanSnap Home/ check.

---

##  take a long time afterManager. Community3. Signal catalog scan” warning | ** reports ( (what actuallye.g. iHigh** |
| **Scan separates aX500 / olderSnap Manager** | **–e)

Assume ScanSnap)File option** tab → ** pdf.js ` thatConvert to / intogetTextContent()` items: Image Capture does not see them. No ` Searchable PDF** | ICAstr`, `transform` **OPT-IN** — driver listed [a,b,c,d on ScanSnap download manuals note OCR makes scanning take longer *,e,f], `width`, `height`, ` pages. | **Confirmed for product line; Imageif turned Capture absencefontName`, ` on*; integrator guides stronglyhasEOL`, instruct optional `dir`. Page supported** users to ** size |
| **3. Scheck** the box | fromANE** | **Yes **High** |
| ** (ABBYY** viewportUSB only)** via (points | Used `sane-fujitsu`.). Raster stored at 200 DPI for Status **Good** for all three. heavily for **Scan to Word/Excel/PowerPoint** (Fine ExplicitReader for KeepR.

 Scan note:Snap **).“ Search### A. PresenceWiFi not supported.”**able-PDF / count OCR | **Confirmed** (plan |
| **4. in Home is eSCL / AirScan / already has presented)

| Signal as native `_uscan._tcp`** | **None confirmed | Separ **Convert to.** Not inates | Notes |
 Searchable PDF**, [|--------|-----------|-------- not as|
| Item count = “ABBYY profile 0 | (a)” | | Also Do rare **not**sane-airscan tested device list](https://github.com/alexpevzner/sane-airscan). SANE assume ABBYY always marks empty Content WiFi runs on every as unsupported ( |
| After PDF folder trim,USB save | **Medium– SCSI-overHigh** |

**Constraints total-USB protocol only). | chars = 0 | ( (Home **Confirmed absence of evidenceb) | Catch):**# RESEARCH

- Search Q5: Embedded; strong `\able PDF only whenu00 negative PDF signal text vs tuned document type is treated** |

**Sa0` / soft tesseract path

 as **Documents** (alsoANE details** hyphen listed ([sane-project device## Bottom only |
 line

**Overall| Item count  risk: HIGH≪ expected density** if Lane for Business Cards/Receipts in PDF options; list](http://www.sane-project.org/lists/sane-mfgs-cvs.html)): | (c) partial P maps `getTextContent not Photos

| Model | Interface listed | See()` items →).
- Network | USB ID | `Word[]` na density-folder Type Statusively and trusts them formula | Comment: docs with fixed high confidence below & |

### B. String |
|---|---|---|---|---|
| iX160.

lt; 500 mm →0 | USB WiFi | quality (cheap, highThe receipt precision for junk searchable if parser was `0x04c5 enabled)

| Signal | Separ/0x1632` calibrated on **tesseract; long pages ≥ates | Notes |
|--------|----------- | Good | Wi word tokens Fi not500 supported mm may |
| ** i|--------|
| Al** (trimmedX1500 | USB Wiskipphanumeric ratio | (, spaceFi | `0x04** OCR oncc)5 garbage/0x159- device pathseparated words,f` | Good | Wi real.
- OCR runsFi not supported |
| i as  | `alX1300 | USB Wi0–1 conf a **post-scan processFi | `0x04num**; FAQ / max(1idences). pdfc5/0x162, printable: do notcjs` items | Good | WiFi not supported |

`s shut down)` |
 are **not** wordsane-fujitsu` man page| Letter PC: they are ** also ratio among before searchableglyph alnum | PDF creation completes.-run chunks (c) | Binary That implies states globally: **“Network interfaces are** not whose supported on any scanner model OCR blobs finishes.”**  
Source size depends, **: [before**sane the- finalfujitsu usable on how the PDF writer( PDF is “ barcodes placed text5)](https://mandone,” not mis operators..archlinux.org/man that the destination-/sane-fujitsu. ABBYY/ file is necessarilyOCR’d as symbols5.en)

---ScanSnap searchable streamed |
| Unique token PDFs often place

### Group B — Older incomplete ratio | (c Wi‑Fi desktop ADF text for) | Extreme **:visual **iX500** (see §

| Question | Finding | repetition = alignment**, which is5).

**KeepR Confidence |
|---|---|---| broken exactly the regime OCR where pdfjs inserts
| **1. Protocols** | ** implication:** Folder profilesUSB + Wi‑Fi**, do |
| Replacement / cid **synthetic proprietary ScanSnap driver **not** guarantee patterns spaces**, splits. Specs: searchable PDFs. | (c) corrupt items “Does not support TWA KeepR’s own map | `\uff per glyphIN/ISIS”fd`, `( OCR path remains/clustercid:\ necessary (Windows),, and produces “Does not support TWAd+) unless stringsIN” (Mac). | the user ** the regex **Confirmed** ([`, lone high- stackoptsprivateiX500 brochure in** on- was](https://www. the Scanpfu.ricoh.com not traineduseSnap profile |
.

| Dict---

##/global/scanners/ on / receipt.

The 3. Output naming conventionsdownloads/v5/Scan lexicon plan’s feasibility / templates

### Scan hitSnap_iX500_Snap Home

Depends noteBrochure_07 rate | (c) (“ on24 **Managing items options…_EN01_201712 vs (e) | TOTAL `TOTAL  →.pdf)) |
| **2/TAX125.01` recovered”) Type**:

| Type |. ICA //$ Naming is necessary Image Capture** | **No UI | Typical/\ but **not sufficient** if.** Apple Communityd{1 behavior |
|------ that PDF was: Image Capture does,3}\ cupsfilter-like not recognize iX500|-----------.\d{2}/date (run|------------------|
|. | **Confirmed ( shapes **Manage in ScanSnap Home-level)user/** | **Title** tabprimary community rather than ScanSnap ABBY — receipt-specific gold | “TitleY (often glyph-position |
| Mean tokened).

---

##)** |
| **3. SANE** | **Yes (USB)** — is generated automatically” from document text/date ( ` lengthfujitsu | (c) | 1. How pdfjsOCR-ish`, USB `0x04 groups ` All title extractc5/0x132TextItem`s

 ); orb`, **Good**,1From the- bundledchar fragments “Use scanned date”; “WiFi not supported. or one `pdfjs- date format configurable ( Hardware only scans in color…”dist` worker (`get giant blob |

e.g. `yyyy | **ConfirmedTextContent` path)### C. Geometry /** |
| **4._MM and the public layout (required `TextItem` eSCL** | **No_dd`). Title for (d)) native eSCL.** Note ≠ shape::

| [Air SignalS | Separane issue always filesystem #45](https://ates | Notes |
|--------|----------- name ingithub.com/SimulP|--------|
| **B the same wayiscator/AirSaneBox as Scan

| Field area/ /issues/45) discusses | Meaning |
|--------|---------|-to-file. |
 wrapping page an area**
| `str` || **Scan to file** (“coverage iX500 Accum | **File name** tab”) | (c) **ulatedvia glyph unicode | **Customize (not sparse, some (d) | Good “ OCR coversa word SANE USB** as an **eSCL server** — file names** + optional **Serial number** (default **3 a band”) |
| `transform that is **host digits**).` of | content ,- Exampleside: emulation prefix6-matrix not 0. `Book**, not device e;1% and` → `Book001.pdfSCL. | `[ not 100`, `Book002.pdf` **Confirmed:4],[% as… Serial native5]` = origin one box numbers **require = in PDF |
| **Unique** Scan user space |
| `width no** |

--- (-to-file Type.` / `height` |

### Group C — Portablex,y) positions |
| **Verify Wi‑Fi: Run** | ** / **iX100**

 extent in device space |
(d)** | All post| Question | Finding | Confidence tokens| ` at onehasEOL` |-scan dialog** | User |
|---|---|---|
 can rename in Synthetic point| **1. Protocols** end **Specify a title** / / same save dialog | **USB -of-line after baseline → identity a2 dump | large |
. Last vertical|0 ** +Non Wi‑-mile-Fizero** width (/IEEE802 jump |
| `fontName override.11b/g/`height** | | Internal ** |

FAQ style key |

**Grouping(d)** | Zero widthn, 2.4 GHz; AP or height rules for file names applies ( +not Direct with equally to fixed word/ Connect). Driver non-empty str Mac |
line granularity| **):**Scale

: ScanSnap specific (explicit;1 no. Glyph sanity note). TWAIN/ISISs** from (`

### ScanSnap Manager. | **Confirmed** ([ `T|a

Saveij` /|`, `|d tab file `XTJ`100 / specs related]|` on show-text ops(https://www.pf transform ≈ font size) name formats (official naming are **u.ricoh.com/ | **accumulated into a(d)** FAQ |): Identity

| Template | Example |
|----------|---------|global/scanners/scans run** until a flushnap/ix100/))
| `yyyy_MM matrix.
_ |
|dd **_2HH._ ICAmm dump:2. **Flush**** | **No_ss` | `201 scale happens** (same on large4_02_26_ horizontal ~1pt or absurd |
 gaps,| proprietary17 stack **)._Y |01- **_monotonicConfirmed43 reading.pdf` |
| `yyyy (-productMM-dd-HH-mm-ss` | ` large vertical shifts line)** |
| **3 order** | (2014-02-26 (`VERTICAL_SHIFT_RATIOd), multi. SANE** | **-17-01-43-`),col negative FNYes (USB)** — `.pdf` |
| `yyyy advances, | Sortfujitsu`, `0x04MMddHHmmss font changes by y descc5/0x13` | `201402261, x, explicitf4`, Good,70143.pdf` |
|; large line moves **“ fraction **Custom File that Name** |WiFi not supported.”** of consecutive e look | like EO **Confirmed** |
| y increases.g. `Scan001 **4. eSCL**Ls, etc.
3. (.pdf` (prefix | **No confirmed **TruePDF + 1–6 digit support PDF y-up) serial) |

Optional whitespace glyphs** often.** | **Confirmed absence: **Rename is bad for **do not**** |

---

### Group single become items: file after scanning** opens D — USB-only they advance the text compact ADF a dialog for a matrix and only affect meaningful: **S1300i-column receipts |
| **Line clustering whether** | ( name before**

| Question | Finding final pdf | Confidence |
|---|---|js later ** save.

**e) vs (---|
| **1.KeepR noteinserts**d) | Words Protocols** | **USB only:** Prefer ** a space.
4. ** share discretetimestampSynthetic** spaces (:**no Wi y-bands or
   - **In‑Fi on this model (~ serial-run space**). Proprietary ScanSnap driverline height); if gap is in. | ~` pure scatter or auto-names** with **Confirmed** (SANE lists no rename USB0 only.102– one band0.6 × = bad; product dialog so files font |
|Size **`Overlap / (`SPACE appear complete is without_IN_FLOW_*`) USB sheet stacking user interaction → `** | (d)fed) |
.

---

## 4 dualstr.push(" ")` inside| **2. ICA the current item-OCR. CRITICAL —** | **No**.
   - **Separate space Does SSH | Many near (ScanSnap software keep- managingidentical bboxes ( item** `{ required). Older filesre str: " S1300: after save-OCR without " }` users? strip) |
 if the gap is report Preview/ KeepR New| **Horizontal span larger (`pushWhitespace`).Image Capture cannot use → Old** | (
5. **` move?

### Official answer it;c)/(hasEOL`** is set Fujitsu: **itd) | On depends entirely software works. | **Confirmed when vertical a receipt, text advance exceeds ~ on Type** patternitem height (not should span a large fraction of the *content

From ScanSnap Help — **Making Files** |
| **3. SANE** | **Yes from** —* width, not Manageable** and `\ a  different **Editn5pt` in the backend: **` profiles**:

| strip PDF |

).###
6.sane-epjitsu Profile Default D path. Font`**, USB `0x Type | Managed / runs encoding ** structure`04c5/0x asnormalizeUnicode`** unless

| Signal | Separ128d`, Good; needs `disableNormalization: true`.
 contentates | data record Notes |
?|-------- ||----------- Keep|--------|
| Font names `Identity-H`7. Gran / `Identity-Vularity observedR moves New → Old after ingest? |
|-------------- firmware `1300i_0D12.nal`. | **` + workingConfirmed** |
| **4 in| the----------------------------------|. eSCL** | ** Unicode | Neutral wild spans-------------------------------------- |N Common/A / No **per|
| **`Mac/ for CID** (no network-character itemsPC (Scan to file)` OCR stack**, multi** | **No** —; **not** for-char runs junk by itself |
| Identity “not managed…, multi driver + un not displayed in content data record-word runs, and rareless scan). | **Confirmedmappable / cid list” | **Clean hand near** |

---

### Group | (-lineoff** — Keep E — Overhead USBc) | Broken C chunks —R: ** canSV600**

Map |
| Real all rename/move system| Question | Finding | Confidence legitimate fonts (Helvetica freely |
| ** |
|---|---|---|
 for different|`Mac **1. Protocols**, Arial) with PDF producers visible text | Born |/ **PC (USBManage only** (.-digital | Stillno Wi‑Fi). Scan in ScanSnap Home)`**

** **usable** for KeepRImplication for KeepR:** fields mapping each |
| UnknownSnap | specific ** driverYes;** — no library item → / empty font entry points at file path | TWAIN/ISIS. | **Confirmed** ([SV one `Word **Break600 specs]Name | Soft(https://www.scanss SSH` is ** | Weak signalnapit.com/en-not** “t** — broken |

**gb/products/scansnapesseract-equivalent.” thumbnailDo not reject- / “svfile600);

--- Identity-H.** Ricoh page:

## 2. AB ABBYY/ has been removedBYY / ScanSnap searchable USB) or renamed outside |
| **2. ICA PDF vs cupsfilter testTesseract sandwich ScanSnap Home layers often use glyph** | **No** | PDF

**” |
| **Networkless/CIDTypical folder** (direct **Confirmed (product searchable) | Not fonts. Reject-OCR line)** |
| **3 managed as only when Unicode PDF (. SANE** | ** PC content data |AB extractionUnsupported fails**.

 —### E. CleanBYY, USB `0x for PC “text under image”):**

- Invisible text positioned Metadata (low precision, high recall as * to match the scanprior*)

| Producer04c5/0x128e`; note also library; different product path.
- Often / Creator contains many | Soft |

**When managed**, second VID `0x13ba`; small meaning Ric “Will require some gymnastics to support.”oh FAQ is text |
|----------------------------|-------------- | **Confirmed unsupported explicit:  
 operators (|
| `Scan** |
| **4.IfwordSnap`, `ABBYY you ** eSCL** | **No`, `FineReader` |move-level / delete / rename** or ** Likely good (** | **Confirmed** |

---

## Cross-checkscharacter/e) — still managed: eSCL / AirScan validate device geometry files in Findercluster/Explorer,- |
| `oclevel SSH**),rm listsyp

df|`, Source ` |t ScanSnap listed shows:

> * with **explicitesseract`, `pdf? |
|---|---|
“The file has been removedsandwich glyph| [ or renamed by the operator outside` | OCR advancessane-airscan compatibility** rather layer exists; quality varies than space |
| `Adobe Acrobat characters.
- Good table](https://github.com/alexpevzner ScanSnap home software and cannot be located by ScanSnap home.”*

Recovery is: for selection` + put the file/sane-airscan) OCR | | **No/search; ** **back ScanSnap models.** Often goodhostile**** under Lists Brother, Canon,; Clear to naive text the original path andScan is HP, Epson, extraction (classic ** Ricoh **MF special ( “spacesUpdate the selected folder** —Ps**, Xerox inside words” classvectorized glyphs) |
| Empty of bugs). or delete the broken content data record. SSH, etc. — not ScanSnap personal scanners. |
| Manufacturer Scan

**cupsfilterSnap specs | does **not** automatically / phone camera apps | Often ( / simple re-create a **No** ea) or poor digital healthySCL ( /c Air) |

Scan / WNever PDFs:** library entry for acceptSD / AirPrint scanning

- Longer ` solely on language |
| STj` strings the file metadata; neverANE fujitsu, real in its/ space characters, new location; it tracks fewer items reject solely on missing metadata.

### F. Toepjitsu | USB the old.
- Cl protocolUnicode / ActualText

| path. only; **explicitoser to “word or Signal | Separ “WiFi not phrase supported” / “Network interfaces” items — are

 notNAS supported”**ates |
|--------|-----------|
| Extract matches the planed FAQ reinforces the |
| M’s 24- stropria / Appleitem recovery same rule:

 is sensible anecd> *“When English AirPrint scan you manage images in ScanSnap lists | No Scanote more easily/digitsSnap hits in Home, they will **.

**Severity | Working relevantnot be displayed correctly ToUnicode |
: MED** if you change file names ( primary| Systematic or delete files… If you materialscalibration `\ufffd do not want images to searched invalid` / cid be managed… select **ation) / |

**Do | Corrupt map → HIGH if production[PC (Scan to file not treat confuse as:** useless

 is only ScanSnap.**

Do (force OCR) |
| ActualText present-)] ****Ric foroh [Type/Fujitsu].”*

**MacPower not accept fiUsers / Hazel | Rare on Lane-series** business community:** receipts; ignore scanners (TWAIN P on Do/ISIS, sometimes for v1 |

pdf not rearrange network e a cupsfilter fixture aloneSCL.js already/W the managed. ABSD on enterprise applies SSH folder outsideBYY and ToUnicode when models) ≠ cupsfilter can the app; if **ScanSnap** both be “searchable PD mapping; if you want external automation, use **Scan `str`Fs” and still to file** / consumer line.
- **AirSane / host differ enough looks good eSCL non-managed save, the map bridge** ( destinations. workedLinux. You machine usually speaks to change item count by an

### KeepR don’t need to order of magnitude and space e insertion parse C recommendation ( behavior.

---

## 3. Line-grouping assumptionsMaps yourself.

### G. ReSCLconfidence: *to ***High**) macOS using that break

-OCR sample

| Goal USB SParser path (expensive, | SettingANE underneath when highest precision) ≠ device- `ocr |
|------|---------|
| for (cnative eSCL.

---

 Clean handoff for.words.length > 0)/(d) edge## What Wi New→Old` (`build cases)

| PatternLines` in [`‑Fi actually | Typesrc/ocr/parse/ | = Use **`Mac (Scan does on Scanreceipt.ts`](src/ocr/parse/receipt.ts |
|---------|-----|
| RasterSnap

 one)):

```95:121 to file)`** (Home) or Manager crop (**Confirmed use of Wie.g. top  **`None (Scan to‑:Fisrc on/ iocr/parse/receipt.ts
function build25% +X* models:**

- Pair aLines(words: Word[], File)`** |
| Do **not** with **ScanSnap Home** text: string): Line[] mid strip use | on Mac {
  if (words.length), T > 0) {
    // Group by approximate Type = **Manage in ScanSnap Home** pointed/PC over LAN baseline (y), tolerance = half median height
    constesseract quick | Compare token heights = words.map((w Jaccard  
- **ScanSnap Connect Application** (mobile) at New Receipts |
| Do **not** use | Default  
- **ScanSnap Cloud) => w.bbox.h SSH / money** (PC-).filter((h) => library folder as New-stringfree → h > 0).sort presence((a, b) => to text Receipts if SSH a - b)
    const layer |
| Full cloud med destinationsH) =  
 heights-[ DirectMath re.floor(heights.length /-OCR | Only if soft 2)] ?? 12 still indexes that Connect signals ( conflictad folder- |

**Does SSHhoc re)- tocreate the phone/tablet file after Keep
    const tol = Math |

For  

This.max(6, medHR moves it?**  
 KeepR latency is **vendor * 0.6)
 goals    // ...
    const, **prefer text = ws.map((w-**appNo evidence orchestration****, not of re-writing the a standard) => w.text).join pure PDF PDF scanner(' ')
```

| into the original heuristics first**; discovery protocol that Item sample OCR only as shape | What KeepR ( path after an a second happens | stage or Effector Image external move. Managed |
|------------ for ambiguous medium scores.

---

## | Capture--------------)|-------- can speak.

There is a ** mode leaves a **broken library4. Expected rowcommercial ScanSnap SDK** available by**, not a new file|
| **Word-like** (t. Un request from PF density for receiptsesseract-like) | (calmanaged ScanU/Ric-to-file hasibrate,oh ([SDK `join(' ')` rebuild ** don’t copyno library row request page](s lines |** to breakhttps letter-://www.pfu.

---

##  **OKpage rules-us.ricoh.com** — calibrated5. Atomic write)

Letter path |
| **Whole vs growing file —-page line is OCR rules/scanners/sdk)) — that is the only as 3-obs (“ semi one item** | One word500 stability enough per line |-official third-party path?

### Keep chars /  Usually **, and it isR gate (2 pages”) are wrong forOK** for field **not** open regexes; regioncode thermal click receipts.

Rough eSCL and is)

```17 not a drop selects priors for **:17:/-in for a mac aUsers/jroberts/one receipt page huge box** afterOS Electron app withoutDesktop/Internal Development/Tools |
| **Glyph good/KeepR/src/ licensing/partner process ABBYY/ / charingest/watchFolders.ts
.

---

## Keep itemsScanSnap:

| Metric * -R product** | `" | Typical good Stability gate = 3 consecutiveT"+"O range | Suspicious"+"T"+"A decision

### Should KeepR build ANY Scan identical (size, mtime |
|--------|-------------------|Ms) observations.
```

"+"L"` → `"Snap-specific network support?

------------- `STABILITY_REQUIREDT O T A L"`# = 3`
- Default|
| Non | **` **NO**

**Reasons poll `-ws\btotal\b`4000` chars (hard fails**; money tokens constraints ms → roughly **~ shatter | ~808 s,–800 after first observation | & | not vibes):**

1 of a stable size**lt; 40. **No eSCL/ 
| **Space items or &gt; 500 `0 (full-page flyerAir (Scanstreak surface **1→ on any listedstr:"2 model —→ so3 over two poll intervals / "`** | Extra spaces your), longer dual in join generic if size/mtime keeps | Usually OK if driver layer) |
| changing.

### What consumers Text items (less network path will use `\s+`; doublepdf.js) never we know about ScanSnap writes-spaces in | ~15–200 discover/

| Evidence | & vendor stringscontrol |
lt; 8 | Implication them. || **Runs **  
2. **Vendor explicitly with synthetic Confidence |
|----------|-------------|------------|
or** &lt;  locks| Home in5 + out **Verify and save**:-word spaces** | `" no standard tempTO TAL" `$` drivers** (TWA under`, `"12 5./`TOTALIN/ISIS;01"` | Label `%LocalAppData%\Temp` pattern\ScanSnap Home\S/ no ICAmoney driver patterns degrade |
| Items /shRegisterConnection\` (Windows or mis- page-area).  
3 Superparse |
| **Bad. **Open- (ptUser;source reverse engineering only coord²) | Rough transform (points analogous covers USB**, not Wi temp left asly  on Mac expected0.001‑Fi (` “) | Intermediate–0.05 |sane-fujitsu` / workpixels”)** | Y Near `sane-epj- happens **-zero withitsu`;off** destinationtolerance grouping full-page image present network unsupported wrong; multi |
| B; final Save-line merge). copies complete  
4. **Building proprietary network | WrongBox union- support area** / page area | nextish PDF to target ~0.08 means reverse-engineering | **Medium closed-line money;–0.55 vendor protocols (content from wrong band) | &–High** (Windows path confirmed that “ can break with; Mac pathlt; 0.02top” lines firmware/Home with many not officially |
| **Multi items; or published)-column same baseline one bbox covering ~entire** | Columns page with glued one into one line | |
| Searchable PDF FAQ: don’t power off until conversion string |
| updates Distinct — high maintenance, legal/ToS risk, poor ROI.  
5. **Practical completes | OCR baseline KeepR integration is a multi for Pre Scan-Snapexisting users for already t Y values-step process; incomplete exists withoutesseract too; PDF | ≥ shutdown network drivers text can make 5–8 loses search:** watch a folder / importability | **High it worse if columns are separate PD lines | 1–2 lines** thatFs/JPEGs that runs at for a long processing same Y |

Corpus receipt image ** is asyncScanSnap Home** ( tests mostly |

**Implor Cloud →; **Mediumausibly low item count** use `ocrFromText()` local** whether destination path (plan) → **` is updated sync) already is necessarywords: []`**, so produces. That mid-process they exercise the but not sufficient: matches how every or only at  **newline- third-party receipt end |
| Scan30split text path**, not the/doc garbageSnap Manager + word/ app integrates Hazelbbox path that tokens pass ScanSnap today.

### What a Lane P will hit.

 count gate.

---

## 5.**Severity race (Noodlesoft): KeepR *should: Practical decision HIGH** with* dialog do for procedure for char Scan workflowsSnap users (if (ranked by-level → anything, watcher `join(' ')` without precision for KeepR)

Run **after re can **move/rename before user clicks** pdf.js-tokenization)

| Approach | Feasible? | Notes extract,.  
 |
|---|---|---|
| e Save** | Destination (or temp **before** accepting**Severity: MED** forSCL / `_-in `engine: ' line mergeuscan._tcp` discovery-destination)pdf-text'`. Fail/split under | can appear **No ****before | wrong units → fall or multi back to Tesseract for** the scan UI-column.

 Devices don’t advertise/ that page.

### Tier ---

## 4. is finished |0speak — Hard **High** for it |
| ICA Fixed high confidence → under- dialog modes reject (nearflagging

 / Image Capture | ** |
| Manager-zero FPRelevant on good duringNo** | Not constants / formulas multi-page: exposed |
 Scan:

- `LOW| S pages as **separateSnap; high_CONFIDENCE_THRESHOLD temp files**, then = 0.5` precision)

1. **NoANE USB from — measured so items** → (a)  
2 assembled PDF (DEVONthink-era guidance Electron on **correct tesser. **No non) | PDF macOS | **Pooract** fields are assembly is not-whitespace** fit **not** pure “ → (b)  
3 amber-flag** | Sstream oneged ([`. **CorruptANE is Linux-centric growing finalsrc/shared/types.ts encoding; macOS users name”`](src/shared/ dominant already have alwaystypes.ts)).
- Page** (≥ ~ | **Medium** ScanSnap Home; un15% of chars |
| ** bundling USB are `\ufffd` orNo** officialusable: `OCR reverse match `-engine Ricoh doc_UNUSABLE_CONFered drivers is painful found/\(cid:\IDENCE = 0.d that+ guarantees\)/`) |
| ScanSnap commercial3` ([`src/ POSIXdb/repo/items.ts SDK | ** `write- → (c)  
4`](src/db/Maybe later. **Degrepo/items.ts)).
enerate geometry (dto-.tmp` + `rename`** | Requires- Total field conf ≈  
  `labelScore×):**  
   - ≥ 70% of non0.55 + moneyConf PF atomicU publish partnership for; Home not Scan “-networkto e-file | Cannot-×ws0 items. have35 + line claim hardSCL” |
| ** atomicity | widthFolder watch / drag.conf×0 **High.1`  
  →≤-import0** that or height≤0, **OCR docs are from Scan **or**  
   - word conf is only ~10 silent |

### PracticalSnap Home** | **Yes number% of total verdict for KeepR

 — recommended of unique positions confidence.**| Scenario | Stability
- Vendor fallback ≈ rounded to `0 1 pt is ≤ 2.55 + line.conf×** | Zero protocol work; works all gate enough? | Confidence |
|----------|-------------------------|------------|
 while item0.25`; known| Home models |
 count ≥ 8- **vendor` evenMac (Scan to| Scan, **or**  
   higher.

| file)`** + **-to - all items share the same FailureNone**,-cloud then transform e mode | Severity | Why **OCR off import | |
|--------------|----------|,f (**, local **Yes-----or|
| ** disk | **** | User e,Clean-butYes** — final-wrong ABBYYf within 1 pt)  
 text** (e5. **Stack configures ScanSnap Cloud / profiles.g. `ing / dual PDF tends to appear as a finished object after scan |

---

99.0` vs ` layer:** median pipeline; ## Confidence summary pairwise Io9.79`) still matches3×4

| ClaimU of b moneys is | Status |
|---|---|boxes high + TOTAL | ** conservative vs typical
| ScanSnap line with near writeHIGH** | Pattern scores-duplicate strings uses proprietary dominate; fixed burst driver ( | **Medium– (optionalnot TWAIN high `; fewerHigh** |
| Sameline.conf` keeps) | ** receipts have +Confirmed** (PFU **Convert FAQ + every this)

These fields green to Searchable PDF ON** major are the; | user ** model highest-precision “ files wronguseless” detectors and are expense |
| Fixed datasUsuallyheet yes) if |
| No native conf **what never the plan misses hits page- forunusable path (d)**. | **MED**

### Tier 1 — | Page mean High precision soft stays** final path only appears after OCR **or** m eSCL/AirScan on listed models | **Confirmed by absence in m reject ~0 (combine.9+; no  “needs manual2+ signalstime/size changes entry” from conffr |
| Proven)

Score orance `engine: 'pdf vote-text'` only | **;MED reject if score** | Distinguish reset streak during rewrite; **risk** if a non-searchable PDF is written first then silently ≥ threshold.

 docs + sane-airscan + SANE “WiFi not supported”** |
| USB reverse-engineered support (mostability without| # replaced without mtime change ( UI action | Heuristic | Points; plan models except SV600) | **Confirmed toward uselessunlikely on modern admits** (S | Main FSANE) no but un FP |
 risk| | Networkproven) | **Medium measured Main FN risk |
|---| certainty-----------|---------------------- but|--------------|** |
| **Verify and save** / Manager protocol open for third parties | **Confirmed rename still assigns not--------------|
| 1 | dialog / Quick “high” available** without **Al Menu Scan |
| Lower fixed conf tonum ratio** & vendor SDK to Folder | **Risky ~lt; 0.45** / reverse — intermediate files0.55 | **LOW mitigation engineering |
| KeepR on stripped + user alone** | text | Junk Line dialog symbols races |; Receipt Hazel should implement ScanSnap networks with heavy conf is 10% of ` total; labelled* TOTAL with----class bugs | **High protocol | **NO good money*`** |

---

### Key** risk; ** pattern still lands ** separators ( primary URLsdon’tmit use** forwell above 0.5

- [Does KeepR inbox ScanSnap support TWAigate:** |

So “lower fixed conf just |
| Network /IN/ISIS?](https strip punctuation before ratio) | Clean cloud-sync folder://scansnap-faq.pfu.ricoh.com as New/hc/en-us above threshold” is **useful but for/articles Receipt/s276 |108 **586We short honesty**, headers74713-Does-theaker** — sync clients not a reliable |
| 2 | **-ScanSnap-Series- can touch safety netReceipt lexiconsupport-TWAIN- mtime/ for wrong totals /size; partialor-ISIS)  
-. Under shape sync [Can I scan without Scan-flagging of **pl hits** =ausible wrong** extractions is the real product 0 while chars risk — worse files | **Medium–Low** for ≥ 40 |Snap Home?](https://scansnap-faq.pfu.ricoh.com/hc/en-us/ “enougharticles/250574986896 Partial/ than t” without longer89-Can-I-junk thatscan gate-documents-without-esseract’s typicalinstalling-ScanSnap- isn’t a |
| Cross failure modeHome)  
- [i- receiptvolume OCR EX (garbled textX1600 product | NonDEV (KeepR → missing page (Scan-receipt docs already copies fields / `Snap driver,looksLikeVendorName` rejects).

** ingested as “receipt” | ForeignSeverity: HIGH**+hashes) | Orthogonal; Keep Wi‑Fi/USB)](https://www.ricoh-usa.com/en/products/pdR handles post language for silent wrong **/equipment/scanners/ / pure-import movetotal/vendor**;scansnap-ix1600 item | N **MED** for amber-scanner)  
- [ listsi withoutX100 specs (/A |

**Is-badgeno TWAIN TOTAL 3-observation size+ under-)](https:// |
| 3 | **mtime enough?**  
**flagging vswww.pfu.ricMoney/Yes as tesseract baselineoh.com/global/scdate shape** absent.

---

## 5 on. Spacing / normalization differences pages

| Artifactanners/scansnap/ix100/)  
- [SANE device list (Scan a reasonable default for the recommended unmanaged whereSnap entries | Source Scan-to-file profile image is receipt, “ | Parser on-like | Incomplete impact |
|----------|--------|----------------|
 OCR | Non a local disk**,WiFi not supported”)](http://www.s| **-English with residualSynthetic spaces inside currency risk ( words** | pdfjsane-project.org/listsnot zero formats |/sane-mfgs gap heuristics on F) if-cvs.html)  
- per [:

s1ane-fujitsu manaded-glyph OCR PD. User page (“ totalsFs | BreakNetwork interfaces are not supported” enables searchable)](https://man. only ins `TOTAL`,archlinux.org/man/sane-fujitsu.5 image |
| 4 | vendor PDF and an. early incompleteen)  
- [ names, money tokenssane-airscan tested **Coverage** of/ devices (no ScanSnap)] |
| **Separate space union of b(https://github.com/non `TextItem`s**boxes &lt;- | Largefinal file 2% of pagealexpevzner/sane-airscan)  
 gaps | ` with item sits- [AirSane #Countjoin(' ')` doubles at final45 — USB ≥ 10 | spaces; mostly path with stable ScanSnap brid Coll OK |
| **Missing size,ged * spaces**apsed or marginas* eSCL or  
2. User uses | Gaps below-only text, not native](https `trackingSpaceMin` / | Sparse a dialog/managed://github.com/Simul `not trueASpace` | ` receipts (rare profile soPiscator/AirSane/issues/45)TOTAL125) | Partial.01` — layer SSH still with few big money may still match; labels harder boxes |
 holds a lock or rewrites after| 5 | **Coverage |
| **NBSP / Keep** &gt; 90 oddR acts% as Unicode spaces.

**Hard **one** text** | Someening options ( run writers | `\if you need | Dumps` in / JS usually matches NB higher wrong matrixSP; token confidence):**  
 | Decorative splits- Prefer **OCR full-width can off** in line still surprise ScanSnap; let | Un |
| **Soft hyphen U KeepR OCR.likely on+00AD** | Line good OCR  
- Optional: wrapping open PDF trailer |
| 6 | ** in text check / `% layers | CanY-band count** &lt; sitEOF 4 while inside words;` before import ( not in `ocr page height &gt; not present300 pt today).  
- OptionalNormalize` |
| **Lig and item: longer poll oratures (Count ≥ 15 ﬁ, ﬂ | (4–)**d) or single5 streaks | Font-line dump | Ultra for large encodings-short multip | pdfjs ` stubage +normalizeUnicode` often expands receipts | Multi OCR profiles; if-column rare.  
- Do **not not, on vendor receipts |
| 7 |/regex** point New Receipts at a cloud **Scale-synced path miss** median if avoid |
| **Kerning / fontable.

---

## TJ numeric size &lt; 2 adjustments pt or &gt;  Keep** | AB80 pt (inBYY glyphR recommended user space) Scan | (d) identity placement |Snap profile (macOS)

 /```
Type Triggers:        flush wrong CTM | Tiny Mac (Scan to file)
 + fineSave fake spaces print only (core to:     | |
 pdf.js pain <| 8 | **Unique class) |
|KeepR New word ** ratioNo** trim & Receipts>
Sendlt; 0.15 on raw to:     `str` with ≥ None (Scan to file)
 40 tokens |** | pdfFile format: PDF (js | RepetSingle)
Convert Leadingitive garbage | Tables to Searchable PDF: OFF/trailing spaces become of repeated  (or “ SKwordsUs |” if not ON if you |
| 9 | ** stripped ( accept OCR latencyItem count** &lt;tesseract path; KeepR can ` trims) |

Tmax still re(6esseract path-OCR)
File name explicitly, k:   **trims empty * sqrt Customize → words** ([`map(pageArea date stampWords` in `tPt or prefix +esseract.ts`](src))` with k serial
≈/ocr0./tesseractDocument15.ts type:)). All Lane P must do the same ** | ( sheets as documents (plus** whitespacec) partial | Very normalization short parking before `or Receipts if desired)
```

 stubs | LogobuildLines`.**Legacy Manager:**

```
Use-only OCR with Quick Menu:

**Severity: HIGH** OFF
Application: None (Scan to File)
Image saving 3 tokens |

### for synthetic folder: < Tier 2 — Accept in-word spaces onNew Receipts boost ABBYY>
Renameers (increase after scanning: OFF
 layers confidence for; **MEDConvert to (** for soft Searchable PDF: optionale), not sole opt hyphen gates-)

in-
```

---/ligature

## Confidence Producer/ summary

| Question |/NBSP edge cases.

Creator matches Scan Answer | Confidence---Snap /

 AB##BYY 6. Practical / FineReader  
- Invisible |
|----------|--------|------------|
 mitigations (mapped| Home scan-style-to-folder steps | to risk usage)

| Mitigation | Document (not Addressesed; Type | Notes for directly + KeepR |
|------------|----------- in Save|-----------------| to
 +| None ** pdf.js; optionalRebuild lines | **High** from b pik |
| Managerboxesep onlydf render** (ignore item scan-to-folder boundaries-mode pass as semantic steps | Well — ** documented viaskip guide words) | Char/run granularity for v | Cluster + community1** unless by Y,; you already small then sort by X; insert spaces walk UI label content streams)  
 from variance- by Lex **horizontal gapsicon hits**, not from ` version | **High** |
join(' ')` on ≥ 2 (| Searchable PDF default | every item |
| **Normalize **Opt-ine.g. money whitespace** (` checkbox**, both/\ + dates+/`, strip products | ** or TOTAL soft hyphens + vendor-, mapHigh** |
| Naming templates | Date formatslike token)  
- Mean NBSP) + custom/ line length before regexserial; Home and | Spacing Title vs File line count name by in “ Type | **High** |
receipt-ish| Library management” band  

 artifacts | Apply to both full text and per-lineProven after folder save | **Only text |
| **Reance: `engine: ' if Type = Manage-tokenize runs…pdf-text'`, fixed when**; confidence Scan (plan gap &lt; ~0),.3× median optional-to-file is clean handoff | **High** char width `text** | FakeLayerQuality: 'high in'|'medium'`-word spaces | Counter |
| KeepR move breaks SSH | pdf forjs over flagging-insertion on **Yes if managed**; **No if Scan-to-file** | **High** |
| Atomic.

### Tier 3 — OCR PDFs final |
 write| | ** **SameNot documented Expensive arb**; temp intermediatesiter (optional, field regexes** | Correct | rare)

If Tier Do ** 1 isnot** fork exist **;ambiguous stability** gate ( **usually** parser logic pere.g. good OK for unmanaged direct save | lexicon **Medium** ( engine |
| **Fixed, weirdbehavior conf just geometry,) / above  **High** (docs or vice0.5** (e silent) versa):

- Render |
| .g. 0. page3-obs gate enough55–0.65 | **Sufficient (you) | Honesty for recommended already of raster provenanceize at profile**; | Alone 200 DPI for storage not bullet). **  
- Crop **proof for dialog/insufficienttop 20** against%** + wrong totals |
| **Cap **aOCR/cloud edge horizontal field conf for `pdf- band attext`** or 40 cases | **Medium–High** |

---

## Sources (primary)

- Ricoh ScanSnap FAQ: [Scan to Folder profile]( requirehttps://scansnap-faq–60 second.pfu.ricoh% height**.  
- Run Tesseract.com/hc/en- signal | withus/articles/130427 Silent short timeout97368729), [save wrong total / PSM  without main window / PC | e6.  
- Accept embedded.g. max field conf |Mac Scan to file](https://scansnap- layer only iffaq0..pf75;u.ric Jaccardoh.com/hc/en or dual-path disagreement-us/articles/239 → of al lowernum tokens ≥ ~ conf /11336175129), [searchable PDF](0.4https://scansnap-faq force review.pfu.ricoh |
| **Dual-path **or** both contain A/B on corpus** the same money string | Producer.com/hc/en-us/articles/165635.

This variance is the only practical80577049), [file names](https://scans | Fornap-faq.pfu way to catch “.ricoh.com/hc each fixturebeautiful/en-us/articles: pdf-text only/45724202806809 English parked vs tesseract only;), [serial numbers]( in the asserthttps://scansnap-faq wrong place” when agreement or geometry heuristics.pfu.ricoh deliberate.com/hc/en- are soft fallbackus/articles/227377 — |
| **Fallback heuristics26255129), [external beyond but for move KeepR, ** “few/rename errorTier 0](https://scansnap items”** | Junk geometry already layers | Also-faq.pfu. catches most (: highricoh.com/hc/d)**.

--- fraction of 

## 6. Decision1-char items, meanen-us/articles/ matrix (a461 gap74058072857), [NAS + anomalies–e → signals)

| State | Item count | Strings, low alphanumeric manage warning](https://scansnap-faq.pfu. density, empty | Geometry |ricoh.com/hc/ afteren-us/articles/ normalize |
| **Optional Metadata25057686329113)
: if char | Action-- ScanlevelSnap detected Help: [ |
|-------|------------Edit profiles /, re-|---------|---------- Managing options TypesOCR** ||----------](https://www. Worst|--------|
| **(pfu.ricoh.com PD/imaging/downloads/manuala)** | Fs | Detect/0scans |nap_ —help |/ — |:en/pc/topic/ any | median item length OCR |
| **(bope_screen_profile_ ≤ 1–)** | &gt2 and itemedit.html), [Making files count ≫;0 | all ws | any | any expected | OCR |
| **( wordsc)** junk manageable](https://www.pfu.ricoh.com/imaging/downloads/manual/scansnap_help/en/pc/topic |

---

## Failure/ope_mgr_retrieve | low_files.html), [PDF-mode severity summary–medium | low file option](https://

| # alnum, cid | Failure mode | Severity |
www.pfu.ric/ffoh|---|.com--------------/imaging/downloads/manual/scansnap_|----------fd|
,| no F lexiconhelp/en/pc/1 | Char/ | sparsetopic/ope_screen_glyph items → or randomadvanced_setting_pdf.html `join | weak)
- Scan(' ')` → brokenSnap Manager Advanced | OCR |
| **( TOTAL/vendor/ Operation Guide (Scanc)** partial | mediummoney | **HIGH** |
 | often| F2 | pdf OK onjs synthetic spaces inside to Folder Quick a Menu flows words (ABBY subset | low)
- KeepR:Y glyph placement coverage / `src/ingest/watch) | **HIGH** |
Folders.ts` (stability gate top-| F3 | Clean)
- Communityonly | any-but-wrong embedded: Hazel/ | OCR (count OCRNood + highlesoft race, gate alone conf → silent may fail Mac wrong total) |
| **(dPowerUsers managed | **HIGH-)**folder | warnings** |
| F4 | medium– cupshigh | **goodfilter-only** | **collapsed calibration misses / wrong ScanSnap ABBYY scale / few structure | **HIGH Y** (process) / **MED / zero size** if dual corpus exists** | any | **OCR |
| F5 | Wrong** (plan PDF→raster coord misses this) |
| transform (bboxes, grouping **(e)** | medium–high | high alnum, lexicon, highlights) | **HIGH | multi** (plan already notes-line, sane; still coverage & scale | often ScanSnap/ABBYY must | ** test) |
| F6 |Use layer** Line merge/split |

---

## 7 (height. What PLAN units, multi-column)-3’s simple | **MED** |
 approach misses (| F7 | Soft hyphencritical / ligature)

### Miss / NBSP edge cases |ed: ** **MED** |
| F(d) wrong positions**8 | Fixed high conf alone — highest under-flags vs product threshold risk

Acceptance | **MED** criterion (compound #4 requires worded by F3 boxes to align) |
| F9 | with the stored raster Junk. A/sparse layer can text layer accepted as have:

- Correct “good enough” | **MED** |
 `TOTAL 125| F10 | Engine.01` and vendor tag without strings  
- Item review count  UX change24 (exactly | **LOW–MED** the “good |

**Net: trusting” demo count embedded text can degrade extraction vs t in the planesseract** when the layer is glyph)  
- Yet-positioned or wrong transforms-but that-clean; it are identity, can also ** all yimprove** quality when=0, width ABBYY text=0, or is correct **and** normalized a single CTM dump  

 into tesseract-like words.**# RESEARCHSearch/ The plan Q3 — pdfFTS still works currentlyjs text; click optimizes for the item → 200 DPI raster-to-assign and field pixel b happy path without adversarial space

Keepboxes do fixtures not.**  
Simple.

R--- already

 rasterizes## Acceptance tests with `page.get “ theno plan layer is missing

Plan- / whitespace / low count”Viewport({ scale: dpi / 72 })` and `3 **always acceptance covers path accepts (d).**Math.ceil(viewport.width/height)` (`

 selection,**Minimumsrc/workers/imagePool empty layer fix:** Tier .ts`, `src/ingest fallback, bbox0 geometry (unique/import.ts`). Text click positions, non-zero alignment, multip size, scale-age — ** sanity, multilayer bboxes must usenot extraction-line Y bands **that parity).

### Missed: or confidence same viewport**, not a **(c) junk hand-rolled “612 honesty**. with enough tokens×792 × Add:

###**

Examples 200/72 + y A. Gran:

- 40-flip”.ularity / normalization tokens

---

## 1 unit tests of `|. PDF user space

Per (no realIl the PDF|` required)

1 / `~. **Glyph stream` / barcode PDF imaging model (ISO:** words garbage → `T, passesO,T,A, low- 32000 / PDF.js docsL, ,1count  
):

| Property | Value |
|---|---|,2,5,.,- Header-only OCR (“STORE0,1` with
| Origin | **Bottom sequential #-left** of the page’s12 x → crop/ afterview box |
”) with  adapter| Y axis12 items →, line | **Up** |
| passes Unit text is count, fails ` |TOTAL **User 125.01 field extract unit` (not `T  
- Broken** (default = O T A L  ToUnicode:1 2 5 . 1 point = looks non 1/72 in 0 1`), and-empty, al `parseReceipt` total; = 12501 PDF 2.0num ratio collapses `  

.
**2User.Unit` **Space can scale items:** alternateMinimum fix:** al this) |
| Page box tokensnum ratio + receipt for drawing and `{ lexicon/money | Whatstr:" "-shape pdfjs exposes}` → no + coverage as `page.view`.

 (intersect double-space breakage### Missed: **corrupt;ed crop/ butmedia), total/ non **not** alwaysvendor still parse.
-empty Unicode** raw3. **Synthetic in

OC-word spaces:** items MediaBox |

pdfRmyPDF’s `.js `TO docshas_corrupt_text``, `TAL (U+FFFD)` with state that `PageViewport` is the right tiny gap vs maps this `TOTAL` idea. Paper system to with wordless/ canvas space gap → repdftotext- (topjoin rulelength skips recovers-left, y this and-down) with `TOTAL`. scale and keeps garbage
4. **Soft hyphen rotation.. Keep / NBSP /R should treat ligature fixtures dominant

For** in replacement your test item/cid as ** receipt: ` `str`viewBox [0, → normalize beforeno layer**.0,612,792]` parse.
5. **Whole

### Non → US-line single-misses ( Letter points item** per; atplan is  row200 DPI, fine)

- nominal → still parses Pure image raster ( is PDFregression  
` ( guarda)  
- Whitespace layer612 × 200 for/72 ≈ 170 (b)  
- Extrem run-level0` × PDFs).

### B `ely792 sparse  × 200/. Dual-source PDF72 =1–3 token fixtures (acceptance 2200` ( junk if gapsbefore `Math.ceil`). threshold

---

## 2)

6 is high. **Scan. `Text enough  

###Snap/Item.transform` semantics (` Over-rejectABBYY searchable[a,b,c receipt risks of,d,e,f PDF naïve]`)

From bundled **pdfjs-dist 4** (real or thresholds

 AB.10.38** worker| Over (`getBYY-generated),Current-strictTextTransform` in ` not onlypdf.worker.mjs`): cupsfilter: assert rule | False

```js
// vendor positive |
|------------------ tsm = text/date|----------------|
| Min-space scale from/total against items ≥ fontSize / ground truth with 30 `engine === | Short 'pdf-text'` and textHScale / textRise
const tsm = [fontSize * textHScale, 0 Uber **zero, 0, fontSize/parking tesseract invocations, 0, textRise stubs |
| Require**.
7. **Same]
 Producer pagereturn Util.transform(ctm=, image, Util.transform(textMatrix, tsm))
```-only PDF**ABBYY | Phone (strip scans with

So `item.transform` is text layer): still good third OC the **full text-party OCR |
| Reject rendering matrix inRs page; field parity Identity-H fonts user space** (CT within known | Many corpus tolerance.
M × text matrix × valid8. **Same page, both paths OCR sandwiches |
| Require A English/B:**  
 dictionary ≥   - If font-size scale). It is **not** in CSS/canvas pixels.

| Element 50 pdf-text and% | SK tesseract ** | Meaning |
|---|---|
| `e`,agree** on totalU-heavy `f` | Translation/vendor/date = receipts, non **glyph/ → pass-English |
| Strictrun origin**. y-monotonicity | in user space —  
   - If they ** the Twodisagree** → either-column menus force / rare layouts PDF ** review (conf |

Caltext drawing origin**, which & for horizontalibrate on reallt; threshold or ` Latinneeds ScanManualSnapEntry samples`) + ** text is theor** documented known **baseline- winner bad layersleft** of the run ( policy;; prefernot ink top **geometry-left, **must not** silently prefer + encoding not em pdf-text with conf** over dictionary purity ≥ 0.9.
 for receipts-box bottom-left) |
| `a`, `b` | X-basis.

---

## 89. **Junk layer of text. Confidence:** few (direction proxies ** random of advance glyphswithout** re-OCR

 / watermark);There `-only textMath.hypot( is **no true → **a,b)` ≈ horizontal OCR confidence** onfallback to t scale ( an existingesseract**, not empty or layer. Prox wrong item≈ font size × h-scale × CTies,.
10. **WhitespaceM scale) |
| ` ranked:

1. **Geometry-only layer**c`, `d` | (already planned sanity Y-basis of text (**up the (binary) + **high item em-box);-ish count of `Math.hypot(c: degenerate spaces or not) — only**.

### C. Confidence / best for (d)  
2. ** flag,d)` ≈ font size in user space |
| Angle | `atan2(bEncoding health,ging a

)`11 in. Assert pdf** (ff user space-text field provenancefd/cid rate |

Type declaration:) — best for corrupt (`api `engine` distinguishable.d.ts`):

 maps  
3. **Lexical **```ts
transform: Array / shape fitness<any> and** field conf ** for receipts** —not // “** in best for ( the “almostTransformation matrix”
width: numberc)  
          certain”4. band ** (Coverage vs // “Width in device space”
height: number         //e.g. ≤  page + “Height in device space”
0.75) image presence** — partial```

Here ** unless a vs full“device space” means  
5. **Producer prior second signal exists PDF user space after.
12. Plant** — weak CTM**, ** a **known  
not** viewport pixels.-wrong** searchable That naming6. **Inter layer (edit-item consistency** has caused many (duplicate text objects so total bugs.

` string stacksText ≠ image total, absurdLayer` positions): extraction font spans from may return sizes)  

Do `transform the wrong number, **not** invent a but the 0– item **must** be100` and subtract reviews **ascent** from “OCR confidence-flagged (low `f conf, dual” that compet` so the DOM-path mismatches with Tesseract scores box, or explicit. Keep plan sits on the glyphs pdf, not on the intent-text review tag baseline:

```js
const: high) fixed conf + tx = Util.transform(y — provesFlipOnly `engine: 'pdf- F, geom.transform)
3 istext'`, optionally// angle controlled attach-.
13. Page `layer0 case `ocr_conf`Flags: [':
left = tx[4 for pdf-text mustgeometry]
top  not disable =-ok tx','[lex5] - `needsManualEntry` whenicon-ok']` for key fontAscent  // baseline fields are missing.

### D. Geometry ( debugging.

---

## 9.beyond Recommended KeepR acceptance “click predicate selects words”) (concrete

14. After → visual top
```

(`node_modules/pdfjs-dist/build/pdf.mjs` TextLayer `#appendText`)

 )

Pseud---

## 3. How `width` / `200 DPI raster, sampleocode for oneheight` relate to the transform word b page:

```ts

Fromboxes: Io
function isUs the same workerU or (`ableTextLayer(items: centerensureTextContentItem` / Text-inItem[], page: { `flushTextContentItem`-glyph w: number; h: number }): vs visible / `buildTextContentItem text for boolean {
  const tokens`):

**Horizontal text**

 ≥- `height = Math. = items.map( Nhypot(trmi => i.str).[2], trm[ labelsfilter(s (TOTAL, vendor3])` → length => s.trim(). header).
15. Rotlength > 0)
 of the transformated page (90  if (tokens.length === 0) return false

/180  const text’s Y column ≈ **font size in user units**
- `) if Scanwidth =` tokens.join accumulates glyph advances (Snap can emitwith(' ')
  const it `textHScale`, compact — transform + char/word spacing), = text.replace(/\s+/ `hasEOLg`, '') behavior
  if.

### E (compact.length === 0 then at flush is multiplied by `textAdvanceScale = |. Corpus gate) return false

  // (processCTM_x| × |textLineMatrix Encoding)

16. Minimum
_x|`
 dual- Emitted corpus before  const bad = ( `width` merge: ** / `height` are **text.match(/\absolute lengths in the≥ N real same user-space units asu ScanSnap searchable `e, PDFs** + **FFFD|\(cid≥ N image-only** +:\d+\)/g) ?? []).length
  if (bad / **≥  Math1 adversarial.max(compactf`**

**Vertical text**

- Roles swap: width ≈ em size, height ≈ advance

**Important.length, 1) > wrong-layer**** 0.05) return PDF.  


- `width` is17. Report false

  // Count already the full: agreement vs run advance rate pdf area in user space;-text vs tesseract (receipt-tuned; fallback rate; wrong)
  const area = page-total rate.w * page.h
  ** ifdo not (tokens** also.length multiply < by `a` or font size with Math/.
.maxwithout- dual( `height6`, is  **0em.-12size**,-path.

 not ink * Math.sqrt(area---

## Recommendation height.))) return false

  // Descent for the plan below the String quality


1. Treat **  const alnum = compactitem →.replace(/ Word mapping** baseline is **not** included if you treat `([^0-9e,f)` as the as a **normalization bottom of theA-Za-z]/ stage box.
- `stylesg, '').length
 [fontName].ascent**, not a  if (alnum / compact` / `.descent`1:1 map: are fractional.length bbox- < 0.5) return false
  const metricsbased line rebuild hasReceipt you + gap-Shape =
    /based spacing can use to + whitespace\$?\ tighten the box (Text/Layer does).d{1unicode cleanup.
,5

---

## 42. Treat **fixed}[., high confidence. Conversion to]\d{2}/ 200 DPI top-left as a. pixel bboxtest(

###text) || Naive product bug
    /\b(total upright** relative to Keep|tax|sub,R’s own philosophytotal|visa (“do not claim certainty|mastercard unrotated, origin you-zero|change did not measure”). Prefer **moderate view (your test receipt fixed conf**)

```
 plus **s = dpi / 72|cash)\b/i.test(text) ||
    /\b\d{ = 200/721,2}[dis

//\/agreement\- / plaus PDF user space (y]\d{1,2ibility** checks-up, baseline; do}[\/\-]\d origin)
x_pdf not rely on conf{2,4}\b/.test(0 = e
y_pdf0 = f totext)
  // Don't              catch hard-require // baseline
x_pdf wrong totals shape if short1 = e + width
.
3. ** stuby_pdf1 = fBlock Lane + height     // approx; require P ship if** on AB long textBYY/Scan top of em-box

// Raster top-left (
  if (compact.lengthSnap fixtures andy-down)
x0 = e >  an60 && ! adversarial wrong-layer testhasReceiptShape) return false * s
y0 = (pageHeightPts - f, not on

  // Geometry — catches - height) * s
 cupsfilter-only recoveryx1 = (e + (d)
  const boxes of `TOTAL  width) * s
y = items.filter125.01`.
4(i1 = (pageHeightPts. Keep field - f) * s

bbox => = i {. xstr.trim()). regexes unifiedmap(bbox: x0, y:; putFromTransform)
  const nonzero all y0, w: x1 - x0, h pdf: y1 - y0 = boxes.filter(b =>-specific b.w > logic }
```

For `viewBox [ 0.5 && b in the **0,0,612,.h > 0.5792]`: `adapter**)
  if (nonzero.lengthpageHeightPts = 792 that builds / boxes`.

### Why `OcrResult`..length this is < incomplete 0.5

That) return false

  const as a product keys is the real formula

 risk surfaceIt = new Set(nonzero: not breaks.map(b => `${Math as “pdf.round(b.x)}, soon as any${jsMath can’t.round(b. read text of these appear:

- `/y)}`))
  if (tokens,”Rotate but` ** “.length >= 890/180/270  
pdfjs text && keys.size <=- Nonzero is the crop 2) return false

 wrong shape for a origin tesseract-calibrated parser, and high (`view = [x  const ys = [...new Set(nonzero.map(0,y0, conf hidesx1,y1]` cleanb => Math.round(b.y / 3) with `x0|y0 ≠ 0`) errors * 3))]  
- `UserUnit ≠.”** // ~ 1`  
- Skewed /3pt bins
  if (page rotated **text**.h > 200 && tokens.length >= 12 && ys.length < (`b` 4) return false

 or `c` nonzero)  
- Raster size taken  const union = union from `Math.ceil(Area(nonzeroviewport.*)
  const cov)` while math uses = union pure / area `612 *
  if (tokens s`

### Correct identity.length >= 10 && cov (rotation < 0.015 0, arbitrary) return false
  if viewBox)

From `PageViewport` source (cov (rotation > 0. 0):

```
85transform = [s· && tokens.length <=U 3) return false

, 0, 0  const scales = items, −s·U, −s·U·viewX.map(i => Math0, s·U.·viewY1]
```hypot(i.transform

i.e.

```
x_px[0], = (x_ i.transform[1]))pdf − view[
  const0]) * (scale med = median * userUnit)
(scales)
  if (y_px =med < 2 (view[ || med > 723] − y_pdf) * (scale * user) return false

  return true
}
```

Tune thresholds on a small corpusUnit)
```

with `scale = dpi/72`. That is exactly what `:viewport.convertToViewportPoint` ScanSnap searchable implements,.

---

## 5. image- `/only,Rotate intentional` bad ( — bakedzero into `getTextContent`?

-width text PDF**No.** `get, partialTextContent()` OCR, identity returns items in dump).

---

 **unrotated page## 10. Rank user space** (content-ed heuristics for implementation order

|stream CTM + text matrix only). Page `/Rotate` is ** Rank | Heurnot** foldedistic | Cat into `item.transformches | Precision |`.

**Yes for Cost | raster.** Plan KeepR’s ` gap?getViewport({ |
|------|-----------|---------| scale: dpi/72 })`-----------|------ defaults `rotation = page.rotate`, so the PNG|-----------|
| 1 already has | Empty / page rotation applied ( whitespace | adimensions, b | Extrem swap at 90/270).

**ely high | Free | CoveredCall |
| 2 | Degers must apply the same viewport transformenerate positions / sizes** (scale / few + y unique-flip ( + page rotation + viewx,y) | ** offset + userd** | VeryUnit). Do **not** also rotate high | Free | **Miss byed** |
| 3 `page.rotate` a | Encoding garbage second time.

pdf (fffd/.js’s own Textcid) | c | VeryLayer y high | Free | **Miss-flips withed** |
| 4 raw page | Low item count vs √area | c partial dims | and High applies | Free **rotation via CSS on the layer**, separately from item | Covered matrices — another partially proof |
 that| 5 | Al itemsnum stay ratio (+ in punct strip) | c junk unrotated user space.

---

## 6. Non-identity scale | High | Free / | skew **Miss

| Case | What happens |
|ed** |
| 6 | Receipt---|---|
| `a money ≠ d/date/TOTAL` (different shapes h/ | c vsv scale) | Cond e | High onensed/expanded receipts | Free text; `width | **Missed** |
` still| 7 | Y- correctband / line in user space; box count | d is, c non | High on-square em |
| `b, tall receiptsc | ≠ Free  | **0Miss` | Text rotated ored** |
| 8 skewed on | BBox coverage band | c, the page; AABB must come from **all four** d | Medium–high corners of the text | Free | **Missed parallelogram |
| Negative** |
| 9 | `a` or Font scale median `d` | Mir | d | Medium–rored / high | Free | **Missed** |
| 10180° text runs; normalize | Producer ScanSnap/ with minABBYY | e/max after transform boost | Low |
| Type3 alone | Free special path | Optional |
| 11 | Sample | `getCurrentTextTransform` may rescale- Ycrop re-OCR Jaccard from font bbox |

 | cAxis-aligned `, d edge | Highest | ExpconvertToViewportRectangle([e, f, e+w, f+hensive | Later])` is OK |

--- for upright runs +

## 11. Bottom page rotate ∈ line for KeepR

 {0,90,1. **Industry180,270}. It is tools (OC **wrongRmyPDF, Paper** for diagonalless)/ only detectskew presenceed runs.

---

## 7. Common bugs (especially ( vsand sometimes corrupt Unicode PLAN-3’ / invisibles one-liner)

PLAN text-3 only says).** They will happily: ** *“PDF origin-bottom-left, y-skip OCR on a useless orup, points → 200 DPI top-left”*. That invites mis:

1. **aligned layer.**Baseline KeepR must ≠ be stricter because box origin it uses** — Using `(e, f)` as top- bboxes forleft or bottom-left of UI ink shifts and extraction every, not just F highlight byTS.  
2. The ~as plan’s triadcent. is **necessary  
2. **Wrong height but incomplete for y-flip**.  
** — Using3. The two MediaBox vs ` failures that will hurt realpage.view` vs `viewport.height/scale` vs stored users most: PNG  
   - **(d height.  
3. **)** goodIgnoring strings, page `/ wrong positions → **geometryRotate`** — Text Tier lands in 0**  
   - unrotated coords **(c)** enough while PNG tokens, still junk is rotated (or the reverse/partial → double **al-rotate).  
4. **Cropnum + receiptBox shapes offset** — `e + coverage**  
4. * **Identity-H / s` without subtracting `view[ ABBYY fonts are not a0]` / using viewport.  
5. **“Device reject space” = pixels signal**; **** — Treatingbroken Unicode and `width`/`height` collapsed CT as already atMs are.** 200 DPI (  
5. Metadatathey are is a soft still prior for in user units (e).  
),6 never. **Double scale a gate** — `width.  
6. Skip * a * sample re-OCR until s` when `width` is already user geometry+-space advance.  
7. **Scalestring-1 heuristics are in viewport then multiply place; add** inconsist only forently with `Math.ceil ambiguous medium` on the render- viewportscore pages if production.  
8. **Only two data shows residual failures corners** under.

That set text skew. of checks  
9. **Marked is enough to safely-content items prefer ScanSnap/AB** — EntriesBYY layers without `str` ( for speedbegin/quality/end marked content) while still falling must be skipped.  
10 back to Tesseract when. **Multi the layer would-glyph poison field geometry chunks** — One `TextItem` or receipt is often a parsing whole line. fragment, not a single OCR “word”; splitting for receipt parsers needs geometry re-derived per token.  
11. **Whitespace / fake-space items** — pdfjs injects synthetic space items with their own transforms.  
12. **UserUnit** — Rare but silently wrong if you hardcode points without viewport.  
13. **Mismatch with stored master** — KeepR `Word.bbox` is stored-master top-left pixels (`export/geometry.ts` contract). Text-layer path must match the **same** raster pipeline (`dpi=200`, same `getViewport` rotation default).

---

## 8. Recommended KeepR algorithm

Use the **identical** viewport object parameters as rasterize, then transform corners. Prefer pdfjs APIs over hand math.

```ts
import type { PDFPageProxy, TextItem, TextContent } from 'pdfjs-dist'

const DPI = 200

/** Same viewport contract as imagePool.rasterizePdfPage / import rasterize. */
function pageRasterViewport(page: PDFPageProxy, dpi = DPI) {
  return page.getViewport({ scale: dpi / 72 }) // rotation defaults to page.rotate
}

/**
 * TextItem (PDF user space, baseline origin) → axis-aligned bbox
 * in stored-master raster pixels (origin top-left), matching the PNG.
 */
function textItemToMasterBBox(
  item: TextItem,
  viewport: ReturnType<PDFPageProxy['getViewport']>,
  styles?: TextContent['styles'],
): { x: number; y: number; w: number; h: number } {
  const m = item.transform // [a,b,c,d,e,f]
  const w = item.width
  const h = item.height

  // Unit vectors along text x (advance) and y (em up)
  const tx = Math.hypot(m[0], m[1]) || 1
  const ty = Math.hypot(m[2], m[3]) || 1
  const ux = m[0] / tx, uy = m[1] / tx
  const vx = m[2] / ty, vy = m[3] / ty

  // Optional: shift from baseline using font metrics (better highlight alignment)
  const st = styles?.[item.fontName]
  const ascentFrac = st?.ascent && st.ascent > 0 ? st.ascent : 0.8
  const descentFrac = st?.descent != null ? Math.abs(st.descent) : 1 - ascentFrac
  // Local box relative to baseline origin: x∈[0,w], y∈[-descent, +ascent] in length units
  const y0 = -descentFrac * h
  const y1 =  ascentFrac * h

  const cornersPdf: [number, number][] = [
    [m[4] + ux * 0 + vx * y0, m[5] + uy * 0 + vy * y0],
    [m[4] + ux * w + vx * y0, m[5] + uy * w + vy * y0],
    [m[4] + ux * w + vx * y1, m[5] + uy * w + vy * y1],
    [m[4] + ux * 0 + vx * y1, m[5] + uy * 0 + vy * y1],
  ]

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [px, py] of cornersPdf) {
    const [X, Y] = viewport.convertToViewportPoint(px, py)
    if (X < minX) minX = X
    if (Y < minY) minY = Y
    if (X > maxX) maxX = X
    if (Y > maxY) maxY = Y
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}
```

**Simpler path** (upright horizontal only, ignore descent — often enough for receipt region assign):

```ts
const [e, f] = [item.transform[4], item.transform[5]]
const rect = viewport.convertToViewportRectangle([
  e, f, e + item.width, f + item.height,
])
const x0 = Math.min(rect[0], rect[2])
const y0 = Math.min(rect[1], rect[3])
const x1 = Math.max(rect[0], rect[2])
const y1 = Math.max(rect[1], rect[3])
// bbox: { x: x0, y: y0, w: x1-x0, h: y1-y0 }
```

`Util.applyTransform` / `viewport.convertToViewportPoint` are the supported primitives; `Util` is exported from `pdfjs-dist`.

**Pipeline glue (must match raster):**

```ts
const viewport = page.getViewport({ scale: 200 / 72 })
// render with this viewport → PNG width/height = ceil(viewport.width/height)
const { items, styles } = await page.getTextContent()
const words = items
  .filter((it): it is TextItem => 'str' in it && !!it.str?.trim())
  .map(it => ({
    text: it.str,
    bbox: textItemToMasterBBox(it, viewport, styles),
    confidence: 0.99, // fixed; provenance engine: 'pdf-text'
  }))
```

If you ever change raster DPI or pass an explicit `rotation` into `getViewport`, text extraction **must** use the same options.

---

## page.view / MediaBox vs rendered viewport dimensions?

| Source | Use for |
|---|---|
| **`page.getViewport({ scale: dpi/72 })`** | **Authoritative** for both raster size and text→pixel mapping |
| `page.view` | Underlying viewBox fed into that viewport (crop-aware) |
| MediaBox alone | Insufficient if CropBox differs |
| Hardcoded 612×792 | Only valid for that one test page |
| Stored PNG `width`/`height` | May be `ceil(viewport.*)`; convert with **viewport floats**, then clamp to image bounds if needed |

**Answer:** Transform with the **actual rendered viewport** (same scale, rotation, viewBox, userUnit as rasterize). Do not rebuild scale from MediaBox while rendering used `page.view`.

---

## Concrete formulas KeepR should publish in the plan

**A. Preferred (always):**

```
viewport = page.getViewport({ scale: 200/72 })   // includes page.rotate
pixel = viewport.convertToViewportPoint(pdfX, pdfY)
// or convertToViewportRectangle + min/max
// or 4-corner map for skewed text
```

**B. Expanded, rotation 0, view `[vx0,vy0,vx1,vy1]`, userUnit U:**

```
s = (200/72) * U
x_px = (pdfX - vx0) * s
y_px = (vy1  - pdfY) * s
```

**C. Test receipt special case (`[0,0,612,792]`, U=1, rotate 0):**

```
s = 200/72
x_px = e * s
y_px = (792 - f) * s          // baseline in top-left space
// em-box top-left approx:
box = { x: e*s, y: (792 - f - height)*s, w: width*s, h: height*s }
```

---

## Subtle bugs the plan is likely to have if it only says “bottom-left → top-left, points → 200 DPI”

1. Baseline vs bbox (vertical offset ~0.2–1.0× font size).  
2. No `getViewport` → broken `/Rotate`, CropBox, UserUnit.  
3. Confusing pdfjs “device space” width/height with pixels.  
4. Y-flip height taken from the wrong box.  
5. Double rotation (page rotate in viewport **and** manual).  
6. Ignoring text-matrix rotation/skew on multi-column or angled receipt text.  
7. Raster `ceil` vs continuous coords (usually ≤1 px; still test alignment).  
8. Not skipping non-`TextItem` stream entries.  
9. Treating each `TextItem` as one “word” for parsers that expect token-level boxes.  
10. Falling back to OCR when coordinates look empty because of a y-flip bug (fields present but unusable).

---

## Sources (local + external)

- Bundled pdfjs-dist **4.10.38**: `PageViewport`, `TextItem` typedefs, `TextLayer`, worker `getCurrentTextTransform` / width-height accumulation  
- [PDF.js examples — viewport y-flip + scale + rotation](https://mozilla.github.io/pdf.js/examples/)  
- [Nutrient: PDF.js coordinate systems](https://www.nutrient.io/blog/pdfjs-coordinate-systems-pdf-to-screen/)  
- KeepR: `imagePool.rasterizePdfPage` / `import.rasterizePdfPageDirect` (`scale: dpi/72`), `Word.bbox` = stored-master top-left (`export/geometry.ts`), PLAN-3 Lane P coordinate note# PLAN-3 AUDIT — KeepR Batch 3 (ScanSnap)

**Auditor role:** plan master (did not author PLAN-3)  
**House rules source:** `DEVELOPING.md` (no `CLAUDE.md` in repo); patterns from `PLAN-2.md`  
**Slaves:** 5 researchers (Q1–Q5) + local code/docs cross-check  

---

## VERDICT: **revise**

Direction is right (folder path + PDF text layer; no eSCL fantasy). Binding fact on eSCL is **confirmed**. The plan is not executable as written: Lane P under-specifies geometry, useless-layer detection, item→word normalization, and confidence honesty; Lane U under-specifies ScanSnap profile Type and searchable-PDF opt-in. No ownership table, waves, or file contracts (PLAN-2 pattern).

**Minimum to flip approve** (must land in PLAN-3 or SPECs before execute):

1. **Coordinate algorithm locked:** same `page.getViewport({ scale: 200/72 })` as rasterize; `convertToViewportPoint` / 4-corner AABB; never hand-roll “612×792 + y-flip” alone.  
2. **Useless-layer gates** include **degenerate geometry** (wrong positions), not only empty/whitespace/low count.  
3. **pdfjs → `Word[]` adapter** (gap-based re-tokenization + whitespace normalize), not 1:1 item→word.  
4. **Confidence:** fixed high conf alone is unsafe; document policy (moderate fixed conf + provenance `ocr_engine='pdf-text'`; dual-path/adversarial fixture).  
5. **ScanSnap docs:** Type = **`Mac (Scan to file)`** (not Manage-in-Home); searchable PDF = **opt-in**; naming; stability-gate note.  
6. **Architecture:** where text-layer runs (import/OCR provider), how “no tesseract” is proven, file ownership + waves.  
7. **Acceptance expanded** (geometry golden, ABBYY fixture, char-stream, wrong-layer adversarial).

---

## Q1 — ScanSnap eSCL reality · **Build ScanSnap network support? NO**

| Model | Network protocol | ICA / Image Capture | SANE | Native eSCL / `_uscan._tcp` |
|---|---|---|---|---|
| **iX1600 / iX1500 / iX1300** | Wi‑Fi + USB, **proprietary ScanSnap stack only** | No | USB: `sane-fujitsu` **Good**; **“WiFi not supported”** | **No** |
| **iX500** | Same | No (Apple Community) | USB Good; WiFi unsupported | **No** (AirSane #45 = host USB→eSCL bridge, not device) |
| **iX100** | Wi‑Fi + USB, proprietary | No | USB Good; WiFi unsupported | **No** |
| **S1300i** | USB only | No | `sane-epjitsu` + firmware | **No** |
| **SV600** | USB only | No | **Unsupported** in SANE | **No** |

**Primary anchors:** PFU FAQ (no TWAIN/ISIS; must use ScanSnap Home); product specs (“ScanSnap specific driver”); SANE device list + `sane-fujitsu` man page (“Network interfaces are not supported”); `sane-airscan` has no ScanSnap entries.

**Plan binding fact is correct.** Wi‑Fi is for Home/Connect/Cloud, not driverless scan. Do **not** build ScanSnap-specific network support (closed protocol / SDK partnership / reverse-engineering; poor ROI vs folder watch).

**UI nuance:** empty state saying only “USB-only scanners are not supported” is wrong for ScanSnap Wi‑Fi owners. Lane U’s folder route is the right fix; do not imply future eSCL for ScanSnap.

---

## Q2 — ScanSnap Home / Manager (folder path)

### Profile setup (macOS, KeepR-safe)

**Home (recommended):**

1. Scan → Add profile  
2. **Type: `Mac (Scan to file)`** — *not* `Mac (Manage in ScanSnap Home)`  
3. **Save to:** `<library>/New Receipts/`  
4. **Send to / Application: `None (Scan to file)`**  
5. PDF, single multi-page file; rename-dialog **off**  
6. Optional: **Convert to Searchable PDF** (see below)

**Manager (S1300i / older):** Quick Menu **off** → Application **`None (Scan to File)`** → Image saving folder = New Receipts → rename-after-scan **off**.

### Searchable PDF

**Opt-in**, both Home and Manager: checkbox **Convert to Searchable PDF** (Documents type). Not default.

Plan should not imply ScanSnap “always” emits ABBYY layers. KeepR OCR remains the default path unless the user enables it.

### Naming

Home Scan-to-file: File name tab (prefix + serial). Manager: date templates (`yyyy_MM_dd_HH_mm_ss` etc.) or custom serial. Prefer auto names, no post-scan rename dialog.

### Library management after KeepR moves New → Old

| Type | Managed in SSH? | KeepR move after ingest |
|---|---|---|
| **`Mac (Scan to file)`** | **No** — not in content list | **Clean handoff** |
| **`Manage in ScanSnap Home`** | **Yes** — path-tracked | **Breaks library** (“file removed/renamed outside ScanSnap Home”); does **not** re-create at New |

Plan caveat is right in spirit; it must name **Type = Scan to file**, not only “save to folder rather than manage.”

### Atomic write vs 3-obs gate

KeepR: `STABILITY_REQUIRED = 3`, default `pollMs = 4000` (~8s of stable size+mtime).

- Official docs do **not** guarantee write-tmp-then-rename.  
- Recommended unmanaged Scan-to-file + local disk: **usually OK**.  
- Verify/save dialogs, Quick Menu, cloud-synced New Receipts, or OCR rewrite mid-path: residual risk.  
- Docs should recommend the unmanaged profile; optional future hardening: `%EOF` / open-as-PDF check.

---

## Q3 — PDF text → 200 DPI master pixels (Lane P acceptance #4)

**This is the highest-probability subtle bug.**

Raster path already does the right thing:

```ts
page.getViewport({ scale: dpi / 72 })  // rotation defaults to page.rotate
// PNG: Math.ceil(viewport.width/height)
```

`getTextContent()` items are in **unrotated page user space**. `/Rotate` is **not** baked into `item.transform`. Width/height are **user-space** lengths (pdfjs “device space” ≠ pixels). `e,f` are **baseline-left**, not ink top-left.

### Required algorithm (plan must cite)

```
viewport = page.getViewport({ scale: 200/72 })  // SAME as rasterize
// for each TextItem with non-empty str:
//   map PDF corners → viewport.convertToViewportPoint
//   AABB in stored-master top-left pixels
// skip non-TextItem / whitespace-only items
```

Upright rotation-0 special case for view `[0,0,612,792]`:

```
s = 200/72
box ≈ { x: e*s, y: (792 - f - height)*s, w: width*s, h: height*s }
```

Hand-rolling only that formula fails on `/Rotate`, CropBox offset, UserUnit, skew, and baseline/ascent.

**Inverse already exists** in `src/export/geometry.ts` (master → PDF). Lane P is the dual; keep the same invariant: **Word.bbox = stored-master pixel space** (`DEVELOPING.md` rule 6).

---

## Q4 — Useless text layer

Plan gates: no layer / whitespace / low item count.

| State | Plan catches? | What actually separates |
|---|---|---|
| (a) none | Yes | 0 items |
| (b) whitespace | Yes | trim empty |
| (c) junk/partial | Partial | alnum ratio, fffd/cid, receipt money/TOTAL shapes, coverage |
| **(d) good words, wrong positions** | **No** | unique (x,y) ≤ 2 with many items; zero w/h; median font scale absurd; &lt;4 Y-bands on tall page |
| (e) good ABBYY | Accidental | geometry OK + string quality (+ soft Producer prior) |

**Acceptance #4 is unguarded against (d):** FTS works; click-to-assign lies. Industry tools (OCRmyPDF/Paperless) only check *presence* — KeepR cannot copy them because it stores bboxes for UI.

Minimum: Tier-0 geometry reject before `engine: 'pdf-text'`.

---

## Q5 — Trusting embedded text vs tesseract

**Net risk: HIGH** if 1:1 item→`Word` + fixed high confidence.

| Failure | Severity |
|---|---|
| Glyph/char items → `join(' ')` → `T O T A L` breaks `\btotal\b` | **HIGH** |
| pdfjs synthetic in-word spaces (common on ABBYY glyph placement) | **HIGH** |
| Clean-but-wrong layer + high conf → silent wrong total (violates “wrong worse than missing”) | **HIGH** |
| cupsfilter-only calibration | **HIGH** process risk |
| Soft hyphen / ligature / NBSP | MED |
| Line merge under wrong units | MED–HIGH if transform wrong |

`buildLines` (`receipt.ts`) assumes tesseract-like words and `join(' ')`. Corpus unit tests often use text-only path (`words: []`) — they **will not** catch this.

`LOW_CONFIDENCE_THRESHOLD = 0.5` was measured on tesseract correct extractions. Total field conf weights line conf ~10%; **fixed 0.95 on words barely affects total confidence** if TOTAL+money patterns match. “High fixed conf” does not equal safety.

**Mitigations the plan must require:** bbox/gap re-tokenization; whitespace normalize; moderate conf + `ocr_engine='pdf-text'`; dual fixture corpus (ABBYY + image-only + adversarial wrong layer).

---

## RISKS (ordered)

| # | Risk | Level |
|---|---|---|
| R1 | Coordinate transform incomplete → wrong highlights / region assign (acc #4) | **CRITICAL** |
| R2 | Accept (d) misaligned layer → silent geometry poison | **CRITICAL** |
| R3 | Char/run granularity breaks parser → worse than tesseract | **HIGH** |
| R4 | High fixed conf + wrong-but-clean ABBYY → user files wrong money | **HIGH** |
| R5 | Docs omit Type=Scan-to-file → user manages in SSH → broken library after move | **HIGH** (product) |
| R6 | User leaves searchable PDF off → plan oversells ABBYY win; still OK via tesseract | MED |
| R7 | Searchable OCR mid-write vs stability gate (edge) | MED (recommend unmanaged profile) |
| R8 | No architecture: where extract runs / how “no tesseract” proven | MED–HIGH (impl drift) |
| R9 | Plan says field provenance `engine: 'pdf-text'`; fields have conf not engine — real seam is `page.ocr_engine` / `OcrResult.engine` | MED (contract clarity) |
| R10 | ScanSnap network rabbit hole if someone “fixes” empty discovery | LOW if Q1 NO is locked |

---

## GAPS (missing subtasks / untested criteria)

### Structural (vs PLAN-2 / DEVELOPING)

- No **owns** table (paths), no waves, no executor column, no SPECs.  
- No contract change list (if any) for shared types / IPC.  
- Lane U: how “opens New Receipts” works (`shell.openPath` / reveal) + wiring owner (`App.tsx` vs `ScanPanel` props).  
- Lane P: plug-in point — during PDF import before `runOcrJob`, or inside OCR provider short-circuit; must still store raster; must not nest worker pools.

### Lane P technical

- Exact transform + golden test (known item at known pixel).  
- Geometry + encoding useless-layer suite.  
- Adapter: skip space-only items; rejoin glyph runs; soft-hyphen strip.  
- Confidence policy numbers.  
- Per-page fallback (mixed PDF: page 1 good layer, page 2 junk → OCR only page 2).  
- Rotated-page fixture (`/Rotate` 90).  
- Prove no tesseract via `ocr_engine` / mock provider call count (acceptance #1).

### Lane U / docs

- Exact Home Type wording + Manager path.  
- Searchable PDF **opt-in**.  
- Stability / don’t use cloud-synced New Receipts.  
- Empty-state copy (not just USB-only).  
- README status table still says “Scanner (TWAIN/WIA) not built” — align with eSCL-exists + ScanSnap folder story.

### Acceptance missing from PLAN-3

1. ABBYY/ScanSnap searchable fixture (not only cupsfilter).  
2. Glyph-stream unit test → `TOTAL 125.01` after adapter.  
3. Degenerate-position layer → falls back to OCR.  
4. Dual-path disagree / adversarial wrong total → review or not silent high-conf.  
5. `/Rotate 90` word boxes align with raster.  
6. Existing tests 357+ still green; tsc clean.

---

## EXECUTOR per lane

| Lane | Scope | Executor | Reason |
|---|---|---|---|
| **P** | PDF text layer → `Word[]`, geometry, fallback, OCR short-circuit, tests | **Claude (stronger tier) for transform + adapter + golden tests**; Grok OK for plumbing if SPEC is ironclad | Subtle matrix/rotation/baseline bugs; parser calibration risk; highest wrong-money cost. Not “vibe implement from one-liner.” |
| **U** | Scan empty-state route, open New Receipts, README/docs profile | **Grok** | Presentational + docs; low protocol risk if copy is locked in SPEC |
| **Integrate / audit** | Wire P into import/OCR path; prove no tesseract; full test | **Orchestrator / Claude audit after P** | Cross-file; acceptance #1 and #4 are integration truths |

**Not recommended:** Grok alone on P without a written transform SPEC + fixtures.  
**Not recommended:** splitting P’s geometry and parser adapter across two agents without a frozen `OcrResult` adapter contract.

---

## SPLIT (concurrency)

```
        ┌── Lane U (docs + ScanPanel empty state) ──┐
PLAN ──┤                                           ├── integrate → full test
        └── Lane P (pdf-text core + tests) ─────────┘
```

- **U ∥ P** if U only touches `src/ui/scan/**`, README/docs; P owns `src/ingest/**` (or `src/ocr/**`) text-layer modules + tests.  
- **Do not parallelize** two writers on `import.ts` / `ocrRunner.ts`.  
- After both: serial smoke — drop searchable PDF in New Receipts → fields + `ocr_engine=pdf-text` + file in Old; image-only PDF still OCRs; scan dialog button opens folder.

---

## Research answers (short)

| Q | Answer |
|---|---|
| **Q1 eSCL any model?** | **No** confirmed native eSCL/AirScan on listed ScanSnaps. |
| **Q1 build network support?** | **NO** |
| **Q2 managed after save?** | Only if Type = Manage-in-Home → move **breaks** SSH. Scan-to-file = clean. |
| **Q2 searchable default?** | **Opt-in** checkbox. |
| **Q2 atomic write?** | Undocumented; 3-obs OK for recommended profile, not guaranteed for dialog/OCR/cloud. |
| **Q3 transform?** | Use **same viewport as 200 DPI raster**; items unrotated user space; baseline origin; not a one-liner y-flip. |
| **Q4 useless layer?** | Add **geometry + encoding + receipt-shape**; plan misses **(d)**. |
| **Q5 degrade vs tesseract?** | **Yes, HIGH risk** without adapter + conf policy + ABBYY fixtures. |

---

## Product call (locked by this audit)

1. **Do not** build ScanSnap network / ICA / SANE-from-Electron.  
2. **Do** teach Scan-to-file → New Receipts → watcher (already live).  
3. **Do** Lane P, but only after geometry + adapter + expanded acceptance are written into the plan/SPEC.  
4. Until then: **revise**, not execute.

I did not modify any project files.
