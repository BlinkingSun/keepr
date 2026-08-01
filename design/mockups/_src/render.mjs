import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import path from 'path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.resolve(dir, '..')

const shots = [
  { file: '09-thumbnail-view.html', out: '09-thumbnail-view.png', w: 1360, h: 880 },
  { file: '10-scan-dialog.html', out: '10-scan-dialog.png', w: 1360, h: 880 },
  { file: '11-titlebar-import-menu.html', out: '11-titlebar-import-menu.png', w: 1020, h: 320 },
]

const browser = await chromium.launch()
for (const s of shots) {
  const page = await browser.newPage({
    viewport: { width: s.w, height: s.h },
    deviceScaleFactor: 2,
  })
  const url = 'file://' + path.join(dir, s.file)
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(150)
  const out = path.join(outDir, s.out)
  await page.screenshot({ path: out, type: 'png' })
  console.log('wrote', out)
  await page.close()
}
await browser.close()
