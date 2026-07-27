import { app, BrowserWindow, ipcMain } from 'electron'
import type { AppInfo, OkResult } from './api-types'
import { AppChannels } from './channels'
import { applyChromeThemeToWindow } from '../theme/titlebar-overlay'

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

  ipcMain.removeHandler(AppChannels.setChromeTheme)
  ipcMain.handle(
    AppChannels.setChromeTheme,
    (event, theme: unknown): OkResult => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { ok: false }
      applyChromeThemeToWindow(win, theme)
      return { ok: true }
    },
  )
}
