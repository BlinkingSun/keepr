import type {
  LibraryRelPath,
  OcrResult,
  OcrStatus,
  ResolvedPage,
  Rotation,
  Sha256,
} from '../../shared/types.ts'
import { asRelPath } from '../../shared/types.ts'
import type { Database } from './types.ts'

interface ResolvedPageRow {
  item_id: number
  page_id: number
  seq: number
  file_relpath: string
  thumb_relpath: string | null
  rotation: number
  content_hash: string | null
  via_split: number
}

function mapResolved(r: ResolvedPageRow): ResolvedPage {
  return {
    itemId: r.item_id,
    pageId: r.page_id,
    seq: r.seq,
    fileRelPath: asRelPath(r.file_relpath),
    thumbRelPath: r.thumb_relpath ? asRelPath(r.thumb_relpath) : null,
    rotation: r.rotation as Rotation,
    contentHash: (r.content_hash as Sha256 | null) ?? null,
    viaSplit: r.via_split === 1,
  }
}

export class PagesRepo {
  private readonly db: Database

  constructor(db: Database) {
    this.db = db
  }

  /** Pages for an item via v_item_pages (split children cite origin images). */
  listForItem(itemId: number): ResolvedPage[] {
    const rows = this.db
      .prepare(
        `SELECT item_id, page_id, seq, file_relpath, thumb_relpath, rotation, content_hash, via_split
           FROM v_item_pages
          WHERE item_id = ?
          ORDER BY seq, page_id`,
      )
      .all(itemId) as ResolvedPageRow[]
    return rows.map(mapResolved)
  }

  add(input: {
    itemId: number
    fileRelPath: LibraryRelPath | string
    thumbRelPath?: LibraryRelPath | string | null
    contentHash?: string | null
    width?: number | null
    height?: number | null
    seq?: number
  }): { pageId: number } {
    const now = Date.now()
    let seq = input.seq
    if (seq === undefined) {
      const max = this.db
        .prepare(`SELECT COALESCE(MAX(seq), 0) AS m FROM page WHERE item_id = ?`)
        .get(input.itemId) as { m: number }
      seq = max.m + 1
    }
    const result = this.db
      .prepare(
        `INSERT INTO page(
           item_id, seq, file_relpath, thumb_relpath, content_hash,
           width, height, rotation, ocr_status, ocr_generation, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pending', 0, ?)`,
      )
      .run(
        input.itemId,
        seq,
        String(input.fileRelPath),
        input.thumbRelPath != null ? String(input.thumbRelPath) : null,
        input.contentHash ?? null,
        input.width ?? null,
        input.height ?? null,
        now,
      )
    return { pageId: Number(result.lastInsertRowid) }
  }

  /**
   * Rewrite seq densely 1..n in one transaction for the given page order.
   * All pageIds must belong to itemId.
   */
  reorder(itemId: number, pageIdsInOrder: number[]): { ok: boolean; reason?: string } {
    if (pageIdsInOrder.length === 0) return { ok: true }

    const existing = this.db
      .prepare(`SELECT id FROM page WHERE item_id = ? ORDER BY seq, id`)
      .all(itemId) as Array<{ id: number }>
    const existingIds = new Set(existing.map((r) => r.id))
    if (existingIds.size !== pageIdsInOrder.length) {
      return { ok: false, reason: 'pageIdsInOrder must include every page of the item' }
    }
    for (const id of pageIdsInOrder) {
      if (!existingIds.has(id)) {
        return { ok: false, reason: `page ${id} is not on item ${itemId}` }
      }
    }

    const run = this.db.transaction(() => {
      // Two-phase rewrite avoids UNIQUE(item_id, seq) collisions mid-update.
      const offset = 1_000_000
      const upd = this.db.prepare(`UPDATE page SET seq = ? WHERE id = ? AND item_id = ?`)
      for (let i = 0; i < pageIdsInOrder.length; i++) {
        const pageId = pageIdsInOrder[i]
        if (pageId === undefined) continue
        upd.run(offset + i, pageId, itemId)
      }
      for (let i = 0; i < pageIdsInOrder.length; i++) {
        const pageId = pageIdsInOrder[i]
        if (pageId === undefined) continue
        upd.run(i + 1, pageId, itemId)
      }
    })
    run()
    return { ok: true }
  }

  setRotation(pageId: number, rotation: Rotation): { ok: boolean; reason?: string } {
    if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) {
      return { ok: false, reason: 'rotation must be 0, 90, 180, or 270' }
    }
    const result = this.db.prepare(`UPDATE page SET rotation = ? WHERE id = ?`).run(rotation, pageId)
    if (result.changes === 0) return { ok: false, reason: 'page not found' }
    return { ok: true }
  }

  delete(pageId: number): { ok: boolean; reason?: string } {
    try {
      const result = this.db.prepare(`DELETE FROM page WHERE id = ?`).run(pageId)
      if (result.changes === 0) return { ok: false, reason: 'page not found' }
      return { ok: true }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false, reason: msg }
    }
  }

  /**
   * Apply an OCR result only when generation still matches the page row.
   * A slow OCR job finishing after the user edited the image must not clobber it.
   */
  setOcrResult(
    pageId: number,
    result: Pick<OcrResult, 'text' | 'words' | 'confidence' | 'engine' | 'generation'>,
  ): { applied: boolean; reason?: string } {
    const row = this.db
      .prepare(`SELECT ocr_generation, ocr_text, ocr_status FROM page WHERE id = ?`)
      .get(pageId) as
      | { ocr_generation: number; ocr_text: string | null; ocr_status: string }
      | undefined

    if (!row) return { applied: false, reason: 'page not found' }
    if (row.ocr_generation !== result.generation) {
      return {
        applied: false,
        reason: `stale generation: result=${result.generation}, page=${row.ocr_generation}`,
      }
    }

    const wordsJson = result.words != null ? JSON.stringify(result.words) : null
    this.db
      .prepare(
        `UPDATE page
            SET ocr_status = 'done',
                ocr_text = ?,
                ocr_conf = ?,
                ocr_engine = ?,
                ocr_words_json = ?
          WHERE id = ? AND ocr_generation = ?`,
      )
      .run(result.text, result.confidence, result.engine, wordsJson, pageId, result.generation)

    // Re-check: concurrent bump could still race the WHERE.
    const after = this.db
      .prepare(`SELECT ocr_text, ocr_generation FROM page WHERE id = ?`)
      .get(pageId) as { ocr_text: string | null; ocr_generation: number } | undefined
    if (!after || after.ocr_generation !== result.generation || after.ocr_text !== result.text) {
      return { applied: false, reason: 'generation raced; result discarded' }
    }
    return { applied: true }
  }

  /** Bump ocr_generation and clear OCR fields (e.g. after crop). */
  invalidateOcr(pageId: number): { ok: boolean } {
    this.db
      .prepare(
        `UPDATE page
            SET ocr_generation = ocr_generation + 1,
                ocr_status = 'pending',
                ocr_text = NULL,
                ocr_conf = NULL,
                ocr_engine = NULL,
                ocr_words_json = NULL
          WHERE id = ?`,
      )
      .run(pageId)
    return { ok: true }
  }

  setOcrStatus(pageId: number, status: OcrStatus): void {
    this.db.prepare(`UPDATE page SET ocr_status = ? WHERE id = ?`).run(status, pageId)
  }
}
