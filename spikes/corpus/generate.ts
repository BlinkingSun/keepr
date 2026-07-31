/**
 * Synthetic receipt corpus with known ground truth.
 *
 * Real receipts belong to real people, so this generates its own rather than
 * scraping images of someone's shopping. The point is variety and difficulty:
 * every format that breaks a naive parser is represented deliberately —
 * SUBTOTAL directly above TOTAL, a tip line after the total, European decimal
 * commas, two tax lines, a refund, a total printed without decimals, two TOTAL
 * lines, and no total at all.
 *
 * Degradation matters as much as layout. A crisp SVG render is not a thermal
 * receipt photographed on a desk, so each one gets some combination of rotation,
 * blur, noise, and reduced contrast. A corpus that only contains clean images
 * measures nothing useful.
 *
 * Run: node --experimental-strip-types spikes/corpus/generate.ts <outDir>
 */
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface Truth {
  id: string
  note: string
  vendor: string | null
  txnDate: string | null
  /** Integer minor units. null means the receipt genuinely has no total. */
  totalMinor: number | null
  taxMinor: number | null
  paymentType: string | null
  currency: string
  /** Difficulty label, for reporting where accuracy actually falls off. */
  difficulty: 'clean' | 'moderate' | 'hard'
}

interface Spec {
  truth: Truth
  lines: Array<{ text: string; size?: number; bold?: boolean; gap?: number }>
  /** Post-render degradation. */
  degrade?: { rotate?: number; blur?: number; noise?: number; contrast?: number; width?: number }
  font?: string
}

const MONO = 'Courier New, Courier, monospace'
const SANS = 'Helvetica, Arial, sans-serif'

