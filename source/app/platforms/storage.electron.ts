/**
 * Platform adapter `storage`, Desktop renderer (spec 009 T044): book bytes come from the `library.openBookContent` IPC
 * (Main validates the path and reads the file; the renderer never sees one) and covers are the `rb-cover://` URLs Main
 * serves. Same shape as the Mobile source (`storage.native.ts`), whose bytes and covers come from the local server.
 */
import { api } from './api'
import type { BookContentBoot, BookContentHost, BookContentSource } from './storage-types'

export type { BookContentBoot, BookContentHost, BookContentSource }

/** `rb-cover://local/{id}` (electron/files/cover-protocol.ts); `version` busts the image cache when the cover changes. */
export function createBookContentSource(_client?: BookContentHost, _boot?: BookContentBoot): BookContentSource {
  return {
    async read(bookId) {
      const result = await api.library.openBookContent(bookId)
      if (!result.ok || !result.data) throw new Error(result.errorMessage ?? 'The book could not be read')
      return result.data
    },
    async coverUrl(bookId, version) {
      return `rb-cover://local/${encodeURIComponent(bookId)}?v=${encodeURIComponent(version)}`
    },
  }
}
