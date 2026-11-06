/** Typed wrappers for storage:* IPC via api. */

import { api } from '../platforms/api'
export type StorageUsage = Awaited<ReturnType<typeof api.storage.getUsage>>
export type TranslationModel = StorageUsage['translationModels'][number]
export type SpeechModel = StorageUsage['speechModels'][number]
export type ClearCacheResult = Awaited<ReturnType<typeof api.storage.clearCache>>
export type RemoveTranslationModelResult = Awaited<
  ReturnType<typeof api.storage.removeTranslationModel>
>

export const storageApi = {
  getUsage: () => api.storage.getUsage(),
  clearCache: () => api.storage.clearCache(),
  removeTranslationModel: (modelId: string) => api.storage.removeTranslationModel(modelId),
  removeSpeechModel: (modelId: string) => api.storage.removeSpeechModel(modelId),
  openBooksFolder: () => api.storage.openBooksFolder(),
}
