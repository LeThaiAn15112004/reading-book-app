import { create } from 'zustand'
import { storageApi, type StorageUsage } from '../../../bridge'

type StorageNotice = { tone: 'success' | 'error'; text: string }

type StorageState = {
  usage: StorageUsage | null
  loading: boolean
  loadError: string | null
  clearing: boolean
  /** Model id whose Remove is in flight. */
  removingModelId: string | null
  /** Outcome of the last Clear Cache / Remove, shown inline on the page. */
  notice: StorageNotice | null
  load: () => Promise<void>
  clearCache: () => Promise<void>
  removeTranslationModel: (modelId: string) => Promise<void>
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
      set({ loading: false, loadError: 'Could not read storage usage.' })
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
          ? { tone: 'success', text: 'Cache cleared.' }
          : { tone: 'error', text: result.errorMessage ?? 'Could not clear the cache.' },
      })
    } catch {
      set({ clearing: false, notice: { tone: 'error', text: 'Could not clear the cache.' } })
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
          ? { tone: 'success', text: `Removed ${modelId}.` }
          : { tone: 'error', text: result.errorMessage ?? 'Could not remove the model.' },
      })
    } catch {
      set({ removingModelId: null, notice: { tone: 'error', text: 'Could not remove the model.' } })
    }
    await get().load()
  },

  openBooksFolder: async () => {
    try {
      const result = await storageApi.openBooksFolder()
      if (!result.ok) set({ notice: { tone: 'error', text: 'Could not open the folder.' } })
    } catch {
      set({ notice: { tone: 'error', text: 'Could not open the folder.' } })
    }
  },
}))
