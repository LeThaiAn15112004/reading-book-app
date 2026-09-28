import { app, BrowserWindow, clipboard, ipcMain } from 'electron'
import type {
  AppInfo,
  GoogleOAuthClientConfigDto,
  OkResult,
  SnapshotRegionDto,
} from './api-types'
import { AppChannels } from './channels'
import { applyChromeThemeToWindow } from '../theme/titlebar-overlay'
import { loadGoogleOAuthClientConfig } from '../config/google-oauth-config'

function windowFromEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

/** Renderer input is untrusted: keep only a well-formed, positive-size rectangle. */
function toSnapshotRegion(input: unknown): SnapshotRegionDto | null {
  if (!input || typeof input !== 'object') return null
  const { x, y, width, height } = input as Record<string, unknown>
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    ![x, y, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  ) {
    return null
  }
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

function notifyFullscreen(win: BrowserWindow, fullscreen: boolean): void {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send(AppChannels.fullscreenChanged, fullscreen)
}

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

  ipcMain.removeHandler(AppChannels.getGoogleOAuthConfig)
  ipcMain.handle(
    AppChannels.getGoogleOAuthConfig,
    (): GoogleOAuthClientConfigDto | null => loadGoogleOAuthClientConfig(),
  )

  ipcMain.removeHandler(AppChannels.setChromeTheme)
  ipcMain.handle(
    AppChannels.setChromeTheme,
    (event, theme: unknown): OkResult => {
      const win = windowFromEvent(event)
      if (!win) return { ok: false }
      applyChromeThemeToWindow(win, theme)
      return { ok: true }
    },
  )

  ipcMain.removeHandler(AppChannels.getFullscreen)
  ipcMain.handle(AppChannels.getFullscreen, (event): boolean => {
    return windowFromEvent(event)?.isFullScreen() ?? false
  })

  ipcMain.removeHandler(AppChannels.setFullscreen)
  ipcMain.handle(
    AppChannels.setFullscreen,
    (
      event,
      value: unknown,
    ): { ok: boolean; fullscreen: boolean } => {
      const win = windowFromEvent(event)
      if (!win) return { ok: false, fullscreen: false }
      win.setFullScreen(Boolean(value))
      const fullscreen = win.isFullScreen()
      return { ok: true, fullscreen }
    },
  )

  ipcMain.removeHandler(AppChannels.toggleFullscreen)
  ipcMain.handle(
    AppChannels.toggleFullscreen,
    (event): { ok: boolean; fullscreen: boolean } => {
      const win = windowFromEvent(event)
      if (!win) return { ok: false, fullscreen: false }
      const fullscreen = !win.isFullScreen()
      win.setFullScreen(fullscreen)
      return { ok: true, fullscreen }
    },
  )

  ipcMain.removeHandler(AppChannels.captureSnapshot)
  ipcMain.handle(
    AppChannels.captureSnapshot,
    async (event, input: unknown): Promise<OkResult> => {
      const region = toSnapshotRegion(input)
      const win = windowFromEvent(event)
      if (!region || !win || win.isDestroyed()) return { ok: false }
      try {
        const image = await win.webContents.capturePage(region)
        if (image.isEmpty()) return { ok: false }
        clipboard.writeImage(image)
        return { ok: true }
      } catch {
        return { ok: false }
      }
    },
  )
}

/** F11 toggle + Esc exit; works even when focus is inside an EPUB iframe. */
export function installFullscreenShortcuts(target: BrowserWindow): void {
  target.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return

    if (input.key === 'F11') {
      target.setFullScreen(!target.isFullScreen())
      event.preventDefault()
      return
    }

    if (input.key === 'Escape' && target.isFullScreen()) {
      target.setFullScreen(false)
      event.preventDefault()
    }
  })

  target.on('enter-full-screen', () => {
    notifyFullscreen(target, true)
  })
  target.on('leave-full-screen', () => {
    notifyFullscreen(target, false)
  })
}
