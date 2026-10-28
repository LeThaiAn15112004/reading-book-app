/** Typed wrappers for storage:* IPC via window.api. */

export type StorageUsage = Awaited<ReturnType<typeof window.api.storage.getUsage>>
export type TranslationModel = StorageUsage['translationModels'][number]
export type SpeechModel = StorageUsage['speechModels'][number]
export type ClearCacheResult = Awaited<ReturnType<typeof window.api.storage.clearCache>>
export type RemoveTranslationModelResult = Awaited<
  ReturnType<typeof window.api.storage.removeTranslationModel>
>

export const storageApi = {
  getUsage: () => window.api.storage.getUsage(),
  clearCache: () => window.api.storage.clearCache(),
  removeTranslationModel: (modelId: string) => window.api.storage.removeTranslationModel(modelId),
  removeSpeechModel: (modelId: string) => window.api.storage.removeSpeechModel(modelId),
  openBooksFolder: () => window.api.storage.openBooksFolder(),
}
