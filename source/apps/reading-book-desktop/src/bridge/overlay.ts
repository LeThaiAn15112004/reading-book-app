/** Typed wrappers for overlay:* IPC via window.api. */

export const overlayApi = {
  getSessionState: (bookId: string) => window.api.overlay.getSessionState(bookId),
  saveSessionState: (
    ...args: Parameters<typeof window.api.overlay.saveSessionState>
  ) => window.api.overlay.saveSessionState(...args),
  listBookmarks: (bookId: string) => window.api.overlay.listBookmarks(bookId),
  saveBookmark: (
    ...args: Parameters<typeof window.api.overlay.saveBookmark>
  ) => window.api.overlay.saveBookmark(...args),
  deleteBookmark: (
    ...args: Parameters<typeof window.api.overlay.deleteBookmark>
  ) => window.api.overlay.deleteBookmark(...args),
  listHighlights: (bookId: string) => window.api.overlay.listHighlights(bookId),
  saveHighlight: (
    ...args: Parameters<typeof window.api.overlay.saveHighlight>
  ) => window.api.overlay.saveHighlight(...args),
  deleteHighlight: (
    ...args: Parameters<typeof window.api.overlay.deleteHighlight>
  ) => window.api.overlay.deleteHighlight(...args),
}
