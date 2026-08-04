/** Typed wrappers for overlay:* IPC via window.api. */

export const overlayApi = {
  list: (bookId: string) => window.api.overlay.list(bookId),
  addHighlight: (...args: Parameters<typeof window.api.overlay.addHighlight>) =>
    window.api.overlay.addHighlight(...args),
  updateHighlightNote: (
    ...args: Parameters<typeof window.api.overlay.updateHighlightNote>
  ) => window.api.overlay.updateHighlightNote(...args),
  deleteHighlight: (
    ...args: Parameters<typeof window.api.overlay.deleteHighlight>
  ) => window.api.overlay.deleteHighlight(...args),
  listBookmarks: (bookId: string) => window.api.overlay.listBookmarks(bookId),
  saveBookmark: (...args: Parameters<typeof window.api.overlay.saveBookmark>) =>
    window.api.overlay.saveBookmark(...args),
  deleteBookmark: (
    ...args: Parameters<typeof window.api.overlay.deleteBookmark>
  ) => window.api.overlay.deleteBookmark(...args),
  getSessionState: (bookId: string) => window.api.overlay.getSessionState(bookId),
  saveSessionState: (
    ...args: Parameters<typeof window.api.overlay.saveSessionState>
  ) => window.api.overlay.saveSessionState(...args),
}
