/** Typed wrappers for translation:* IPC via window.api. */

export type TranslateRequest = Parameters<typeof window.api.translation.translate>[0]
export type TranslateResult = Awaited<ReturnType<typeof window.api.translation.translate>>
export type TranslationErrorCode = Extract<TranslateResult, { state: 'error' }>['code']
export type TranslationProgress = Parameters<Parameters<typeof window.api.translation.onProgress>[0]>[0]

export const translationApi = {
  translate: (request: TranslateRequest) => window.api.translation.translate(request),
  cancel: (requestId: string) => window.api.translation.cancel(requestId),
  onProgress: (handler: (progress: TranslationProgress) => void) =>
    window.api.translation.onProgress(handler),
}
