import { app, Menu, nativeImage, Tray } from 'electron'
import path from 'node:path'
import type { BackgroundPrefsDto } from '../ipc/api-types'
import {
  DEFAULT_BACKGROUND_PREFS,
  loadBackgroundPrefs,
  normalizeBackgroundPrefs,
  saveBackgroundPrefs,
} from './background-prefs'

/**
 * Background mode + System Tray (Settings → Background & System Tray).
 *
 * `isQuitting` separates "close the window" (the [X] button: hide when running in the background)
 * from "quit the app" (tray Quit, Settings Quit, Cmd+Q, `app.quit()` from anywhere, OS shutdown /
 * log-off). It is raised by `before-quit` and the shutdown hooks in main.ts, so every real quit
 * path lets the window close — the app can never get stuck un-quittable.
 */

let quitting = false
let prefs: BackgroundPrefsDto = { ...DEFAULT_BACKGROUND_PREFS }
let tray: Tray | null = null
let showMainWindow: () => void = () => {}
let iconDir = ''

export function markQuitting(): void {
  quitting = true
}

export function isQuitting(): boolean {
  return quitting
}

/**
 * Close button → hide instead of close: only while both switches are on, no quit is in progress and
 * the tray really exists (a failed tray would leave a hidden window with no way back).
 */
export function shouldHideOnClose(): boolean {
  return !quitting && prefs.showTray && prefs.runInBackground && tray !== null
}

/** The only way the app quits on purpose from its own UI (tray menu, Settings). */
export function quitApp(): void {
  markQuitting()
  app.quit()
}

export function getBackgroundPrefs(): BackgroundPrefsDto {
  return { ...prefs }
}

/** Persist first, then apply — on a write error nothing changes and the error reaches the caller. */
export function updateBackgroundPrefs(patch: Partial<BackgroundPrefsDto>): BackgroundPrefsDto {
  const next = normalizeBackgroundPrefs({ ...prefs, ...patch })
  saveBackgroundPrefs(next)
  prefs = next
  syncTray()
  return getBackgroundPrefs()
}

export function resetBackgroundPrefs(): BackgroundPrefsDto {
  return updateBackgroundPrefs(DEFAULT_BACKGROUND_PREFS)
}

/** Load prefs and create the tray (when enabled). Call once, after `app.whenReady()`. */
export function initBackgroundMode(options: { showWindow: () => void; publicDir: string }): void {
  showMainWindow = options.showWindow
  iconDir = path.join(options.publicDir, 'tray')
  prefs = loadBackgroundPrefs()
  syncTray()
}

export function disposeTray(): void {
  tray?.destroy()
  tray = null
}

function trayIcon(): Electron.NativeImage {
  // macOS menu bar: black template image (adapts to light / dark); elsewhere the amber icon.
  // `@2x` variants next to each file are picked up automatically on HiDPI displays.
  const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'
  const image = nativeImage.createFromPath(path.join(iconDir, file))
  if (process.platform === 'darwin') image.setTemplateImage(true)
  return image
}

function createTray(): Tray {
  const created = new Tray(trayIcon())
  created.setToolTip('Readmate Reader')
  created.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Readmate', click: () => showMainWindow() },
      { type: 'separator' },
      { label: 'Quit Readmate', click: () => quitApp() },
    ]),
  )
  // Windows / Linux: a left click opens the window; the menu stays on right click.
  // (macOS shows the context menu on click.)
  if (process.platform !== 'darwin') created.on('click', () => showMainWindow())
  return created
}

function syncTray(): void {
  if (prefs.showTray && !tray) {
    try {
      tray = createTray()
    } catch (err) {
      console.error('System tray could not be created:', err)
      tray = null
    }
  } else if (!prefs.showTray && tray) {
    disposeTray()
  }
}
