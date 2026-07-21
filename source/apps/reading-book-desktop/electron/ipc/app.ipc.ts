import { app, ipcMain } from 'electron'
import type { AppInfo } from './api-types'
import { AppChannels } from './channels'

/** Smoke / health IPC for G0 acceptance (`ping` / `getAppInfo`). */
export function registerAppIpc(): void {
  ipcMain.removeHandler(AppChannels.ping)
  ipcMain.handle(AppChannels.ping, (): 'pong' => 'pong')

  ipcMain.removeHandler(AppChannels.getAppInfo)
  ipcMain.handle(AppChannels.getAppInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
  }))
}
