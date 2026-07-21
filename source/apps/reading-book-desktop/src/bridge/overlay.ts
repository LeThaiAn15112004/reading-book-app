/** Typed wrappers for overlay:* IPC via window.api. */

export const overlayApi = {
  list: (bookId: string) => window.api.overlay.list(bookId),
  addHighlight: (...args: Parameters<typeof window.api.overlay.addHighlight>) =>
    window.api.overlay.addHighlight(...args),
  addNote: (...args: Parameters<typeof window.api.overlay.addNote>) =>
    window.api.overlay.addNote(...args),
  listBookmarks: (bookId: string) => window.api.overlay.listBookmarks(bookId),
}
