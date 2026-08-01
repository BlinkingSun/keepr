/** Adversarial probe of the watcher: symlink escape + PDF crash-window self-heal. */
import { mkdtempSync, writeFileSync, symlinkSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createContext } from './src/main/context.ts'
import { createNewReceiptsWatcher } from './src/ingest/watchFolders.ts'
import { createOcrProvider } from './src/ocr/provider.ts'
import { createImagePool } from './src/workers/imagePool.ts'
import sharp from 'sharp'

const root = mkdtempSync(path.join(tmpdir(), 'keepr-probe-'))
const ctx = createContext({ libraryRoot: path.join(root, 'lib'), skipSeed: true })
const deps = { repos: ctx.repos, fileStore: ctx.fileStore, jobs: ctx.jobs,
  ocr: createOcrProvider(), imagePool: createImagePool(), ocrConcurrency: 1, awaitOcr: true }
const newDir = ctx.newReceiptsDir, oldDir = ctx.oldReceiptsDir
const chk=(l:string,ok:boolean,d='')=>console.log(`  ${ok?'PASS':'FAIL'}  ${l.padEnd(58)} ${d}`)

// 1. SYMLINK ESCAPE — the user's only original elsewhere must survive untouched.
const vault = mkdirSync(path.join(root, 'vault'), { recursive: true }) ?? path.join(root, 'vault')
const precious = path.join(root, 'vault', 'only-copy.png')
writeFileSync(precious, await sharp({create:{width:300,height:400,channels:3,background:{r:250,g:250,b:250}}}).png().toBuffer())
symlinkSync(precious, path.join(newDir, 'sneaky-link.png'))

const w = createNewReceiptsWatcher(deps as never, { newDir, oldDir })
await w.tick(); await w.tick(); await w.tick(); await w.tick()  // stability gate needs 3 obs
chk('original outside New survives at its real path', existsSync(precious))
chk('original was NOT moved into Old', !existsSync(path.join(oldDir, 'sneaky-link.png')) && !existsSync(path.join(oldDir, 'only-copy.png')))

// 2. PDF crash-window self-heal via source hash: import the same PNG twice via
//    two ticks with a move that we sabotage the first time is complex to inject
//    here — instead verify the DEDUPE KEY path end to end: same bytes dropped
//    twice under different names -> ONE item, both files archived.
const bytes = await sharp({create:{width:320,height:420,channels:3,background:{r:240,g:240,b:245}}}).png().toBuffer()
writeFileSync(path.join(newDir, 'drop-a.png'), bytes)
for (let i=0;i<4;i++) await w.tick()
const items1 = (ctx.db.prepare("select count(*) c from item where trashed_at is null").get() as {c:number}).c
writeFileSync(path.join(newDir, 'drop-b.png'), bytes)   // identical bytes, new name
for (let i=0;i<4;i++) await w.tick()
const items2 = (ctx.db.prepare("select count(*) c from item where trashed_at is null").get() as {c:number}).c
chk('identical re-drop creates NO second item', items2 === items1, `items ${items1} -> ${items2}`)
chk('both drops archived to Old anyway', existsSync(path.join(oldDir,'drop-a.png')) && existsSync(path.join(oldDir,'drop-b.png')))
chk('source hash recorded (item_source_file)', (ctx.db.prepare('select count(*) c from item_source_file').get() as {c:number}).c >= 1)

// 3. status() honest
const st = w.status()
chk('status reports watching dirs', st.newDir === newDir && st.oldDir === oldDir)
w.stop(); await (deps.ocr as {dispose():Promise<void>}).dispose(); ctx.close()
