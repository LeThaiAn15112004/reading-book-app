/** Typed wrappers for overlay:* IPC via api. */

import { api } from '../platforms/api'
export const overlayApi = {
  getSessionState: (bookId: string) => api.overlay.getSessionState(bookId),
  saveSessionState: (
    ...args: Parameters<typeof api.overlay.saveSessionState>
  ) => api.overlay.saveSessionState(...args),
  getAudioProgress: (bookId: string) => api.overlay.getAudioProgress(bookId),
  saveAudioProgress: (
    ...args: Parameters<typeof api.overlay.saveAudioProgress>
  ) => api.overlay.saveAudioProgress(...args),
  listBookmarks: (bookId: string) => api.overlay.listBookmarks(bookId),
  saveBookmark: (
    ...args: Parameters<typeof api.overlay.saveBookmark>
  ) => api.overlay.saveBookmark(...args),
  deleteBookmark: (
    ...args: Parameters<typeof api.overlay.deleteBookmark>
  ) => api.overlay.deleteBookmark(...args),
  listHighlights: (bookId: string) => api.overlay.listHighlights(bookId),
  saveHighlight: (
    ...args: Parameters<typeof api.overlay.saveHighlight>
  ) => api.overlay.saveHighlight(...args),
  deleteHighlight: (
    ...args: Parameters<typeof api.overlay.deleteHighlight>
  ) => api.overlay.deleteHighlight(...args),
  listInk: (bookId: string) => api.overlay.listInk(bookId),
  saveInk: (...args: Parameters<typeof api.overlay.saveInk>) => api.overlay.saveInk(...args),
  deleteInk: (...args: Parameters<typeof api.overlay.deleteInk>) => api.overlay.deleteInk(...args),
  watchPdfEmbeddedAnnotations: (bookId: string) => api.overlay.watchPdfEmbeddedAnnotations(bookId),
  unwatchPdfEmbeddedAnnotations: (bookId: string) => api.overlay.unwatchPdfEmbeddedAnnotations(bookId),
  onPdfEmbeddedAnnotationsChanged: (
    ...args: Parameters<typeof api.overlay.onPdfEmbeddedAnnotationsChanged>
  ) => api.overlay.onPdfEmbeddedAnnotationsChanged(...args),
  exportAnnotatedPdf: (...args: Parameters<typeof api.overlay.exportAnnotatedPdf>) =>
    api.overlay.exportAnnotatedPdf(...args),
  confirmSignedPdfWrite: (bookId: string) => api.overlay.confirmSignedPdfWrite(bookId),
  listPdfAnnotationConflicts: (bookId: string) => api.overlay.listPdfAnnotationConflicts(bookId),
  resolvePdfAnnotationConflict: (...args: Parameters<typeof api.overlay.resolvePdfAnnotationConflict>) =>
    api.overlay.resolvePdfAnnotationConflict(...args),
}
