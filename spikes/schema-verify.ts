/**
 * Adversarial schema verification for KeepR.
 * Run: node --experimental-strip-types spikes/schema-verify.ts
 *
 * The previous version of this file was too weak for what it claimed. It
 * computed the split parts inside the test, so it verified my arithmetic rather
 * than the system's; it never attacked the invariants; and "24 assertions
 * passing" was compatible with tax vanishing, trashed items staying searchable,
 * and the double-count being one UPDATE away from returning.
 *
 * This version imports the REAL allocator from src/shared/types.ts and tries to
 * break every invariant the schema claims.
 */
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { allocate, asMinor } from '../src/shared/types.ts'

const sql = readFileSync(new URL('../src/db/schema/001_initial.sql', import.meta.url), 'utf8')
const db = new Database(':memory:')
const now = 1753900000000
let failures = 0

const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) failures++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}
/** Asserts a statement is REJECTED, and that it is rejected for the right reason. */
const rejects = (name: string, fn: () => void, expectFragment = '') => {
  let msg = ''
  try { fn(); check(name, false, 'statement was ALLOWED but must be rejected'); return } catch (e: any) { msg = e.message }
  const right = !expectFragment || msg.includes(expectFragment)
  check(name, right, right ? `rejected: "${msg.slice(0, 70)}"` : `rejected for the WRONG reason: ${msg}`)
}

db.exec(sql)
db.pragma('foreign_keys = ON')
console.log('schema executed\n')

/** Currency-scoped on purpose. An earlier version of this helper summed across
 *  every currency and reported 15000 for 10000 USD + 5000 EUR — committing the
 *  exact mistake v_folder_totals exists to prevent, inside the test suite meant
 *  to catch it. Totals are always per-currency. */
const sum = (cur = 'USD') =>
  db.prepare('select coalesce(sum(total_minor),0) s from v_summable_receipts where currency=?').get(cur).s as number
const taxSum = (cur = 'USD') =>
  db.prepare('select coalesce(sum(amount_minor),0) s from v_summable_tax where currency=?').get(cur).s as number

/* ---- seed ---- */
db.prepare('insert into cabinet(id,display_name,base_currency,created_at,modified_at) values (1,?,?,?,?)').run('T', 'USD', now, now)
db.prepare("insert into folder(id,kind,name,created_at,modified_at) values (1,'inbox','Inbox',?,?)").run(now, now)
db.prepare("insert into folder(id,kind,name,created_at,modified_at) values (2,'user','Materials',?,?)").run(now, now)
db.prepare("insert into folder(id,kind,name,created_at,modified_at) values (3,'trash','Trash',?,?)").run(now, now)
db.prepare('insert into category(id,name,created_at) values (1,?,?)').run('Materials', now)
db.prepare('insert into category(id,name,created_at) values (2,?,?)').run('Fuel', now)
db.prepare('insert into tax_category(id,name,created_at) values (1,?,?)').run('Standard', now)
db.prepare('insert into vendor(id,name,normalized_name,default_category_id,created_at) values (1,?,?,1,?)').run('Home Depot', 'home depot', now)

const mkItem = (folder: number, type: string, e: any = {}) =>
  db.prepare(`insert into item(folder_id,type,split_group_id,split_role,superseded_at,created_at,modified_at)
    values (?,?,?,?,?,?,?)`).run(folder, type, e.sg ?? null, e.role ?? null, e.sup ?? null, now, now).lastInsertRowid as number

/* ---- origin receipt: $100.00 with $8.25 tax, one page ---- */
const origin = mkItem(2, 'receipt')
db.prepare(`insert into receipt_data(item_id,txn_date,vendor_id,total_minor,currency,tax_total_minor,category_id)
  values (?,?,?,?,?,?,?)`).run(origin, '2026-07-12', 1, 10000, 'USD', 825, 1)
db.prepare('insert into receipt_tax_line(item_id,label,rate_bp,amount_minor,tax_category_id) values (?,?,?,?,?)')
  .run(origin, 'Sales Tax', 825, 825, 1)
db.prepare(`insert into page(item_id,seq,file_relpath,content_hash,ocr_status,ocr_text,ocr_conf,created_at)
  values (?,?,?,?,?,?,?,?)`).run(origin, 1, 'images/o1.jpg', 'sha-abc', 'done', 'HOME DEPOT zzuniquetoken TOTAL 100.00', 0.91, now)

