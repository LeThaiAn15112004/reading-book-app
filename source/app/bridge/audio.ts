/** Typed wrappers for audio:* IPC via window.api. */

export const audioApi = {
  getChapters: (bookId: string) => window.api.audio.getChapters(bookId),
  getTracks: (bookId: string) => window.api.audio.getTracks(bookId),
  getBookmarks: (bookId: string) => window.api.audio.getBookmarks(bookId),
  saveBookmarks: (...args: Parameters<typeof window.api.audio.saveBookmarks>) => window.api.audio.saveBookmarks(...args),
}
