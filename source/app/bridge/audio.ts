/** Typed wrappers for audio:* IPC via api. */

import { api } from '../platforms/api'
export const audioApi = {
  getChapters: (bookId: string) => api.audio.getChapters(bookId),
  getTracks: (bookId: string) => api.audio.getTracks(bookId),
  getBookmarks: (bookId: string) => api.audio.getBookmarks(bookId),
  saveBookmarks: (...args: Parameters<typeof api.audio.saveBookmarks>) => api.audio.saveBookmarks(...args),
}