console.log('-- baseline --')
check('sum before split is 10000', sum() === 10000)
check('tax before split is 825', taxSum() === 825)
check('item_search_src auto-populated by trigger (no manual write)',
  db.prepare('select vendor from item_search_src where id=?').get(origin)?.vendor === 'Home Depot')

/* ---- the split, using the REAL allocator ---- */
console.log('\n-- split via the real allocate() from src/shared/types.ts --')
const parts = allocate(asMinor(10000), 3)
check('allocate() returns exactly [3334,3333,3333]', JSON.stringify(parts) === '[3334,3333,3333]', parts.join(','))
const taxParts = allocate(asMinor(825), 3)
check('tax allocates to [275,275,275]', JSON.stringify(taxParts) === '[275,275,275]', taxParts.join(','))

const pageId = db.prepare('select id from page where item_id=?').get(origin).id as number
const sg = db.prepare(`insert into split_group(origin_item_id,origin_page_id,origin_total_minor,origin_tax_minor,currency,created_at)
  values (?,?,?,?,?,?)`).run(origin, pageId, 10000, 825, 'USD', now).lastInsertRowid as number
db.prepare('update item set split_group_id=?, split_role=?, superseded_at=? where id=?').run(sg, 'origin', now, origin)
const children = parts.map((p, i) => {
  const id = mkItem(2, 'receipt', { sg, role: 'child' })
  db.prepare(`insert into receipt_data(item_id,txn_date,vendor_id,total_minor,currency,tax_total_minor,category_id)
    values (?,?,?,?,?,?,?)`).run(id, '2026-07-12', 1, p, 'USD', taxParts[i], i === 0 ? 1 : 2)
  db.prepare('insert into receipt_tax_line(item_id,label,rate_bp,amount_minor,tax_category_id) values (?,?,?,?,?)')
    .run(id, 'Sales Tax', 825, taxParts[i], 1)
  return id
})

check('canonical sum unchanged after split', sum() === 10000, `sum=${sum()}`)
check('TAX also survives the split', taxSum() === 825, `tax=${taxSum()}`)
check('naive SUM(receipt_data) would double-count', db.prepare('select sum(total_minor) s from receipt_data').get().s === 20000)

const recon = db.prepare('select * from v_split_reconciliation where split_group_id=?').get(sg)
check('reconciliation view shows zero money drift', recon.drift_minor === 0, `drift=${recon.drift_minor}`)
check('reconciliation view shows zero tax drift', recon.tax_drift_minor === 0, `tax_drift=${recon.tax_drift_minor}`)
check('reconciliation view shows no currency mismatch', recon.currency_mismatch_count === 0)

/* ---- ATTACKS on the split invariant ---- */
console.log('\n-- adversarial: unwinding the split --')
rejects('cannot clear origin split flags (the 20000 attack)',
  () => db.prepare('update item set split_group_id=NULL, split_role=NULL, superseded_at=NULL where id=?').run(origin),
  'un-supersede')
rejects('cannot null superseded_at alone',
  () => db.prepare('update item set superseded_at=NULL where id=?').run(origin), 'un-supersede')
rejects('cannot demote origin to child while children live',
  () => db.prepare("update item set split_role='child' where id=?").run(origin), 'un-supersede')
rejects('cannot set split_group_id without a role',
  () => { const i = mkItem(2, 'receipt'); db.prepare('update item set split_group_id=? where id=?').run(sg, i) }, 'CHECK')
rejects('cannot promote a child to origin',
  () => db.prepare("update item set split_role='origin' where id=?").run(children[0]),
  'child cannot become an origin')
check('sum still 10000 after all attacks', sum() === 10000, `sum=${sum()}`)

/* ---- purge policy ---- */
console.log('\n-- adversarial: purge and citation --')
rejects('cannot hard-delete the origin while children exist',
  () => db.prepare('delete from item where id=?').run(origin), 'split group is the unit')
rejects('cannot delete the cited page out from under children',
  () => db.prepare('delete from page where id=?').run(pageId), 'cited image')

const cites = children.map((c) => db.prepare('select page_id,content_hash,via_split from v_item_pages where item_id=?').get(c))
check('all children cite the origin image', cites.every((r: any) => r?.content_hash === 'sha-abc'))
check('children share one page row', new Set(cites.map((r: any) => r.page_id)).size === 1)
check('origin_page_id is honoured by the view', cites.every((r: any) => r.page_id === pageId))