const SPECS: Spec[] = [
  {
    truth: { id: '01-bigbox', note: 'SUBTOTAL directly above TOTAL — the classic trap', vendor: 'Home Depot',
      txnDate: '2026-07-12', totalMinor: 12501, taxMinor: 953, paymentType: 'VISA', currency: 'USD', difficulty: 'clean' },
    lines: [
      { text: 'HOME DEPOT #4821', size: 30, bold: true }, { text: '1200 COMMERCE BLVD' },
      { text: 'PORTLAND OR 97223' }, { text: '' }, { text: '07/12/2026  14:22' }, { text: '' },
      { text: 'LUMBER 2X4        48.00' }, { text: 'SCREWS BOX        12.99' },
      { text: 'PAINT GALLON      34.50' }, { text: 'DRILL BIT SET     19.99' }, { text: '' },
      { text: 'SUBTOTAL         115.48' }, { text: 'TAX 8.25%          9.53' },
      { text: 'TOTAL            125.01', bold: true }, { text: '' }, { text: 'VISA ****4242' }, { text: 'APPROVED' },
    ],
  },
  {
    truth: { id: '02-grocery-thermal', note: 'dense thermal grocery, no tax line at all — must report null, not 0', vendor: 'Whole Foods',
      txnDate: '2026-06-28', totalMinor: 8742, taxMinor: null, paymentType: 'DEBIT', currency: 'USD', difficulty: 'moderate' },
    lines: [
      { text: 'WHOLE FOODS MARKET', size: 26 }, { text: 'STORE #10345' }, { text: '06/28/2026 09:14' }, { text: '' },
      { text: 'ORGANIC KALE       4.29' }, { text: 'ALMOND MILK        3.99' }, { text: 'SOURDOUGH          5.49' },
      { text: 'CHICKEN BREAST    12.84' }, { text: 'OLIVE OIL         14.99' }, { text: 'TOMATOES           6.12' },
      { text: 'GREEK YOGURT       7.48' }, { text: 'COFFEE BEANS      16.99' }, { text: 'BANANAS            2.18' },
      { text: 'PASTA              3.29' }, { text: 'PARMESAN           9.76' }, { text: '' },
      { text: 'TOTAL             87.42' }, { text: 'DEBIT ****7734' },
    ],
    degrade: { blur: 0.6, contrast: 0.72, noise: 12 },
  },
  {
    truth: { id: '03-restaurant-tip', note: 'tip line AFTER the subtotal; final total is the largest', vendor: 'Olive Grove',
      txnDate: '2026-07-04', totalMinor: 9660, taxMinor: 560, paymentType: 'MASTERCARD', currency: 'USD', difficulty: 'moderate' },
    lines: [
      { text: 'THE OLIVE GROVE', size: 28, bold: true }, { text: 'Table 12   Server: Dana' },
      { text: '07/04/2026  19:47' }, { text: '' },
      { text: '2 PASTA PRIMAVERA   36.00' }, { text: '1 BRANZINO          32.00' },
      { text: '2 HOUSE WINE        14.00' }, { text: '' },
      { text: 'SUBTOTAL            82.00' }, { text: 'TAX                  5.60' },
      { text: 'TIP                  9.00' }, { text: 'TOTAL               96.60', bold: true },
      { text: 'MASTERCARD ****3978' },
    ],
    degrade: { rotate: -2.5, blur: 0.3 },
  },
  {
    truth: { id: '04-fuel', note: 'gallons and price-per-gallon compete with the total', vendor: 'Shell',
      txnDate: '2026-07-09', totalMinor: 6892, taxMinor: 420, paymentType: 'VISA', currency: 'USD', difficulty: 'moderate' },
    lines: [
      { text: 'SHELL', size: 34, bold: true }, { text: 'STR 9931  PUMP 04' }, { text: '07/09/2026 07:31' }, { text: '' },
      { text: 'UNLEADED' }, { text: 'GALLONS      14.882' }, { text: 'PRICE/GAL     4.399' }, { text: '' },
      { text: 'FUEL TOTAL    64.72' }, { text: 'TAX            4.20' }, { text: 'TOTAL         68.92', bold: true },
      { text: 'VISA ****4242' },
    ],
    degrade: { rotate: 1.8, noise: 8 },
  },
  {
    truth: { id: '05-european', note: 'EU decimal comma and DD.MM.YYYY, VAT not TAX', vendor: 'Bauhaus',
      txnDate: '2026-05-19', totalMinor: 24790, taxMinor: 3958, paymentType: 'GIROCARD', currency: 'EUR', difficulty: 'hard' },
    lines: [
      { text: 'BAUHAUS GmbH', size: 28, bold: true }, { text: 'Hauptstrasse 44, Berlin' },
      { text: '19.05.2026  11:08' }, { text: '' },
      { text: 'HOLZBRETT        89,90' }, { text: 'SCHRAUBEN        24,50' },
      { text: 'FARBE           133,50' }, { text: '' },
      { text: 'NETTO           208,32' }, { text: 'MwSt 19%         39,58' },
      { text: 'SUMME           247,90', bold: true }, { text: 'GIROCARD' },
    ],
    degrade: { blur: 0.4, contrast: 0.85 },
  },
  {
    truth: { id: '06-canada-two-tax', note: 'GST and PST as separate lines — tax must aggregate', vendor: 'Canadian Tire',
      txnDate: '2026-04-02', totalMinor: 11295, taxMinor: 1470, paymentType: 'INTERAC', currency: 'CAD', difficulty: 'hard' },
    lines: [
      { text: 'CANADIAN TIRE', size: 28, bold: true }, { text: 'Store #0421 Calgary AB' },
      { text: '2026-04-02  16:20' }, { text: '' },
      { text: 'WRENCH SET       59.99' }, { text: 'WORK GLOVES      18.49' }, { text: 'TARP             19.77' },
      { text: '' }, { text: 'SUBTOTAL         98.25' },
      { text: 'GST 5%            4.91' }, { text: 'PST 7%            9.79' },
      { text: 'TOTAL           112.95', bold: true }, { text: 'INTERAC' },
    ],
    degrade: { rotate: -1.2, noise: 6 },
  },
  {
    truth: { id: '07-refund', note: 'negative total — a refund is a real receipt', vendor: 'Best Buy',
      txnDate: '2026-07-15', totalMinor: -19999, taxMinor: -1650, paymentType: 'VISA', currency: 'USD', difficulty: 'hard' },
    lines: [
      { text: 'BEST BUY #1188', size: 28, bold: true }, { text: 'RETURN / CREDIT MEMO' },
      { text: '07/15/2026  13:02' }, { text: '' },
      { text: 'HEADPHONES      -183.49' }, { text: 'TAX             -16.50' },
      { text: 'TOTAL          -199.99', bold: true }, { text: 'REFUND TO VISA ****4242' },
    ],
    degrade: { blur: 0.3 },
  },
  {
    truth: { id: '08-no-decimals', note: 'round total printed with no decimal point', vendor: 'City Parking',
      txnDate: '2026-07-18', totalMinor: 2500, taxMinor: null, paymentType: 'CASH', currency: 'USD', difficulty: 'hard' },
    lines: [
      { text: 'CITY PARKING AUTHORITY', size: 24 }, { text: 'LOT 7  SPACE 214' },
      { text: '07/18/2026' }, { text: '' }, { text: 'ALL DAY PARKING' }, { text: '' },
      { text: 'TOTAL  25', bold: true, size: 30 }, { text: 'CASH' },
    ],
    degrade: { rotate: 3.0, noise: 10 },
  },
  {
    truth: { id: '09-two-totals', note: 'TOTAL appears twice (order total then card total)', vendor: 'Fastenal',
      txnDate: '2026-03-11', totalMinor: 43217, taxMinor: 3287, paymentType: 'AMEX', currency: 'USD', difficulty: 'hard' },
    lines: [
      { text: 'FASTENAL COMPANY', size: 26, bold: true }, { text: 'Branch 4471' },
      { text: '03/11/2026' }, { text: '' },
      { text: 'BOLT ASSORTMENT   289.30' }, { text: 'ANCHOR KIT        110.00' }, { text: '' },
      { text: 'ORDER TOTAL       399.30' }, { text: 'TAX                32.87' },
      { text: 'TOTAL             432.17', bold: true }, { text: 'AMEX ****9011' },
      { text: 'CARD TOTAL        432.17' },
    ],
    degrade: { blur: 0.5, contrast: 0.8 },
  },
  {
    truth: { id: '10-no-total', note: 'no total on the receipt at all — must NOT invent one', vendor: 'Corner Cafe',
      txnDate: '2026-07-20', totalMinor: null, taxMinor: null, paymentType: null, currency: 'USD', difficulty: 'hard' },
    lines: [
      { text: 'CORNER CAFE', size: 30, bold: true }, { text: '07/20/2026' }, { text: '' },
      { text: 'ESPRESSO' }, { text: 'CROISSANT' }, { text: '' }, { text: 'THANK YOU - COME AGAIN' },
      { text: 'ORDER #  4471' },
    ],
    degrade: { rotate: -2.0, blur: 0.4 },
  },
  {
    truth: { id: '11-faded-skew', note: 'heavily degraded: faded, blurred, rotated', vendor: 'Ace Hardware',
      txnDate: '2026-02-08', totalMinor: 6780, taxMinor: 765, paymentType: 'VISA', currency: 'USD', difficulty: 'hard' },
    lines: [
      { text: 'ACE HARDWARE 3842', size: 28, bold: true }, { text: '02/08/2026  10:44' }, { text: '' },
      { text: 'HINGE PAIR        21.98' }, { text: 'WOOD GLUE         12.49' }, { text: 'SANDPAPER PK      25.68' },
      { text: '' }, { text: 'SUBTOTAL          60.15' }, { text: 'TAX                7.65' },
      { text: 'TOTAL             67.80', bold: true }, { text: 'VISA' },
    ],
    degrade: { rotate: -5.5, blur: 1.3, contrast: 0.58, noise: 22 },
  },
  {
    truth: { id: '12-sans-invoice', note: 'proportional font invoice rather than monospace thermal', vendor: 'Grainger',
      txnDate: '2026-01-23', totalMinor: 158940, taxMinor: 12105, paymentType: 'NET 30', currency: 'USD', difficulty: 'moderate' },
    font: SANS,
    lines: [
      { text: 'GRAINGER INC', size: 32, bold: true }, { text: 'Invoice 88-4471-C' },
      { text: 'Date: 01/23/2026' }, { text: '' },
      { text: 'Industrial shelving     1,204.00' }, { text: 'Safety cabinet            264.35' },
      { text: '' }, { text: 'Subtotal                1,468.35' },
      { text: 'Sales Tax                 121.05' }, { text: 'Total Due               1,589.40', bold: true },
      { text: 'Terms: NET 30' },
    ],
    degrade: { blur: 0.25 },
  },
]

