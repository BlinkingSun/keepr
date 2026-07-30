-- KeepR — initial schema (migration 001)
--
-- Lane 0 deliverable, owned by the orchestrator. Every other lane compiles
-- against this. Do not alter it in a feature lane; raise a migration instead.
--
-- This file encodes the invariants the plan audit demanded be made structural
-- rather than left to an executor's judgement. The comments marked INVARIANT are
-- not commentary — they are requirements with tests attached.
--
-- CONVENTIONS (one convention each, no exceptions):
--   Money    : INTEGER minor units, column suffix _minor. 84.37 USD -> 8437.
--              Never REAL. A float total in an expense report is a wrong number
--              that looks right, which is the worst failure this app can have.
--   Currency : TEXT ISO-4217 uppercase. Sums NEVER cross currencies.
--   Civil    : business dates are TEXT 'YYYY-MM-DD', no timezone. A receipt
--              dated 2026-07-30 is that date everywhere on earth.
--   Instants : INTEGER unix epoch milliseconds, UTC.
--   Booleans : INTEGER 0/1 with a CHECK.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ---------------------------------------------------------------------------
-- Migration bookkeeping
-- ---------------------------------------------------------------------------
CREATE TABLE schema_migrations (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL UNIQUE,
  checksum    TEXT    NOT NULL,            -- sha256 of the migration text
  applied_at  INTEGER NOT NULL
);
-- The runner also sets PRAGMA user_version to the highest applied id and keeps
-- the two in agreement. A library is a system of record; it must survive every
-- future version, so migrations are forward-only and the runner takes a backup
-- before applying any migration that touches existing rows.

