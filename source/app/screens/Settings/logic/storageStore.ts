import { create } from 'zustand'
import { storageApi, type StorageUsage } from '../../../bridge'
import type { UiText } from '../../../i18n'

type StorageNotice = { tone: 'success' | 'error'; text: UiText }

type StorageState = {
  usage: StorageUsage | null
  loading: boolean
  loadError: UiText | null
  clearing: boolean
  /** Model id whose Remove is in flight. */
  removingModelId: string | null
  /** Outcome of the last Clear Cache / Remove, shown inline on the page. */
  notice: StorageNotice | null
  load: () => Promise<void>
  clearCache: () => Promise<void>
  removeTranslationModel: (modelId: string) => Promise<void>
  /** Delete one downloaded speech (transcription) model; refused while a transcription is running. */
  removeSpeechModel: (modelId: string) => Promise<void>
  openBooksFolder: () => Promise<void>
}

/** Settings → Storage. All sizes come from Main (`storage:*`); nothing is computed here. */
export const useStorageStore = create<StorageState>()((set, get) => ({
  usage: null,
  loading: false,
  loadError: null,
  clearing: false,
  removingModelId: null,
  notice: null,

  load: async () => {
    if (get().loading) return
    set({ loading: true, loadError: null })
    try {
      set({ usage: await storageApi.getUsage(), loading: false })
    } catch {
      set({ loading: false, loadError: { key: 'settings.storage.notices.loadFailed' } })
    }
  },

  clearCache: async () => {
    if (get().clearing) return
    set({ clearing: true, notice: null })
    try {
      const result = await storageApi.clearCache()
      set({
        clearing: false,
        notice: result.ok
          ? { tone: 'success', text: { key: 'settings.storage.notices.cacheCleared' } }
          : { tone: 'error', text: result.errorMessage ?? { key: 'settings.storage.notices.cacheClearFailed' } },
      })
    } catch {
      set({ clearing: false, notice: { tone: 'error', text: { key: 'settings.storage.notices.cacheClearFailed' } } })
    }
    await get().load()
  },

  removeTranslationModel: async (modelId) => {
    if (get().removingModelId) return
    set({ removingModelId: modelId, notice: null })
    try {
      const result = await storageApi.removeTranslationModel(modelId)
      set({
        removingModelId: null,
        notice: result.ok
          ? { tone: 'success', text: { key: 'settings.storage.notices.removed', params: { id: modelId } } }
          : { tone: 'error', text: result.errorMessage ?? { key: 'settings.storage.notices.removeFailed' } },
      })
    } catch {
      set({ removingModelId: null, notice: { tone: 'error', text: { key: 'settings.storage.notices.removeFailed' } } })
    }
    await get().load()
  },

  removeSpeechModel: async (modelId) => {
    if (get().removingModelId) return
    set({ removingModelId: modelId, notice: null })
    try {
      const result = await storageApi.removeSpeechModel(modelId)
      set({
        removingModelId: null,
        notice: result.ok
          ? { tone: 'success', text: { key: 'settings.storage.notices.removed', params: { id: modelId } } }
          : { tone: 'error', text: result.errorMessage ?? { key: 'settings.storage.notices.removeFailed' } },
      })
    } catch {
      set({ removingModelId: null, notice: { tone: 'error', text: { key: 'settings.storage.notices.removeFailed' } } })
    }
    await get().load()
  },

  openBooksFolder: async () => {
    try {
      const result = await storageApi.openBooksFolder()
      if (!result.ok) set({ notice: { tone: 'error', text: { key: 'settings.storage.notices.openFolderFailed' } } })
    } catch {
      set({ notice: { tone: 'error', text: { key: 'settings.storage.notices.openFolderFailed' } } })
    }
  },
}))
