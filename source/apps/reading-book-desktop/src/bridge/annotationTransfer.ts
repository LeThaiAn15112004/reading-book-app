/** Typed wrappers for annotationTransfer:* IPC via window.api. */

export const annotationTransferApi = {
  count: (bookId: string) => window.api.annotationTransfer.count(bookId),
  exportRestore: (bookId: string) => window.api.annotationTransfer.exportRestore(bookId),
  exportReadable: (bookId: string) => window.api.annotationTransfer.exportReadable(bookId),
  pickFile: (input: { bookId?: string }) => window.api.annotationTransfer.pickFile(input),
  setTarget: (sessionId: string, bookId: string) => window.api.annotationTransfer.setTarget(sessionId, bookId),
  confirm: (sessionId: string) => window.api.annotationTransfer.confirm(sessionId),
  discard: (sessionId: string) => window.api.annotationTransfer.discard(sessionId),
  cancel: (sessionId: string) => window.api.annotationTransfer.cancel(sessionId),
  onProgress: (handler: Parameters<typeof window.api.annotationTransfer.onProgress>[0]) =>
    window.api.annotationTransfer.onProgress(handler),
}
