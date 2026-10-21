/** Typed wrappers for overlay:* IPC via window.api. */

export const overlayApi = {
  getSessionState: (bookId: string) => window.api.overlay.getSessionState(bookId),
  saveSessionState: (
    ...args: Parameters<typeof window.api.overlay.saveSessionState>
  ) => window.api.overlay.saveSessionState(...args),
  getAudioProgress: (bookId: string) => window.api.overlay.getAudioProgress(bookId),
  saveAudioProgress: (
    ...args: Parameters<typeof window.api.overlay.saveAudioProgress>
  ) => window.api.overlay.saveAudioProgress(...args),
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
  watchPdfEmbeddedAnnotations: (bookId: string) => window.api.overlay.watchPdfEmbeddedAnnotations(bookId),
  unwatchPdfEmbeddedAnnotations: (bookId: string) => window.api.overlay.unwatchPdfEmbeddedAnnotations(bookId),
  onPdfEmbeddedAnnotationsChanged: (
    ...args: Parameters<typeof window.api.overlay.onPdfEmbeddedAnnotationsChanged>
  ) => window.api.overlay.onPdfEmbeddedAnnotationsChanged(...args),
  exportAnnotatedPdf: (...args: Parameters<typeof window.api.overlay.exportAnnotatedPdf>) =>
    window.api.overlay.exportAnnotatedPdf(...args),
  confirmSignedPdfWrite: (bookId: string) => window.api.overlay.confirmSignedPdfWrite(bookId),
  listPdfAnnotationConflicts: (bookId: string) => window.api.overlay.listPdfAnnotationConflicts(bookId),
  resolvePdfAnnotationConflict: (...args: Parameters<typeof window.api.overlay.resolvePdfAnnotationConflict>) =>
    window.api.overlay.resolvePdfAnnotationConflict(...args),
}
