/** Typed wrappers for translation:* IPC via api. */

import { api } from '../platforms/api'
export type TranslateRequest = Parameters<typeof api.translation.translate>[0]
export type TranslateResult = Awaited<ReturnType<typeof api.translation.translate>>
export type TranslationErrorCode = Extract<TranslateResult, { state: 'error' }>['code']
export type TranslationProgress = Parameters<Parameters<typeof api.translation.onProgress>[0]>[0]

export type TranslationSourceResult = Awaited<ReturnType<typeof api.translation.getSourceLanguage>>
export type TranslationSourceSaveResult = Awaited<ReturnType<typeof api.translation.setSourceLanguage>>

export const translationApi = {
  translate: (request: TranslateRequest) => api.translation.translate(request),
  cancel: (requestId: string) => api.translation.cancel(requestId),
  onProgress: (handler: (progress: TranslationProgress) => void) =>
    api.translation.onProgress(handler),
  /** The source language remembered for one book (spec 011); `lang: null` = none. */
  getSourceLanguage: (bookId: string) => api.translation.getSourceLanguage(bookId),
  /** Remember (a catalog code) or forget (`null`) the source language of one book. */
  setSourceLanguage: (bookId: string, lang: string | null) => api.translation.setSourceLanguage({ bookId, lang }),
}
