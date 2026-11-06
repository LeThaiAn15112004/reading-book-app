/** Typed wrappers for transcription:* IPC via api (audiobook transcription, spec 004). */

import { api } from '../platforms/api'
export type TranscriptionApiShape = typeof api.transcription
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
  getInfo: (bookId: string, appLanguage?: string) => api.transcription.getInfo(bookId, appLanguage),
  start: (request: TranscriptionStartRequest) => api.transcription.start(request),
  cancel: (jobId: string) => api.transcription.cancel(jobId),
  downloadModel: (modelId: string) => api.transcription.downloadModel(modelId),
  getPassages: (request: Parameters<TranscriptionApiShape['getPassages']>[0]) => api.transcription.getPassages(request),
  search: (bookId: string, query: string, limit?: number) => api.transcription.search(bookId, query, limit),
  export: (bookId: string, options?: Parameters<TranscriptionApiShape['export']>[1]) => api.transcription.export(bookId, options),
  delete: (bookId: string) => api.transcription.delete(bookId),
  onProgress: (handler: (job: TranscriptionJob) => void) => api.transcription.onProgress(handler),
  onPassagesAdded: (handler: (added: TranscriptionPassagesAdded) => void) => api.transcription.onPassagesAdded(handler),
  onModelProgress: (handler: (progress: TranscriptionModelProgress) => void) => api.transcription.onModelProgress(handler),
}
