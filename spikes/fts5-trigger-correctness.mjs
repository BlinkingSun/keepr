import Database from 'better-sqlite3'
const db = new Database(':memory:')
db.exec(`
  create table page(id integer primary key, ocr_text text);
  create virtual table page_fts using fts5(ocr_text, content='page', content_rowid='id');
  create trigger page_ai after insert on page begin
    insert into page_fts(rowid, ocr_text) values (new.id, new.ocr_text); end;
  create trigger page_ad after delete on page begin
    insert into page_fts(page_fts, rowid, ocr_text) values('delete', old.id, old.ocr_text); end;
  create trigger page_au after update on page begin
    insert into page_fts(page_fts, rowid, ocr_text) values('delete', old.id, old.ocr_text);
    insert into page_fts(rowid, ocr_text) values (new.id, new.ocr_text); end;
`)
const ins = db.prepare('insert into page(ocr_text) values (?)')
ins.run('unmistakableword alpha')
const hits = w => db.prepare('select count(*) c from page_fts where page_fts match ?').get(w).c
console.log('before update, "unmistakableword":', hits('unmistakableword'))
db.prepare('update page set ocr_text=? where id=1').run('completely different content beta')
console.log('after  update, "unmistakableword":', hits('unmistakableword'), '(must be 0)')
console.log('after  update, "beta":', hits('beta'), '(must be 1)')
// integrity check FTS5 exposes
db.prepare("insert into page_fts(page_fts) values('integrity-check')").run()
console.log('FTS5 integrity-check: PASSED')
