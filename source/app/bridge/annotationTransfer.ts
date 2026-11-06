/** Typed wrappers for annotationTransfer:* IPC via api. */

import { api } from '../platforms/api'
export const annotationTransferApi = {
  count: (bookId: string) => api.annotationTransfer.count(bookId),
  exportRestore: (bookId: string) => api.annotationTransfer.exportRestore(bookId),
  exportReadable: (bookId: string) => api.annotationTransfer.exportReadable(bookId),
  pickFile: (input: { bookId?: string }) => api.annotationTransfer.pickFile(input),
  setTarget: (sessionId: string, bookId: string) => api.annotationTransfer.setTarget(sessionId, bookId),
  confirm: (sessionId: string) => api.annotationTransfer.confirm(sessionId),
  discard: (sessionId: string) => api.annotationTransfer.discard(sessionId),
  cancel: (sessionId: string) => api.annotationTransfer.cancel(sessionId),
  onProgress: (handler: Parameters<typeof api.annotationTransfer.onProgress>[0]) =>
    api.annotationTransfer.onProgress(handler),
}