async function render(spec: Spec, outDir: string): Promise<void> {
  const font = spec.font ?? MONO
  const width = spec.degrade?.width ?? 640
  let y = 70
  const body = spec.lines
    .map((l) => {
      const size = l.size ?? 25
      y += (l.gap ?? 0) + (l.text === '' ? Math.round(size * 0.7) : Math.round(size * 1.55))
      if (l.text === '') return ''
      const weight = l.bold ? ' font-weight="bold"' : ''
      const esc = l.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      return `<text x="52" y="${y}" font-size="${size}"${weight}>${esc}</text>`
    })
    .join('\n')
  const height = y + 90

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <g font-family="${font}" fill="#0a0a0a">
${body}
  </g>
</svg>`

  let img = sharp(Buffer.from(svg))
  const d = spec.degrade ?? {}
  if (d.contrast != null) {
    // Lift the black point toward grey: thermal print fades, it does not go crisp.
    img = img.linear(d.contrast, Math.round(255 * (1 - d.contrast) * 0.9))
  }
  // sharp rejects sigma below 0.3, so a very light blur clamps rather than throws.
  if (d.blur) img = img.blur(Math.max(0.3, d.blur))
  if (d.rotate) img = img.rotate(d.rotate, { background: '#ffffff' })
  let buf = await img.png().toBuffer()

  if (d.noise) {
    // Sprinkle speckle the way a scanner does; sharp has no noise op, so composite
    // a random-grey layer at low opacity.
    const meta = await sharp(buf).metadata()
    const w = meta.width ?? width
    const h = meta.height ?? height
    const px = Buffer.alloc(w * h)
    for (let i = 0; i < px.length; i++) px[i] = 255 - Math.floor(Math.random() * d.noise * 2)
    const noise = await sharp(px, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer()
    buf = await sharp(buf).composite([{ input: noise, blend: 'multiply' }]).png().toBuffer()
  }

  writeFileSync(path.join(outDir, `${spec.truth.id}.png`), buf)
}

const outDir = process.argv[2] ?? './corpus-out'
mkdirSync(outDir, { recursive: true })
for (const spec of SPECS) await render(spec, outDir)
writeFileSync(path.join(outDir, 'truth.json'), JSON.stringify(SPECS.map((s) => s.truth), null, 2))
console.log(`wrote ${SPECS.length} receipts + truth.json to ${outDir}`)
console.log(
  '  difficulty mix:',
  ['clean', 'moderate', 'hard']
    .map((d) => `${d}=${SPECS.filter((s) => s.truth.difficulty === d).length}`)
    .join(' '),
)
