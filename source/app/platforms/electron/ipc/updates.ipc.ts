import { ipcMain } from 'electron'
import { checkForUpdates } from '../updates/update-service'
import type { UpdateCheckResultDto } from './api-types'
import { UpdateChannels } from './channels'

/** Handlers for updates:* — Settings → Advanced → Updates. */
export function registerUpdatesIpc(): void {
  ipcMain.removeHandler(UpdateChannels.check)
  ipcMain.handle(UpdateChannels.check, (): Promise<UpdateCheckResultDto> => checkForUpdates())
}
