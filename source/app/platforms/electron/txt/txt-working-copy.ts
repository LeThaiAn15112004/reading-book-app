import { randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'

/**
 * The app's edited copies of TXT books: `{root}/{bookId}/r{revision}.txt` (UTF-8, `\n`), where `root`
 * is `{userData}/txt-edits`. This is the ONLY place edited text is written — never next to a book
 * file and never into the user's own file. The renderer never sees these paths; Main addresses a copy
 * by (bookId, revision).
 *
 * Writes are atomic (temp file → fsync → rename), so a revision file is either complete or absent. A
 * new revision is written BEFORE the database commit that makes it current and the old one is pruned
 * after it, so a crash at any point leaves the committed revision readable.
 */

const BOOK_ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const REVISION_FILE_RE = /^r(\d+)\.txt$/

export interface TxtWorkingCopyStore {
  /** Absolute path of a revision's file (Main-internal; never sent to the renderer). */
  pathFor(bookId: string, revision: number): string
  read(bookId: string, revision: number): Promise<string | null>
  write(bookId: string, revision: number, text: string): Promise<void>
  /** Delete every file of the book except `keepRevision` (and stray temp files). */
  prune(bookId: string, keepRevision: number | null): Promise<void>
  /** Delete the book's whole folder (the book was removed from the library). */
  remove(bookId: string): Promise<void>
}

function isMissing(err: unknown): boolean {
  const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : ''
  return code === 'ENOENT' || code === 'ENOTDIR'
}

export function createTxtWorkingCopyStore(root: () => string): TxtWorkingCopyStore {
  /** `{root}/{bookId}` — refuses ids that could leave `root`. */
  function bookDir(bookId: string): string {
    if (!BOOK_ID_RE.test(bookId)) throw new Error('Invalid book id')
    const base = path.resolve(root())
    const dir = path.resolve(base, bookId)
    if (path.dirname(dir) !== base) throw new Error('Invalid book id')
    return dir
  }

  function revisionFile(bookId: string, revision: number): string {
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid revision')
    return path.join(bookDir(bookId), `r${revision}.txt`)
  }

  return {
    pathFor: revisionFile,

    async read(bookId, revision) {
      try {
        return await fsp.readFile(revisionFile(bookId, revision), 'utf8')
      } catch (err) {
        if (isMissing(err)) return null
        throw err
      }
    },

    async write(bookId, revision, text) {
      const target = revisionFile(bookId, revision)
      await fsp.mkdir(path.dirname(target), { recursive: true })
      const temp = `${target}.${randomUUID()}.tmp`
      const handle = await fsp.open(temp, 'w')
      try {
        await handle.writeFile(text, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      try {
        await fsp.rename(temp, target)
      } catch (err) {
        await fsp.rm(temp, { force: true }).catch(() => {})
        throw err
      }
    },

    async prune(bookId, keepRevision) {
      const dir = bookDir(bookId)
      let names: string[]
      try {
        names = await fsp.readdir(dir)
      } catch (err) {
        if (isMissing(err)) return
        throw err
      }
      await Promise.all(
        names.map(async (name) => {
          const match = REVISION_FILE_RE.exec(name)
          if (match && Number(match[1]) === keepRevision) return
          await fsp.rm(path.join(dir, name), { force: true }).catch(() => {})
        }),
      )
    },

    async remove(bookId) {
      await fsp.rm(bookDir(bookId), { recursive: true, force: true })
    },
  }
}
