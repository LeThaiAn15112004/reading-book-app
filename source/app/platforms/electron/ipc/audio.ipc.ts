import { isAudioFormat } from '@reading-book/book-reader-sdk'
import { ipcMain } from 'electron'
import { readAudioChapters } from '../audio/audio-chapters'
import { resolveBookFile } from '../files/sandbox'
import { getAudioStore } from '../persistence/sqlite-audio-store'
import { getLibraryStore } from '../persistence/sqlite-library-store'
import type { AudioBookmarkDto, AudioChaptersResult, AudioTracksResult, OkResult } from './api-types'
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
      // A multi-chapter audiobook's playback sequence is its track list; chapters embedded in single files are ignored.
      if (getLibraryStore().hasAudioChapters(book.id)) return { ok: true, chapters: [] }
      const file = await resolveBookFile(book)
      if (!file.ok) return { ok: false, chapters: [] }
      return { ok: true, chapters: await readAudioChapters(file.path) }
    } catch {
      // A tag the parser cannot read must not stop playback: no chapters, the player carries on.
      return { ok: false, chapters: [] }
    }
  })

  ipcMain.removeHandler(AudioChannels.getTracks)
  ipcMain.handle(AudioChannels.getTracks, async (_event, bookId: unknown): Promise<AudioTracksResult> => {
    void _event
    if (typeof bookId !== 'string' || !bookId.trim()) return { ok: false, tracks: [] }
    try {
      const store = getLibraryStore()
      const book = await store.findById(bookId.trim())
      if (!book || !isAudioFormat(book.format)) return { ok: false, tracks: [] }
      // Id, title and duration only: no file name, no archive path, no filesystem path ever crosses IPC.
      return {
        ok: true,
        tracks: store.listAudioChapters(book.id).map((c) => ({ id: c.id, title: c.title, durationSeconds: c.durationSeconds })),
      }
    } catch {
      return { ok: false, tracks: [] }
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
      // The RAW array goes to the store, which sanitizes it itself: a multi-track list above the cap must be refused
      // whole, which only works if nothing has been truncated before the store sees it.
      return { ok: getAudioStore().saveBookmarks(bookId.trim(), bookmarks) }
    } catch {
      return { ok: false }
    }
  })
}
