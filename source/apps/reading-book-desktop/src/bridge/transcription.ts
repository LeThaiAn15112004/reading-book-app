/** Typed wrappers for transcription:* IPC via window.api (audiobook transcription, spec 004). */

export type TranscriptionApiShape = typeof window.api.transcription
export type TranscriptionInfo = Awaited<ReturnType<TranscriptionApiShape['getInfo']>>
export type TranscriptionStartRequest = Parameters<TranscriptionApiShape['start']>[0]
export type TranscriptionStartResult = Awaited<ReturnType<TranscriptionApiShape['start']>>
export type TranscriptionJob = Parameters<Parameters<TranscriptionApiShape['onProgress']>[0]>[0]
export type TranscriptionPassagesAdded = Parameters<Parameters<TranscriptionApiShape['onPassagesAdded']>[0]>[0]
export type TranscriptionModelProgress = Parameters<Parameters<TranscriptionApiShape['onModelProgress']>[0]>[0]
export type TranscriptPassage = Awaited<ReturnType<TranscriptionApiShape['getPassages']>>[number]
export type TranscriptSearchHit = Awaited<ReturnType<TranscriptionApiShape['search']>>[number]
export type TranscriptExportResult = Awaited<ReturnType<TranscriptionApiShape['export']>>
export type TranscriptionScope = TranscriptionStartRequest['scope']

export const transcriptionApi = {
  getInfo: (bookId: string, appLanguage?: string) => window.api.transcription.getInfo(bookId, appLanguage),
  start: (request: TranscriptionStartRequest) => window.api.transcription.start(request),
  cancel: (jobId: string) => window.api.transcription.cancel(jobId),
  downloadModel: (modelId: string) => window.api.transcription.downloadModel(modelId),
  getPassages: (request: Parameters<TranscriptionApiShape['getPassages']>[0]) => window.api.transcription.getPassages(request),
  search: (bookId: string, query: string, limit?: number) => window.api.transcription.search(bookId, query, limit),
  export: (bookId: string, options?: Parameters<TranscriptionApiShape['export']>[1]) => window.api.transcription.export(bookId, options),
  delete: (bookId: string) => window.api.transcription.delete(bookId),
  onProgress: (handler: (job: TranscriptionJob) => void) => window.api.transcription.onProgress(handler),
  onPassagesAdded: (handler: (added: TranscriptionPassagesAdded) => void) => window.api.transcription.onPassagesAdded(handler),
  onModelProgress: (handler: (progress: TranscriptionModelProgress) => void) => window.api.transcription.onModelProgress(handler),
}
