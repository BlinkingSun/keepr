/**
 * Lane I — Receipt splitting, combine, separate.
 *
 * Public surface consumed by main (IPC / HTTP). Money arithmetic uses only
 * allocate / allocateByWeight from src/shared/types.ts.
 */

export { splitReceipt } from './splitReceipt.ts'
export { dissolveSplit } from './dissolveSplit.ts'
export { combineItems } from './combineItems.ts'
export { separateItem } from './separateItem.ts'
export { assertSplitReconciliation } from './reconcile.ts'
export type { Database } from './db.ts'
