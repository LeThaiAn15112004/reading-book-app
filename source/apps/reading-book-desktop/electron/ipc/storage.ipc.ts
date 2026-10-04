import { ipcMain } from 'electron'
import {
  clearCache,
  getStorageUsage,
  openBooksFolder,
  removeTranslationModel,
} from '../storage/storage-service'
import type { ClearCacheResult, StorageUsageDto } from './api-types'
import { StorageChannels } from './channels'

/** Handlers for storage:* — Settings → Storage usage, Clear Cache, translation models. */
export function registerStorageIpc(): void {
  ipcMain.removeHandler(StorageChannels.getUsage)
  ipcMain.handle(StorageChannels.getUsage, (): Promise<StorageUsageDto> => getStorageUsage())

  ipcMain.removeHandler(StorageChannels.clearCache)
  ipcMain.handle(StorageChannels.clearCache, (): Promise<ClearCacheResult> => clearCache())

  ipcMain.removeHandler(StorageChannels.removeTranslationModel)
  ipcMain.handle(StorageChannels.removeTranslationModel, (_event, modelId: unknown) =>
    removeTranslationModel(modelId),
  )

  ipcMain.removeHandler(StorageChannels.openBooksFolder)
  ipcMain.handle(StorageChannels.openBooksFolder, () => openBooksFolder())
}