/* ---- merge x split ordering ---- */
console.log('\n-- adversarial: merge x split --')
const mergeResult = mkItem(2, 'document')
db.prepare('insert into document_data(item_id,title) values (?,?)').run(mergeResult, 'Combined contract')
const mg = db.prepare('insert into merge_group(result_item_id,created_at) values (?,?)').run(mergeResult, now).lastInsertRowid as number
db.prepare(`insert into merge_group_member(merge_group_id,page_id,pre_merge_item_id,pre_merge_seq,pre_merge_type,snapshot_json)
  values (?,?,?,?,?,?)`).run(mg, pageId, 999, 1, 'receipt', JSON.stringify({ total_minor: 4200 }))
check('merge journal records a restorable snapshot',
  JSON.parse(db.prepare('select snapshot_json s from merge_group_member where merge_group_id=?').get(mg).s).total_minor === 4200)

const sg2 = db.prepare(`insert into split_group(origin_item_id,origin_total_minor,currency,created_at) values (?,?,?,?)`)
  .run(mergeResult, 5000, 'USD', now).lastInsertRowid as number
rejects('cannot split an un-separated combined item',
  () => db.prepare("update item set split_group_id=?, split_role='origin', superseded_at=? where id=?").run(sg2, now, mergeResult),
  'separate this combined item')

/* The reverse ordering. Note that "combined AND split" turns out to be
   unreachable from BOTH directions, which is a stronger guarantee than merely
   blocking separate-back once the item is already in that state. */
const mr2 = mkItem(2, 'receipt')
db.prepare('insert into receipt_data(item_id,total_minor,currency) values (?,?,?)').run(mr2, 6000, 'USD')
db.prepare('update item set split_group_id=?, split_role=?, superseded_at=? where id=?').run(sg2, 'origin', now, mr2)
rejects('cannot combine into an item that is part of a split',
  () => db.prepare('insert into merge_group(result_item_id,created_at) values (?,?)').run(mr2, now),
  'part of a split')
check('"combined and split" is unreachable from both directions', true,
  'split-of-merge blocked above, merge-of-split blocked here')

/* ---- trash x search ---- */
console.log('\n-- adversarial: trash x FTS --')
const searchableBefore = db.prepare(`select count(*) c from page_fts f
  join v_searchable_pages sp on sp.page_id = f.rowid where page_fts match ?`).get('zzuniquetoken').c
check('token is searchable while item is live', searchableBefore === 1)
db.prepare('update item set trashed_at=? where id=?').run(now, origin)
check('raw page_fts STILL matches a trashed item (why the view is required)',
  db.prepare('select count(*) c from page_fts where page_fts match ?').get('zzuniquetoken').c === 1)
check('v_searchable_pages excludes the trashed item',
  db.prepare(`select count(*) c from page_fts f join v_searchable_pages sp on sp.page_id = f.rowid
    where page_fts match ?`).get('zzuniquetoken').c === 0)
db.prepare('update item set trashed_at=NULL where id=?').run(origin)

/* ---- trash model ---- */
rejects('items cannot be stored in the trash folder',
  () => mkItem(3, 'receipt'), 'never stored in the trash folder')

/* ---- vendor rename propagates without app help ---- */
console.log('\n-- search maintenance --')
db.prepare('update vendor set name=? where id=?').run('Ace Hardware', 1)
check('vendor rename removes the stale term from item_fts',
  db.prepare('select count(*) c from item_fts where item_fts match ?').get('"Home Depot"').c === 0)
check('vendor rename indexes the new term',
  db.prepare('select count(*) c from item_fts where item_fts match ?').get('"Ace Hardware"').c > 0)
db.prepare('update receipt_data set description=? where item_id=?').run('reindexed by trigger', origin)
check('description edit reaches item_fts by trigger alone',
  db.prepare('select count(*) c from item_fts where item_fts match ?').get('reindexed').c === 1)

/* ---- currency discipline ---- */
console.log('\n-- currency --')
const eur = mkItem(2, 'receipt')
db.prepare('insert into receipt_data(item_id,total_minor,currency) values (?,?,?)').run(eur, 5000, 'EUR')
const byCur = db.prepare('select currency,total_minor from v_folder_totals where folder_id=2 order by currency').all()
check('v_folder_totals separates currencies', byCur.length >= 2 && byCur.some((r: any) => r.currency === 'EUR'),
  byCur.map((r: any) => `${r.currency}:${r.total_minor}`).join(' '))
