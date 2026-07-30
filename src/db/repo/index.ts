import type { FileStore } from '../../shared/types.ts'
import { CustomFieldsRepo } from './customFields.ts'
import { FoldersRepo } from './folders.ts'
import { ItemsRepo } from './items.ts'
import { ListsRepo } from './lists.ts'
import { PagesRepo } from './pages.ts'
import type { Database } from './types.ts'

export type { Database, FileStore }
export { CustomFieldsRepo } from './customFields.ts'
export { FoldersRepo } from './folders.ts'
export { ItemsRepo } from './items.ts'
export { ListsRepo } from './lists.ts'
export { PagesRepo } from './pages.ts'
export { parseMoneyText, parseMoneyField } from './money.ts'
export { normalizeVendorName } from './normalize.ts'

export interface Repositories {
  folders: FoldersRepo
  items: ItemsRepo
  pages: PagesRepo
  lists: ListsRepo
  customFields: CustomFieldsRepo
  db: Database
  fileStore: FileStore | null
}

/**
 * Factory: one connection owned by main is passed in. No side effects at import.
 */
export function createRepositories(deps: {
  db: Database
  fileStore?: FileStore | null
}): Repositories {
  const { db, fileStore = null } = deps
  return {
    folders: new FoldersRepo(db),
    items: new ItemsRepo(db),
    pages: new PagesRepo(db),
    lists: new ListsRepo(db),
    customFields: new CustomFieldsRepo(db),
    db,
    fileStore,
  }
}
