import fsp from 'node:fs/promises'
import path from 'node:path'
import { isAudioFormat, isChapterFileName, type AudioChapterRecord } from '@reading-book/book-reader-sdk'
import type { AudioFileLookup } from './audio-stream-handler'

/**
 * Which file `rb-audio://local/{bookId}[/{trackId}]` streams. Electron-free (collaborators injected) so the
 * spikes can drive the real rule headless; `audio-protocol.ts` wires the real library store and `resolveBookFile`.
 *
 *  - no `trackId`: the book's own file — a single-file audiobook's file, or chapter 0 of a multi-chapter one
 *    (the preflight and old URLs keep working);
 *  - with a `trackId`: ONLY a chapter row of THAT book. The file is `dirname(books.file_path)/file_name`; the name must be a
 *    canonical chapter name (a bare basename), the result must stay inside the book's own folder, and the book must be an
 *    app-owned (managed) one, and a symbolic link is never followed. The format used for MIME and for the extension check is the CHAPTER's, never the book's —
 *    `books.file_format` is only the first chapter's format.
 */
export interface AudioLookupDeps {
  findBook: (bookId: string) => Promise<{ id: string; filePath: string; format: string } | undefined>
  getChapter: (bookId: string, trackId: string) => AudioChapterRecord | undefined
  isManaged: (filePath: string) => boolean
  resolveFile: (book: { filePath: string; format: string }) => Promise<{ ok: true; path: string } | { ok: false }>
}

export function createBookAudioLookup(deps: AudioLookupDeps): AudioFileLookup {
  return async (bookId, trackId) => {
    const book = await deps.findBook(bookId)
    if (!book || !isAudioFormat(book.format)) return { ok: false }

    if (trackId === undefined) {
      const file = await deps.resolveFile(book)
      return file.ok ? { ok: true, path: file.path, format: book.format } : { ok: false }
    }

    const chapter = deps.getChapter(book.id, trackId)
    if (!chapter || chapter.bookId !== book.id || !isAudioFormat(chapter.fileFormat) || !isChapterFileName(chapter.fileName)) {
      return { ok: false }
    }
    if (!deps.isManaged(book.filePath)) return { ok: false }
    const dir = path.dirname(book.filePath)
    const file = path.join(dir, chapter.fileName)
    const relative = path.relative(dir, file)
    if (relative !== chapter.fileName || path.isAbsolute(relative)) return { ok: false }
    const resolved = await deps.resolveFile({ filePath: file, format: chapter.fileFormat })
    if (!resolved.ok) return { ok: false }
    // Chapter files are written by the importer as plain files; a link in the book's folder is never followed.
    const stat = await fsp.lstat(resolved.path).catch(() => null)
    if (!stat || stat.isSymbolicLink() || !stat.isFile()) return { ok: false }
    return { ok: true, path: resolved.path, format: chapter.fileFormat }
  }
}