rejects('malformed currency code rejected',
  () => { const i = mkItem(2, 'receipt'); db.prepare('insert into receipt_data(item_id,total_minor,currency) values (?,?,?)').run(i, 100, 'usd') }, 'CHECK')
rejects('split child cannot change currency away from its group',
  () => db.prepare("update receipt_data set currency='EUR' where item_id=?").run(children[1]), 'split group currency')

/* ---- THE RESTORE ATTACK: soft-trash children, unwind origin, restore ---- */
console.log('\n-- adversarial: soft-trash / unwind / restore --')
db.prepare('update item set trashed_at=? where split_group_id=? and split_role=?').run(now, sg, 'child')
check('all three children are soft-trashed',
  db.prepare("select count(*) c from item where split_group_id=? and split_role='child' and trashed_at is not null").get(sg).c === 3)
rejects('cannot unwind the origin even when every child is only SOFT-trashed',
  () => db.prepare('update item set split_group_id=NULL, split_role=NULL, superseded_at=NULL where id=?').run(origin),
  'children exist')
rejects('cited page still protected while children are only soft-trashed',
  () => db.prepare('delete from page where id=?').run(pageId), 'cited image')
db.prepare('update item set trashed_at=NULL where split_group_id=? and split_role=?').run(sg, 'child')
check('children restore cleanly (acceptance #10 still works)',
  db.prepare("select count(*) c from item where split_group_id=? and split_role='child' and trashed_at is null").get(sg).c === 3)
check('sum is STILL 10000 after the trash/unwind/restore sequence', sum() === 10000, `sum=${sum()}`)

/* ---- child detach ---- */
console.log('\n-- adversarial: child detach --')
rejects('a child cannot clear its split role',
  () => db.prepare('update item set split_role=NULL, split_group_id=NULL where id=?').run(children[0]),
  'cannot leave its group')
rejects('a child cannot move to another split group',
  () => db.prepare('update item set split_group_id=? where id=?').run(sg2, children[0]),
  'cannot leave its group')
rejects('a child cannot be promoted to origin even WITH superseded_at',
  () => db.prepare("update item set split_role='origin', superseded_at=? where id=?").run(now, children[1]),
  'cannot become an origin')
check('only one origin exists in the group',
  db.prepare("select count(*) c from item where split_group_id=? and split_role='origin'").get(sg).c === 1)

/* ---- currency on INSERT, not just UPDATE ---- */
console.log('\n-- adversarial: currency at insert time --')
const foreignChild = mkItem(2, 'receipt', { sg, role: 'child' })
rejects('a child cannot be INSERTED with a foreign currency',
  () => db.prepare('insert into receipt_data(item_id,total_minor,currency) values (?,?,?)').run(foreignChild, 100, 'EUR'),
  'split group currency')
db.prepare('delete from item where id=?').run(foreignChild)

/* ---- stale search text after a side-table delete ---- */
console.log('\n-- search hygiene --')
const conv = mkItem(2, 'receipt')
db.prepare('insert into receipt_data(item_id,total_minor,currency,description) values (?,?,?,?)').run(conv, 500, 'USD', 'zzsoontobegone')
check('description is searchable before the side-table row is deleted',
  db.prepare('select count(*) c from item_fts where item_fts match ?').get('zzsoontobegone').c === 1)
db.prepare('delete from receipt_data where item_id=?').run(conv)
check('deleting receipt_data clears its stale search text',
  db.prepare('select count(*) c from item_fts where item_fts match ?').get('zzsoontobegone').c === 0)

/* ---- LEGAL WORKFLOWS must still be possible ---- */
console.log('\n-- legal workflows (over-constraining check) --')
const dOrigin = mkItem(2, 'receipt')
db.prepare('insert into receipt_data(item_id,total_minor,currency,tax_total_minor) values (?,?,?,?)').run(dOrigin, 9000, 'USD', 0)
db.prepare('insert into page(item_id,seq,file_relpath,content_hash,created_at) values (?,?,?,?,?)').run(dOrigin, 1, 'images/d1.jpg', 'sha-d', now)
const dPage = db.prepare('select id from page where item_id=?').get(dOrigin).id as number
const dSg = db.prepare(`insert into split_group(origin_item_id,origin_page_id,origin_total_minor,currency,created_at)
  values (?,?,?,?,?)`).run(dOrigin, dPage, 9000, 'USD', now).lastInsertRowid as number
