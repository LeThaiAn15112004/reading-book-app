import { isAudioFormat, sanitizeAudioBookmarks } from '@reading-book/book-reader-sdk'
import { ipcMain } from 'electron'
import { readAudioChapters } from '../audio/audio-chapters'
import { resolveBookFile } from '../files/sandbox'
import { getAudioStore } from '../persistence/sqlite-audio-store'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import type { AudioBookmarkDto, AudioChaptersResult, OkResult } from './api-types'
import { AudioChannels } from './channels'

/** Handlers for audio:* — chapters declared by the file, and the audiobook's bookmarks. */
export function registerAudioIpc(): void {
  ipcMain.removeHandler(AudioChannels.getChapters)
  ipcMain.handle(AudioChannels.getChapters, async (_event, bookId: unknown): Promise<AudioChaptersResult> => {
    void _event
    if (typeof bookId !== 'string' || !bookId.trim()) return { ok: false, chapters: [] }
    try {
      const book = await getLibraryStore().findById(bookId.trim())
      if (!book || !isAudioFormat(book.format)) return { ok: false, chapters: [] }
      const file = await resolveBookFile(book)
      if (!file.ok) return { ok: false, chapters: [] }
      return { ok: true, chapters: await readAudioChapters(file.path) }
    } catch {
      // A tag the parser cannot read must not stop playback: no chapters, the player carries on.
      return { ok: false, chapters: [] }
    }
  })

  ipcMain.removeHandler(AudioChannels.getBookmarks)
  ipcMain.handle(AudioChannels.getBookmarks, async (_event, bookId: unknown): Promise<AudioBookmarkDto[]> => {
    void _event
    if (typeof bookId !== 'string' || !bookId.trim()) return []
    return getAudioStore().getBookmarks(bookId.trim())
  })

  ipcMain.removeHandler(AudioChannels.saveBookmarks)
  ipcMain.handle(AudioChannels.saveBookmarks, async (_event, input: unknown): Promise<OkResult> => {
    void _event
    if (!input || typeof input !== 'object') return { ok: false }
    const { bookId, bookmarks } = input as { bookId?: unknown; bookmarks?: unknown }
    if (typeof bookId !== 'string' || !bookId.trim() || !Array.isArray(bookmarks)) return { ok: false }
    try {
      return { ok: getAudioStore().saveBookmarks(bookId.trim(), sanitizeAudioBookmarks(bookmarks)) }
    } catch {
      return { ok: false }
    }
  })
}
