/** Typed wrappers for overlay:* IPC via window.api. */

export const overlayApi = {
  listAnnotations: (
    ...args: Parameters<typeof window.api.overlay.listAnnotations>
  ) => window.api.overlay.listAnnotations(...args),
  saveAnnotation: (
    ...args: Parameters<typeof window.api.overlay.saveAnnotation>
  ) => window.api.overlay.saveAnnotation(...args),
  updateAnnotation: (
    ...args: Parameters<typeof window.api.overlay.updateAnnotation>
  ) => window.api.overlay.updateAnnotation(...args),
  deleteAnnotation: (
    ...args: Parameters<typeof window.api.overlay.deleteAnnotation>
  ) => window.api.overlay.deleteAnnotation(...args),
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
