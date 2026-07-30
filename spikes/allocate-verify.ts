/**
 * Adversarial test of the money allocators in src/shared/types.ts.
 * Run: node --experimental-strip-types spikes/allocate-verify.ts
 *
 * The property that must never break: parts sum EXACTLY to the input, for every
 * input. Not approximately. Lane I builds on this.
 */
import { allocate, allocateByWeight, asMinor } from '../src/shared/types.ts'

let failures = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) failures++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

/* the canonical case from the plan */
const three = allocate(asMinor(10000), 3)
check('10000 / 3 -> 3334,3333,3333', JSON.stringify(three) === '[3334,3333,3333]', three.join(','))

/* exhaustive property sweep: every total 0..2000, every n 1..12 */
let swept = 0
let worst = ''
for (let total = 0; total <= 2000; total++) {
  for (let n = 1; n <= 12; n++) {
    const parts = allocate(asMinor(total), n)
    const sum = parts.reduce((a, b) => a + b, 0)
    if (sum !== total || parts.length !== n) { worst = `total=${total} n=${n} -> ${parts.join(',')}`; failures++; break }
    // spread must never exceed one minor unit
    if (Math.max(...parts) - Math.min(...parts) > 1) { worst = `uneven spread at total=${total} n=${n}`; failures++; break }
    swept++
  }
}
check('exhaustive sweep: 2001 totals x 12 divisors sum exactly', worst === '', worst || `${swept} combinations verified`)

/* awkward remainders */
check('1 / 3 gives one cent to the first part', JSON.stringify(allocate(asMinor(1), 3)) === '[1,0,0]')
check('0 / 4 is all zeros', JSON.stringify(allocate(asMinor(0), 4)) === '[0,0,0,0]')
check('7 / 7 is all ones', allocate(asMinor(7), 7).every((p) => p === 1))
check('single part returns the whole total', JSON.stringify(allocate(asMinor(8437), 1)) === '[8437]')

/* negative totals (refunds / credit memos) must still reconcile */
const neg = allocate(asMinor(-10000), 3)
check('negative total reconciles', neg.reduce((a, b) => a + b, 0) === -10000, neg.join(','))

/* rejects nonsense rather than silently coercing */
check('rejects n = 0', (() => { try { allocate(asMinor(100), 0); return false } catch { return true } })())
check('rejects fractional n', (() => { try { allocate(asMinor(100), 2.5); return false } catch { return true } })())
check('asMinor rejects a float', (() => { try { asMinor(84.37); return false } catch { return true } })())

/* weighted splits */
const w6040 = allocateByWeight(asMinor(10000), [60, 40])
check('60/40 of 10000 -> 6000,4000', JSON.stringify(w6040) === '[6000,4000]', w6040.join(','))
const w333 = allocateByWeight(asMinor(10000), [1, 1, 1])
check('equal weights match allocate()', JSON.stringify(w333) === JSON.stringify([3334, 3333, 3333]), w333.join(','))
const awkward = allocateByWeight(asMinor(1), [1, 1, 1])
check('1 cent across 3 weights still sums to 1', awkward.reduce((a, b) => a + b, 0) === 1, awkward.join(','))
const zeroW = allocateByWeight(asMinor(5000), [3, 0, 1])
check('zero weight receives nothing but total holds',
  zeroW[1] === 0 && zeroW.reduce((a, b) => a + b, 0) === 5000, zeroW.join(','))

/* weighted sweep — the fractional-remainder path is where these usually break */
let wBad = ''
for (let total = 0; total <= 500; total++) {
  for (const weights of [[1, 2], [1, 2, 3], [7, 11, 13], [1, 1, 1, 1, 1, 1, 1]]) {
    const parts = allocateByWeight(asMinor(total), weights)
    if (parts.reduce((a, b) => a + b, 0) !== total) { wBad = `total=${total} w=${weights.join('/')} -> ${parts.join(',')}`; failures++; break }
  }
  if (wBad) break
}
check('weighted sweep sums exactly', wBad === '', wBad || '501 totals x 4 weight vectors')

check('rejects negative weights', (() => { try { allocateByWeight(asMinor(100), [1, -1]); return false } catch { return true } })())
check('rejects all-zero weights', (() => { try { allocateByWeight(asMinor(100), [0, 0]); return false } catch { return true } })())

console.log('')
if (failures) { console.error(`allocate-verify FAILED: ${failures} assertion(s)`); process.exit(1) }
console.log('allocate-verify: all assertions passed')
