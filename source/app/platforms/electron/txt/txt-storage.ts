import { app } from 'electron'
import path from 'node:path'
import { getTxtStore } from '../persistence/sqlite-txt-store'
import { createTxtWorkingCopyStore, type TxtWorkingCopyStore } from './txt-working-copy'

/** `{userData}/txt-edits` — the only folder edited TXT text is ever written to. */
function txtEditsRoot(): string {
  return path.join(app.getPath('userData'), 'txt-edits')
}

let copies: TxtWorkingCopyStore | null = null

export function getTxtWorkingCopies(): TxtWorkingCopyStore {
  copies ??= createTxtWorkingCopyStore(txtEditsRoot)
  return copies
}

/**
 * The text file the search / word-count index should be built from: the book's edited copy when it
 * has one, else undefined (use the book's own file).
 */
export async function currentTxtIndexSource(bookId: string): Promise<string | undefined> {
  const row = getTxtStore().getDocument(bookId)
  if (!row) return undefined
  const text = await getTxtWorkingCopies().read(bookId, row.revision).catch(() => null)
  return text === null ? undefined : getTxtWorkingCopies().pathFor(bookId, row.revision)
}
