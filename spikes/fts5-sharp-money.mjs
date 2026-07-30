import Database from 'better-sqlite3'
import sharp from 'sharp'

const db = new Database(':memory:')
console.log('sqlite version:', db.prepare('select sqlite_version() v').get().v)

// FTS5 availability
const opts = db.prepare("select group_concat(compile_options) n from pragma_compile_options where compile_options like '%FTS5%'").get()
console.log('FTS5 compile option:', opts.n || 'NOT FOUND')

// external-content FTS5 with triggers — the exact pattern PLAN.md specifies
db.exec(`
  create table page(id integer primary key, item_id integer, ocr_text text);
  create virtual table page_fts using fts5(ocr_text, content='page', content_rowid='id');
  create trigger page_ai after insert on page begin
    insert into page_fts(rowid, ocr_text) values (new.id, new.ocr_text);
  end;
  create trigger page_ad after delete on page begin
    insert into page_fts(page_fts, rowid, ocr_text) values('delete', old.id, old.ocr_text);
  end;
  create trigger page_au after update on page begin
    insert into page_fts(page_fts, rowid, ocr_text) values('delete', old.id, old.ocr_text);
    insert into page_fts(rowid, ocr_text) values (new.id, new.ocr_text);
  end;
`)
db.prepare('insert into page(item_id, ocr_text) values (?,?)').run(1, 'HOME DEPOT 4512 TOTAL 84.37 VISA thermal receipt')
db.prepare('insert into page(item_id, ocr_text) values (?,?)').run(2, 'STAPLES office supplies TOTAL 22.10 MASTERCARD')
const hit = db.prepare("select p.id, p.ocr_text from page_fts f join page p on p.id=f.rowid where page_fts match ? order by rank").all('thermal')
console.log('FTS match on OCR-only word:', JSON.stringify(hit))

// update + delete keep the index correct
db.prepare('update page set ocr_text=? where id=1').run('HOME DEPOT rewritten no longer thermal')
console.log('after update, "thermal" hits:', db.prepare("select count(*) c from page_fts where page_fts match ?").get('thermal').c)
db.prepare('delete from page where id=2').run()
console.log('after delete, "staples" hits:', db.prepare("select count(*) c from page_fts where page_fts match ?").get('staples').c)

// money as integer minor units — the split remainder question
const total = 10000 // $100.00 in cents
const n = 3
const base = Math.floor(total / n), rem = total - base * n
const parts = Array.from({length: n}, (_, i) => base + (i < rem ? 1 : 0))
console.log('split 100.00 three ways (cents):', parts, 'sum:', parts.reduce((a,b)=>a+b,0), 'reconciles:', parts.reduce((a,b)=>a+b,0) === total)

const img = await sharp({create:{width:600,height:900,channels:3,background:{r:20,g:20,b:22}}}).png().toBuffer()
const meta = await sharp(img).metadata()
console.log('sharp ok:', meta.width + 'x' + meta.height, meta.format)
console.log('cores available for worker pool:', (await import('node:os')).cpus().length)