db.prepare('update item set split_group_id=?, split_role=?, superseded_at=? where id=?').run(dSg, 'origin', now, dOrigin)
const dKids = allocate(asMinor(9000), 2).map((p) => {
  const id = mkItem(2, 'receipt', { sg: dSg, role: 'child' })
  db.prepare('insert into receipt_data(item_id,total_minor,currency) values (?,?,?)').run(id, p, 'USD')
  return id
})
check('a legal 2-way split is still possible', dKids.length === 2)
check('its reconciliation is clean',
  db.prepare('select drift_minor d from v_split_reconciliation where split_group_id=?').get(dSg).d === 0)

// dissolve: hard-delete children, THEN unwind the origin
dKids.forEach((k) => db.prepare('delete from item where id=?').run(k))
check('children can be hard-deleted (dissolve step 1)',
  db.prepare("select count(*) c from item where split_group_id=? and split_role='child'").get(dSg).c === 0)
db.prepare('update item set split_group_id=NULL, split_role=NULL, superseded_at=NULL where id=?').run(dOrigin)
check('origin can be unwound once no children remain (dissolve step 2)',
  db.prepare('select split_role r, superseded_at s from item where id=?').get(dOrigin).r === null)
check('the dissolved origin is summable again with its original amount',
  db.prepare('select total_minor t from v_summable_receipts where item_id=?').get(dOrigin)?.t === 9000)

// ordered empty-trash: children first, then origin
const eOrigin = mkItem(2, 'receipt')
db.prepare('insert into receipt_data(item_id,total_minor,currency) values (?,?,?)').run(eOrigin, 3000, 'USD')
const eSg = db.prepare('insert into split_group(origin_item_id,origin_total_minor,currency,created_at) values (?,?,?,?)')
  .run(eOrigin, 3000, 'USD', now).lastInsertRowid as number
db.prepare('update item set split_group_id=?, split_role=?, superseded_at=? where id=?').run(eSg, 'origin', now, eOrigin)
const eKid = mkItem(2, 'receipt', { sg: eSg, role: 'child' })
db.prepare('insert into receipt_data(item_id,total_minor,currency) values (?,?,?)').run(eKid, 3000, 'USD')
db.prepare('update item set trashed_at=? where id in (?,?)').run(now, eOrigin, eKid)
rejects('empty-trash origin-first is refused with a clear instruction',
  () => db.prepare('delete from item where id=?').run(eOrigin), 'unit of deletion')
db.prepare('delete from item where id=?').run(eKid)
db.prepare('delete from item where id=?').run(eOrigin)
check('empty-trash succeeds in the documented order (children, then origin)',
  db.prepare('select count(*) c from item where id in (?,?)').get(eOrigin, eKid).c === 0)

/* ---- misc constraints ---- */
console.log('\n-- constraints --')
rejects('rotation must be a right angle',
  () => db.prepare('insert into page(item_id,seq,file_relpath,rotation,created_at) values (?,?,?,?,?)').run(origin, 98, 'x.jpg', 45, now), 'CHECK')
rejects('ocr_conf must be within 0..1',
  () => db.prepare('insert into page(item_id,seq,file_relpath,ocr_conf,created_at) values (?,?,?,?,?)').run(origin, 97, 'y.jpg', 1.5, now), 'CHECK')
rejects('a second inbox folder is rejected',
  () => db.prepare("insert into folder(kind,name,created_at,modified_at) values ('inbox','Two',?,?)").run(now, now))
check('negative total is ALLOWED (refunds are real receipts)',
  (() => { const i = mkItem(2, 'receipt'); db.prepare('insert into receipt_data(item_id,total_minor,currency) values (?,?,?)').run(i, -2500, 'USD'); return true })())
check('refund reconciles through allocate()',
  allocate(asMinor(-10000), 3).reduce((a, b) => a + b, 0) === -10000)

check('foreign_key_check clean', db.pragma('foreign_key_check').length === 0)
check('page_fts integrity', (() => { try { db.prepare("insert into page_fts(page_fts) values('integrity-check')").run(); return true } catch { return false } })())
check('item_fts integrity', (() => { try { db.prepare("insert into item_fts(item_fts) values('integrity-check')").run(); return true } catch { return false } })())
check('no split group anywhere has drift',
  db.prepare('select count(*) c from v_split_reconciliation where child_count > 0 and drift_minor <> 0').get().c === 0)

console.log('')
if (failures) { console.error(`schema-verify FAILED: ${failures} assertion(s)`); process.exit(1) }
console.log('schema-verify: all assertions passed')
