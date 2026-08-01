-- KeepR migration 002 — original source files
--
-- Batch-2 audit finding (CRITICAL/HIGH): duplicate detection was specified
-- against page.content_hash, but pages store RASTERIZED images. A PDF's pages
-- hash as PNGs, not as the PDF's own bytes, so a re-dropped PDF would never
-- match — and the watcher's crash-window self-heal would re-import it forever.
-- vCards have no pages at all, so contacts could never dedupe.
--
-- The fix is to record the ORIGINAL bytes of whatever produced each item, once,
-- uniformly. The original file is also preserved in the content-addressed store
-- (a real fidelity win: the actual PDF a vendor sent survives, not only our
-- rasterization of it), and its hash becomes the single dedupe key for every
-- import path: images, PDFs, vCards, scans.

CREATE TABLE item_source_file (
  item_id        INTEGER PRIMARY KEY REFERENCES item(id) ON DELETE CASCADE,
  -- sha256 of the source file's bytes, lowercase hex. THE dedupe key.
  source_sha256  TEXT    NOT NULL,
  -- Where the original bytes live in the content-addressed store,
  -- library-relative like every other media path.
  source_relpath TEXT    NOT NULL,
  -- The filename the user last saw ("HD receipt july.pdf"), for provenance
  -- display; never used for resolution.
  original_name  TEXT,
  created_at     INTEGER NOT NULL
);

-- Non-unique on purpose: the same source can legitimately be imported into two
-- items when the user forces it; skipDuplicates consults this index, it is not
-- a constraint.
CREATE INDEX item_source_sha_idx ON item_source_file(source_sha256);