-- ---------------------------------------------------------------------------
-- Cabinet: exactly one row. Profile feeds report cover pages (spec §1, §7).
-- ---------------------------------------------------------------------------
CREATE TABLE cabinet (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  display_name      TEXT,
  profile_json      TEXT,                  -- name, business, address, tax ids
  base_currency     TEXT NOT NULL DEFAULT 'USD',
  settings_json     TEXT,
  created_at        INTEGER NOT NULL,
  modified_at       INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- Folders. Hierarchical, mixed item types (spec §1).
-- ---------------------------------------------------------------------------
CREATE TABLE folder (
  id            INTEGER PRIMARY KEY,
  parent_id     INTEGER REFERENCES folder(id) ON DELETE RESTRICT,
  kind          TEXT    NOT NULL DEFAULT 'user'
                  CHECK (kind IN ('user','inbox','trash')),
  name          TEXT    NOT NULL,
  template      TEXT,
  period_end    TEXT,                      -- civil date; §6 find-missing targets this
  comments      TEXT,
  labels_json   TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  modified_at   INTEGER NOT NULL
);
-- INVARIANT: Inbox is a real folder with kind='inbox', not folder_id NULL.
-- The audit flagged "folder_id NULL = Inbox" as ambiguous: every query would
-- have to remember the special case, and one that forgets silently hides items.
CREATE UNIQUE INDEX folder_one_inbox ON folder(kind) WHERE kind IN ('inbox','trash');
CREATE INDEX folder_parent_idx ON folder(parent_id);

-- ---------------------------------------------------------------------------
-- Lookup lists. User-editable, auto-extended when a new value is typed (§1).
-- ---------------------------------------------------------------------------
CREATE TABLE vendor (
  id                  INTEGER PRIMARY KEY,
  name                TEXT NOT NULL UNIQUE,
  normalized_name     TEXT NOT NULL,       -- lowercased, punctuation stripped
  default_category_id INTEGER REFERENCES category(id) ON DELETE SET NULL,
  is_seed             INTEGER NOT NULL DEFAULT 0 CHECK (is_seed IN (0,1)),
  created_at          INTEGER NOT NULL
);
CREATE INDEX vendor_norm_idx ON vendor(normalized_name);

CREATE TABLE category (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  parent_id  INTEGER REFERENCES category(id) ON DELETE SET NULL,
  is_seed    INTEGER NOT NULL DEFAULT 0 CHECK (is_seed IN (0,1)),
  created_at INTEGER NOT NULL
);

-- Distinct from category, per spec §5 — deductibility / tax-form oriented.
CREATE TABLE tax_category (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  form_ref   TEXT,                          -- e.g. 'Schedule C L22'
  is_seed    INTEGER NOT NULL DEFAULT 0 CHECK (is_seed IN (0,1)),
  created_at INTEGER NOT NULL
);

CREATE TABLE payment_type (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  is_seed    INTEGER NOT NULL DEFAULT 0 CHECK (is_seed IN (0,1)),
  created_at INTEGER NOT NULL
);

CREATE TABLE project (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  client     TEXT,
  code       TEXT,                          -- §11 project/cost-centre codes
  is_seed    INTEGER NOT NULL DEFAULT 0 CHECK (is_seed IN (0,1)),
  created_at INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- Items
-- ---------------------------------------------------------------------------
CREATE TABLE item (
  id              INTEGER PRIMARY KEY,
  folder_id       INTEGER NOT NULL REFERENCES folder(id) ON DELETE RESTRICT,
  type            TEXT NOT NULL CHECK (type IN ('receipt','document','contact')),

  -- Split lifecycle. INVARIANT (audit risk #1, the double-count bug):
  -- when a receipt is split, the origin is marked superseded_at and its role
  -- becomes 'origin'. Children get role 'child' and share split_group_id.
  -- Only rows visible through v_summable_receipts may be summed anywhere:
  -- status bar, folder totals, reports, exports. An origin that remains
  -- summable alongside its children double-counts, and the user would file it.
  split_group_id  INTEGER REFERENCES split_group(id) ON DELETE SET NULL,
  split_role      TEXT CHECK (split_role IN ('origin','child')),
  superseded_at   INTEGER,

  reviewed_at     INTEGER,
  trashed_at      INTEGER,                  -- soft delete; NULL = live
  created_at      INTEGER NOT NULL,
  modified_at     INTEGER NOT NULL,

  -- Biconditional. The earlier form was satisfied whenever split_group_id was
  -- NOT NULL regardless of role, which left "group set, role NULL" legal — an
  -- ambiguous row that still summed.
  CHECK ((split_group_id IS NULL AND split_role IS NULL)
      OR (split_group_id IS NOT NULL AND split_role IS NOT NULL)),
  CHECK (split_role <> 'origin' OR superseded_at IS NOT NULL)
);
CREATE INDEX item_folder_idx     ON item(folder_id);
CREATE INDEX item_trash_idx      ON item(trashed_at);
CREATE INDEX item_split_idx      ON item(split_group_id);
CREATE INDEX item_type_idx       ON item(type);
CREATE INDEX item_reviewed_idx   ON item(reviewed_at);

CREATE TABLE receipt_data (
  item_id           INTEGER PRIMARY KEY REFERENCES item(id) ON DELETE CASCADE,
  txn_date          TEXT,                   -- civil date
  vendor_id         INTEGER REFERENCES vendor(id) ON DELETE SET NULL,
  total_minor       INTEGER,
  currency          TEXT NOT NULL DEFAULT 'USD',
  payment_type_id   INTEGER REFERENCES payment_type(id) ON DELETE SET NULL,
  tax_total_minor   INTEGER,
  category_id       INTEGER REFERENCES category(id) ON DELETE SET NULL,
  tax_category_id   INTEGER REFERENCES tax_category(id) ON DELETE SET NULL,
  project_id        INTEGER REFERENCES project(id) ON DELETE SET NULL,
  -- Renamed from the plan's ambiguous txn_id. This is whatever reference the
  -- merchant printed (invoice/receipt no.), extracted as free text.
  external_ref      TEXT,
  description       TEXT,
  -- Per-field provenance: {field: {value, confidence, bbox, page_id, pinned}}.
  -- 'pinned' means the user corrected it, so re-OCR must not clobber it.
  extraction_json   TEXT,
  -- Sign is NOT constrained: a refund or credit memo is a real receipt, and
  -- blocking negatives would mean the user cannot enter a return at all. The
  -- allocator in src/shared/types.ts handles negative totals for the same
  -- reason. What IS constrained is the currency format, because a malformed
  -- code silently partitions sums into a bucket nothing else joins to.
  CHECK (currency GLOB '[A-Z][A-Z][A-Z]')
);
CREATE INDEX receipt_txn_date_idx ON receipt_data(txn_date);
CREATE INDEX receipt_vendor_idx   ON receipt_data(vendor_id);
CREATE INDEX receipt_total_idx    ON receipt_data(total_minor);

-- Normalized tax lines rather than a JSON blob. The audit's reasoning holds:
-- §7 requires sales-tax and tax-category reports, and a JSON column cannot be
-- grouped or summed without rewriting it later. GST/HST/PST become rows.
CREATE TABLE receipt_tax_line (
  id              INTEGER PRIMARY KEY,
  item_id         INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,            -- 'GST', 'HST', 'PST', 'Sales Tax'
  rate_bp         INTEGER,                  -- basis points; 8.25% = 825
  amount_minor    INTEGER NOT NULL,
  tax_category_id INTEGER REFERENCES tax_category(id) ON DELETE SET NULL,
  CHECK (rate_bp IS NULL OR rate_bp >= 0)
);
CREATE INDEX receipt_tax_item_idx ON receipt_tax_line(item_id);

CREATE TABLE document_data (
  item_id   INTEGER PRIMARY KEY REFERENCES item(id) ON DELETE CASCADE,
  title     TEXT,
  doc_date  TEXT,                            -- civil date
  doc_type  TEXT,
  notes     TEXT
);

CREATE TABLE contact_data (
  item_id         INTEGER PRIMARY KEY REFERENCES item(id) ON DELETE CASCADE,
  first_name      TEXT,
  last_name       TEXT,
  org             TEXT,
  title           TEXT,
  emails_json     TEXT,
  phones_json     TEXT,
  addresses_json  TEXT,
  url             TEXT,
  notes           TEXT
);

-- ---------------------------------------------------------------------------
-- Pages (images)
-- ---------------------------------------------------------------------------
CREATE TABLE page (
  id             INTEGER PRIMARY KEY,
  item_id        INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,
  -- INVARIANT: paths are RELATIVE to the library root. Absolute paths make a
  -- library non-portable, so backup/restore would only work on the machine and
  -- path it was made on — and a Mac-authored library would break on Windows.
  file_relpath   TEXT NOT NULL,
  thumb_relpath  TEXT,
  content_hash   TEXT,                       -- sha256, for dedupe + citation proof
  width          INTEGER,
  height         INTEGER,
  -- INVARIANT (geometry): word bboxes in ocr_words_json are in STORED-MASTER
  -- pixel space, i.e. the pixels of file_relpath as it sits on disk. Rotation
  -- is metadata-only and applied at display/export time; it is NEVER also baked
  -- into the file. Doing both is how the searchable-PDF text layer and the
  -- region-to-field mapping silently drift out of alignment. A crop rewrites
  -- the master and therefore MUST invalidate ocr_* and re-queue OCR.
  rotation       INTEGER NOT NULL DEFAULT 0 CHECK (rotation IN (0,90,180,270)),
  ocr_status     TEXT NOT NULL DEFAULT 'pending'
                   CHECK (ocr_status IN ('pending','queued','running','done','failed','cancelled')),
  ocr_text       TEXT,
  ocr_conf       REAL CHECK (ocr_conf IS NULL OR (ocr_conf >= 0 AND ocr_conf <= 1)),
  ocr_engine     TEXT,
  ocr_words_json TEXT,
  ocr_generation INTEGER NOT NULL DEFAULT 0, -- stale worker results are dropped
  created_at     INTEGER NOT NULL,
  UNIQUE (item_id, seq)
);
CREATE INDEX page_item_idx   ON page(item_id);
CREATE INDEX page_status_idx ON page(ocr_status);
CREATE INDEX page_hash_idx   ON page(content_hash);

-- ---------------------------------------------------------------------------
-- Split groups
-- ---------------------------------------------------------------------------
CREATE TABLE split_group (
  id                  INTEGER PRIMARY KEY,
  origin_item_id      INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  origin_page_id      INTEGER REFERENCES page(id) ON DELETE SET NULL,
  -- Snapshot of the original transaction, taken at split time. Children carry
  -- only their allocated amounts; the origin's figures live here so totals can
  -- always be reconciled against what was actually on the paper.
  origin_total_minor  INTEGER NOT NULL,
  origin_tax_minor    INTEGER,
  currency            TEXT NOT NULL,
  created_at          INTEGER NOT NULL
);
-- INVARIANT (acceptance #7): SUM(children.total_minor) = origin_total_minor,
-- exactly, in minor units. Remainder cents from an uneven division go to the
-- earliest children (largest-remainder): 10000/3 -> 3334, 3333, 3333.
-- All children share one currency — the origin's. Splitting never converts.

-- ---------------------------------------------------------------------------
-- Merge journal — makes "combine, then separate back" actually reversible
-- ---------------------------------------------------------------------------
-- Reassigning pages alone cannot restore the field values of the receipts that
-- were absorbed, so without this table combine is a one-way, lossy operation
-- and acceptance #5 is unmeetable.
CREATE TABLE merge_group (
  id            INTEGER PRIMARY KEY,
  result_item_id INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL
);
CREATE TABLE merge_group_member (
  id                INTEGER PRIMARY KEY,
  merge_group_id    INTEGER NOT NULL REFERENCES merge_group(id) ON DELETE CASCADE,
  page_id           INTEGER NOT NULL REFERENCES page(id) ON DELETE CASCADE,
  pre_merge_item_id INTEGER NOT NULL,
  pre_merge_seq     INTEGER NOT NULL,
  pre_merge_type    TEXT    NOT NULL,
  snapshot_json     TEXT    NOT NULL         -- full row snapshot for restore
);
CREATE INDEX merge_member_group_idx ON merge_group_member(merge_group_id);

-- ---------------------------------------------------------------------------
-- Custom fields (§11 first-class custom fields / templates)
-- ---------------------------------------------------------------------------
CREATE TABLE custom_field_def (
  id         INTEGER PRIMARY KEY,
  scope      TEXT NOT NULL CHECK (scope IN ('receipt','document','contact','folder','all')),
  key        TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  datatype   TEXT NOT NULL CHECK (datatype IN ('text','number','money','date','bool','list')),
  list_name  TEXT,
  required   INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE custom_field_value (
  item_id   INTEGER NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  def_id    INTEGER NOT NULL REFERENCES custom_field_def(id) ON DELETE CASCADE,
  value     TEXT,
  PRIMARY KEY (item_id, def_id)
);

-- ---------------------------------------------------------------------------
-- Rules engine (§1, §3; learns from corrections in Phase 4)
-- ---------------------------------------------------------------------------
CREATE TABLE rule (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL,                 -- 'vendor_to_category', ...
  match_json  TEXT NOT NULL,
  action_json TEXT NOT NULL,
  priority    INTEGER NOT NULL DEFAULT 100,
  source      TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('seed','user','learned')),
  hit_count   INTEGER NOT NULL DEFAULT 0,
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_at  INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- Jobs — persisted so import/OCR progress survives a restart, and so the test
-- API has something real to poll (acceptance #1).
-- ---------------------------------------------------------------------------
CREATE TABLE job (
  id            TEXT PRIMARY KEY,            -- uuid
  kind          TEXT NOT NULL CHECK (kind IN ('import','ocr','export','backup','restore','archive')),
  status        TEXT NOT NULL CHECK (status IN ('queued','running','done','failed','cancelled','partial')),
  total_units   INTEGER NOT NULL DEFAULT 0,
  done_units    INTEGER NOT NULL DEFAULT 0,
  failed_units  INTEGER NOT NULL DEFAULT 0,
  detail_json   TEXT,
  error         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX job_status_idx ON job(status);
-- 'partial' is deliberate: a 10-page PDF where page 7 fails OCR is neither a
-- success nor a failure, and collapsing it to either one loses the truth.

-- ---------------------------------------------------------------------------
-- Maintenance logs (§9)
-- ---------------------------------------------------------------------------
CREATE TABLE backup_log (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('manual','scheduled')),
  path        TEXT NOT NULL,
  db_sha256   TEXT,
  manifest_json TEXT,
  size_bytes  INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE TABLE archive_log (
  id            INTEGER PRIMARY KEY,
  path          TEXT NOT NULL,
  cutoff_date   TEXT NOT NULL,
  items_moved   INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);

-- ===========================================================================
-- FULL-TEXT SEARCH
-- ===========================================================================
-- The plan referenced content='item_search_src' without ever defining that
-- table, so item_fts could not have been created as written. It is a real
-- table, maintained by triggers, denormalizing the human-readable text of an
-- item so one FTS index covers vendor/description/notes/title/org.

CREATE TABLE item_search_src (
  id          INTEGER PRIMARY KEY REFERENCES item(id) ON DELETE CASCADE,
  vendor      TEXT,
  description TEXT,
  notes       TEXT,
  title       TEXT,
  org         TEXT
);

CREATE VIRTUAL TABLE page_fts USING fts5(
  ocr_text,
  content='page', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE item_fts USING fts5(
  vendor, description, notes, title, org,
  content='item_search_src', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

-- External-content FTS5 does NOT self-synchronize. These triggers are the only
-- thing keeping search from going silently stale after an edit.
CREATE TRIGGER page_fts_ai AFTER INSERT ON page BEGIN
  INSERT INTO page_fts(rowid, ocr_text) VALUES (new.id, new.ocr_text);
END;
CREATE TRIGGER page_fts_ad AFTER DELETE ON page BEGIN
  INSERT INTO page_fts(page_fts, rowid, ocr_text) VALUES ('delete', old.id, old.ocr_text);
END;
CREATE TRIGGER page_fts_au AFTER UPDATE OF ocr_text ON page BEGIN
  INSERT INTO page_fts(page_fts, rowid, ocr_text) VALUES ('delete', old.id, old.ocr_text);
  INSERT INTO page_fts(rowid, ocr_text) VALUES (new.id, new.ocr_text);
END;

CREATE TRIGGER item_fts_ai AFTER INSERT ON item_search_src BEGIN
  INSERT INTO item_fts(rowid, vendor, description, notes, title, org)
  VALUES (new.id, new.vendor, new.description, new.notes, new.title, new.org);
END;
CREATE TRIGGER item_fts_ad AFTER DELETE ON item_search_src BEGIN
  INSERT INTO item_fts(item_fts, rowid, vendor, description, notes, title, org)
  VALUES ('delete', old.id, old.vendor, old.description, old.notes, old.title, old.org);
END;
CREATE TRIGGER item_fts_au AFTER UPDATE ON item_search_src BEGIN
  INSERT INTO item_fts(item_fts, rowid, vendor, description, notes, title, org)
  VALUES ('delete', old.id, old.vendor, old.description, old.notes, old.title, old.org);
  INSERT INTO item_fts(rowid, vendor, description, notes, title, org)
  VALUES (new.id, new.vendor, new.description, new.notes, new.title, new.org);
END;

-- item_search_src is maintained BY TRIGGER, not by application code. It was
-- originally left to the repository layer, which meant any write path an
-- executor forgot would silently rot structured search — a failure with no
-- symptom until someone cannot find a receipt they know exists. Deriving it in
-- SQL means there is no write path to forget.

CREATE TRIGGER iss_receipt_ai AFTER INSERT ON receipt_data BEGIN
  INSERT INTO item_search_src(id, vendor, description)
  VALUES (new.item_id, (SELECT name FROM vendor WHERE id = new.vendor_id), new.description)
  ON CONFLICT(id) DO UPDATE SET
    vendor = (SELECT name FROM vendor WHERE id = new.vendor_id),
    description = new.description;
END;
CREATE TRIGGER iss_receipt_au AFTER UPDATE OF vendor_id, description ON receipt_data BEGIN
  INSERT INTO item_search_src(id, vendor, description)
  VALUES (new.item_id, (SELECT name FROM vendor WHERE id = new.vendor_id), new.description)
  ON CONFLICT(id) DO UPDATE SET
    vendor = (SELECT name FROM vendor WHERE id = new.vendor_id),
    description = new.description;
END;

CREATE TRIGGER iss_document_ai AFTER INSERT ON document_data BEGIN
  INSERT INTO item_search_src(id, title, notes) VALUES (new.item_id, new.title, new.notes)
  ON CONFLICT(id) DO UPDATE SET title = new.title, notes = new.notes;
END;
CREATE TRIGGER iss_document_au AFTER UPDATE OF title, notes ON document_data BEGIN
  INSERT INTO item_search_src(id, title, notes) VALUES (new.item_id, new.title, new.notes)
  ON CONFLICT(id) DO UPDATE SET title = new.title, notes = new.notes;
END;

CREATE TRIGGER iss_contact_ai AFTER INSERT ON contact_data BEGIN
  INSERT INTO item_search_src(id, org, title, notes)
  VALUES (new.item_id, new.org, new.title, new.notes)
  ON CONFLICT(id) DO UPDATE SET org = new.org, title = new.title, notes = new.notes;
END;
CREATE TRIGGER iss_contact_au AFTER UPDATE OF org, title, notes ON contact_data BEGIN
  INSERT INTO item_search_src(id, org, title, notes)
  VALUES (new.item_id, new.org, new.title, new.notes)
  ON CONFLICT(id) DO UPDATE SET org = new.org, title = new.title, notes = new.notes;
END;

-- Renaming a vendor refreshes every item that referenced it, or search keeps
-- finding those receipts by the vendor's old name forever.
CREATE TRIGGER iss_vendor_rename AFTER UPDATE OF name ON vendor BEGIN
  UPDATE item_search_src SET vendor = new.name
   WHERE id IN (SELECT item_id FROM receipt_data WHERE vendor_id = new.id);
END;

-- Clearing the side table must clear its search text. Normally these rows only
-- die with their item via CASCADE, but converting an item between types deletes
-- the old side table, and without these the item stayed findable by text it no
-- longer has.
CREATE TRIGGER iss_receipt_ad AFTER DELETE ON receipt_data BEGIN
  UPDATE item_search_src SET vendor = NULL, description = NULL WHERE id = old.item_id;
END;
CREATE TRIGGER iss_document_ad AFTER DELETE ON document_data BEGIN
  UPDATE item_search_src SET title = NULL, notes = NULL WHERE id = old.item_id;
END;
CREATE TRIGGER iss_contact_ad AFTER DELETE ON contact_data BEGIN
  UPDATE item_search_src SET org = NULL, title = NULL, notes = NULL WHERE id = old.item_id;
END;

-- Any migration that rewrites content must run:
--   INSERT INTO page_fts(page_fts) VALUES('rebuild');
--   INSERT INTO item_fts(item_fts) VALUES('rebuild');

-- ===========================================================================
-- CANONICAL VIEWS — the only sanctioned way to sum or list
-- ===========================================================================

-- INVARIANT: every total shown to the user or written to an export comes from
-- here. Not from item, not from receipt_data directly. This single view is what
-- prevents trashed items and superseded split origins from being counted.
CREATE VIEW v_summable_receipts AS
SELECT r.item_id, i.folder_id, r.txn_date, r.vendor_id, r.total_minor,
       r.currency, r.tax_total_minor, r.category_id, r.tax_category_id,
       r.project_id, i.split_group_id, i.reviewed_at
FROM receipt_data r
JOIN item i ON i.id = r.item_id
WHERE i.trashed_at    IS NULL
  AND i.superseded_at IS NULL
  AND i.type = 'receipt';

-- Resolves which page images an item may legitimately display or embed.
-- A split child owns no page rows: it cites the origin's image. This is why
-- deleting one child cannot orphan the shared image for its siblings, and why
-- the file is stored once rather than copied three times.
-- A child cites origin_page_id when the split named a specific page, otherwise
-- every page of the origin. Previously origin_page_id was declared but ignored,
-- so the column implied a precision the view did not deliver.
CREATE VIEW v_item_pages AS
SELECT i.id AS item_id, p.id AS page_id, p.seq, p.file_relpath,
       p.thumb_relpath, p.rotation, p.content_hash, 0 AS via_split
FROM item i JOIN page p ON p.item_id = i.id
UNION ALL
SELECT c.id AS item_id, p.id AS page_id, p.seq, p.file_relpath,
       p.thumb_relpath, p.rotation, p.content_hash, 1 AS via_split
FROM item c
JOIN split_group sg ON sg.id = c.split_group_id AND c.split_role = 'child'
JOIN page p ON p.item_id = sg.origin_item_id
           AND (sg.origin_page_id IS NULL OR p.id = sg.origin_page_id);

-- ===========================================================================
-- STATE-TRANSITION GUARDS
-- ===========================================================================
-- The re-audit's central finding: CHECK constraints only police the shape of a
-- single row at write time, so the double-count was never structural. This was
-- legal SQL and it reopened the bug:
--
--   UPDATE item SET split_group_id=NULL, split_role=NULL, superseded_at=NULL
--    WHERE id = <origin>;    -- view sum silently goes 10000 -> 20000
--
-- Shapes are not enough; the TRANSITIONS have to be illegal too. These triggers
-- are what make the invariant real. "Only sum through the view" was process;
-- this is enforcement.

-- ANY child blocks the unwind, including a soft-trashed one.
--
-- Restricting this to live children left a working attack through two supported
-- features. Soft-trash is the normal delete and restore is acceptance #10, so:
--   1. split $100 -> origin superseded + 3 children
--   2. soft-trash all three children      (ordinary delete)
--   3. clear the origin's split flags     (allowed: no LIVE children)
--   4. restore the children               (ordinary restore)
--   5. sum is 20000 again
-- Trashed children are not gone, they are recoverable, so they must keep
-- blocking the unwind exactly as the purge guard treats them.
--
-- Dissolving a split is still possible, by the same order empty-trash uses:
-- hard-delete the children first (permitted — the purge guard only protects the
-- origin), then unwind the origin.
CREATE TRIGGER item_split_no_unwind BEFORE UPDATE ON item
WHEN old.split_role = 'origin'
 AND (new.split_role IS NOT 'origin'
   OR new.superseded_at IS NULL
   OR new.split_group_id IS NOT old.split_group_id)
 AND EXISTS (SELECT 1 FROM item c
             WHERE c.split_group_id = old.split_group_id
               AND c.split_role = 'child'
               AND c.id <> old.id)
BEGIN
  SELECT RAISE(ABORT, 'KeepR: cannot un-supersede or detach a split origin while children exist (hard-delete them first to dissolve the split)');
END;

-- A child may not become an origin at all. Previously only the
-- non-superseded case was blocked, which allowed two split_role='origin' rows
-- in one group and polluted purge and citation semantics.
CREATE TRIGGER item_split_child_no_promote BEFORE UPDATE ON item
WHEN old.split_role = 'child' AND new.split_role = 'origin'
BEGIN
  SELECT RAISE(ABORT, 'KeepR: a split child cannot become an origin');
END;

-- Mirror of the unwind guard, for children. Without it a child could walk out of
-- its group: its image citation breaks, and if every child leaves, the origin
-- stays superseded holding the full historical total, so the money silently
-- disappears from every total in the application.
CREATE TRIGGER item_split_child_no_detach BEFORE UPDATE ON item
WHEN old.split_role = 'child'
 AND (new.split_role IS NULL
   OR new.split_group_id IS NULL
   OR new.split_group_id IS NOT old.split_group_id)
 AND EXISTS (SELECT 1 FROM split_group sg WHERE sg.id = old.split_group_id)
BEGIN
  SELECT RAISE(ABORT, 'KeepR: a split child cannot leave its group — dissolve the whole split instead');
END;

-- Purge policy: the split group is the unit of deletion. Without this, deleting
-- an origin failed deep inside an ON DELETE SET NULL / CHECK interaction with an
-- opaque message, and the superseded shell could become permanently undeletable.
CREATE TRIGGER item_split_origin_purge_guard BEFORE DELETE ON item
WHEN old.split_role = 'origin'
 AND EXISTS (SELECT 1 FROM item c
             WHERE c.split_group_id = old.split_group_id
               AND c.split_role = 'child'
               AND c.id <> old.id)
BEGIN
  SELECT RAISE(ABORT, 'KeepR: purge the split children first — the split group is the unit of deletion');
END;

-- Citation integrity: a page that live split children point at cannot be deleted
-- out from under them, which would leave those children citing nothing.
-- Like the unwind guard, this counts ANY child, not only live ones. A
-- soft-trashed child is restorable, and if its cited page were deleted in the
-- meantime it would come back pointing at nothing.
CREATE TRIGGER page_cited_delete_guard BEFORE DELETE ON page
WHEN EXISTS (
  SELECT 1 FROM split_group sg
  JOIN item c ON c.split_group_id = sg.id
             AND c.split_role = 'child'
  WHERE sg.origin_item_id = old.item_id
    AND (sg.origin_page_id = old.id
      OR (sg.origin_page_id IS NULL
          AND (SELECT COUNT(*) FROM page p2 WHERE p2.item_id = old.item_id) = 1))
)
BEGIN
  SELECT RAISE(ABORT, 'KeepR: this page is the cited image for live split children');
END;

-- Merge x split ordering. Both journals could previously exist at once, leaving
-- separate-back undefined: children cite origin pages that separate wants to
-- hand back to the pre-merge items.
CREATE TRIGGER item_no_split_of_active_merge BEFORE UPDATE ON item
WHEN new.split_role = 'origin'
 AND (old.split_role IS NULL OR old.split_role IS NOT 'origin')
 AND EXISTS (SELECT 1 FROM merge_group mg WHERE mg.result_item_id = new.id)
BEGIN
  SELECT RAISE(ABORT, 'KeepR: separate this combined item before splitting it');
END;

-- The mirror guard. With both in place the "combined AND split" state is
-- unreachable from either direction, which is stronger than blocking the
-- separate-back afterwards: there is no bad state to recover from.
CREATE TRIGGER merge_no_combine_of_split BEFORE INSERT ON merge_group
WHEN EXISTS (SELECT 1 FROM item i
             WHERE i.id = new.result_item_id AND i.split_group_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'KeepR: cannot combine into an item that is part of a split');
END;

-- Defence in depth. Given the two guards above this should be unreachable, but a
-- future migration that relaxes one of them would otherwise silently re-open
-- lossy separate-back.
CREATE TRIGGER merge_no_separate_after_split BEFORE DELETE ON merge_group
WHEN EXISTS (SELECT 1 FROM item i
             WHERE i.id = old.result_item_id AND i.split_group_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'KeepR: cannot separate a combined item that has since been split');
END;

-- Single trash model. folder.kind='trash' is a NAVIGATION node only; item
-- membership is decided solely by item.trashed_at. Allowing both would let the
-- Trash list and the trash badge disagree.
CREATE TRIGGER item_no_trash_folder_assign BEFORE INSERT ON item
WHEN (SELECT kind FROM folder WHERE id = new.folder_id) = 'trash'
BEGIN
  SELECT RAISE(ABORT, 'KeepR: items are never stored in the trash folder — set trashed_at instead');
END;
CREATE TRIGGER item_no_trash_folder_move BEFORE UPDATE OF folder_id ON item
WHEN (SELECT kind FROM folder WHERE id = new.folder_id) = 'trash'
BEGIN
  SELECT RAISE(ABORT, 'KeepR: items are never stored in the trash folder — set trashed_at instead');
END;

-- Split children inherit the origin's currency. A split never converts money.
-- Guarded on INSERT as well as UPDATE: children are created after their item row
-- exists, so an UPDATE-only guard let the very first write set a foreign currency
-- and only surfaced later as a reconciliation mismatch nobody was checking.
CREATE TRIGGER receipt_split_currency_guard_ins BEFORE INSERT ON receipt_data
WHEN EXISTS (SELECT 1 FROM item i JOIN split_group sg ON sg.id = i.split_group_id
             WHERE i.id = new.item_id AND i.split_role = 'child'
               AND sg.currency <> new.currency)
BEGIN
  SELECT RAISE(ABORT, 'KeepR: a split child must keep its split group currency');
END;
CREATE TRIGGER receipt_split_currency_guard BEFORE UPDATE OF currency ON receipt_data
WHEN EXISTS (SELECT 1 FROM item i JOIN split_group sg ON sg.id = i.split_group_id
             WHERE i.id = new.item_id AND i.split_role = 'child'
               AND sg.currency <> new.currency)
BEGIN
  SELECT RAISE(ABORT, 'KeepR: a split child must keep its split group currency');
END;

-- ===========================================================================
-- MORE CANONICAL VIEWS
-- ===========================================================================

-- Tax had no gated path, so after a split SUM(tax) over summable receipts
-- returned 0 while the superseded origin still held the real tax lines: tax
-- silently vanished from the status bar and every tax report.
CREATE VIEW v_summable_tax AS
SELECT tl.id AS tax_line_id, tl.item_id, v.folder_id, v.currency,
       tl.label, tl.rate_bp, tl.tax_category_id, tl.amount_minor
FROM receipt_tax_line tl
JOIN v_summable_receipts v ON v.item_id = tl.item_id;

-- Totals are ALWAYS grouped by currency. A single blended number across USD and
-- EUR is not a total, it is a lie with a dollar sign in front of it.
CREATE VIEW v_folder_totals AS
SELECT folder_id, currency,
       COUNT(*)                                              AS item_count,
       SUM(COALESCE(total_minor, 0))                         AS total_minor,
       SUM(COALESCE(tax_total_minor, 0))                     AS tax_minor,
       SUM(CASE WHEN total_minor  IS NULL THEN 1 ELSE 0 END) AS missing_amount_count,
       SUM(CASE WHEN reviewed_at  IS NULL THEN 1 ELSE 0 END) AS unreviewed_count
FROM v_summable_receipts
GROUP BY folder_id, currency;

-- Every split group's arithmetic, exposed for assertion. SQLite has no deferred
-- CHECK, so a mid-transaction split cannot be constrained row-by-row; instead
-- the repository asserts this view shows zero drift before it commits, and the
-- test suite asserts it is empty of drift at rest.
CREATE VIEW v_split_reconciliation AS
SELECT sg.id AS split_group_id,
       sg.origin_item_id,
       sg.origin_total_minor,
       sg.origin_tax_minor,
       sg.currency,
       COUNT(c.id)                                  AS child_count,
       COALESCE(SUM(cr.total_minor), 0)             AS children_total_minor,
       COALESCE(SUM(cr.total_minor), 0) - sg.origin_total_minor        AS drift_minor,
       COALESCE(SUM(cr.tax_total_minor), 0)         AS children_tax_minor,
       COALESCE(SUM(cr.tax_total_minor), 0) - COALESCE(sg.origin_tax_minor, 0) AS tax_drift_minor,
       SUM(CASE WHEN cr.currency <> sg.currency THEN 1 ELSE 0 END)     AS currency_mismatch_count
FROM split_group sg
LEFT JOIN item c        ON c.split_group_id = sg.id AND c.split_role = 'child' AND c.trashed_at IS NULL
LEFT JOIN receipt_data cr ON cr.item_id = c.id
GROUP BY sg.id;

-- Search must read pages through here. page_fts indexes OCR text regardless of
-- whether the owning item is trashed, so a raw MATCH surfaces deleted receipts.
CREATE VIEW v_searchable_pages AS
SELECT p.id AS page_id, p.item_id, i.folder_id, i.type
FROM page p
JOIN item i ON i.id = p.item_id
WHERE i.trashed_at IS NULL;

-- Receipts missing key data (§6 "Find Missing Key Data").
CREATE VIEW v_missing_key_data AS
SELECT v.item_id, v.folder_id,
       CASE WHEN v.vendor_id       IS NULL THEN 1 ELSE 0 END AS missing_vendor,
       CASE WHEN v.txn_date        IS NULL THEN 1 ELSE 0 END AS missing_date,
       CASE WHEN v.total_minor     IS NULL THEN 1 ELSE 0 END AS missing_total,
       CASE WHEN v.category_id     IS NULL THEN 1 ELSE 0 END AS missing_category,
       CASE WHEN v.tax_category_id IS NULL THEN 1 ELSE 0 END AS missing_tax_category
FROM v_summable_receipts v
WHERE v.vendor_id IS NULL OR v.txn_date IS NULL OR v.total_minor IS NULL
   OR v.category_id IS NULL OR v.tax_category_id IS NULL;
