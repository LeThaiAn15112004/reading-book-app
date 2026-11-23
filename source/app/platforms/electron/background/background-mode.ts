import { app, Menu, nativeImage, Tray } from 'electron'
import path from 'node:path'
import type { BackgroundPrefsDto } from '../ipc/api-types'
import {
  DEFAULT_BACKGROUND_PREFS,
  loadBackgroundPrefs,
  normalizeBackgroundPrefs,
  saveBackgroundPrefs,
} from './background-prefs'
import { onMainUiLanguageChange } from '../i18n/main-i18n'
import { tMain } from '../i18n/main-translate'

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

/** Spec 016: the reader cancelled a quit (imports still running): the app keeps running and hides on close again. */
export function cancelQuitting(): void {
  quitting = false
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

/** The tray icon exists right now (it is the way back to a hidden window). */
export function hasTray(): boolean {
  return tray !== null
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
  // A language change rebuilds the open tray's menu at once — no restart (spec 012 US3).
  stopTrayLanguage?.()
  stopTrayLanguage = onMainUiLanguageChange(() => {
    if (tray) applyTrayTexts(tray)
  })
}

let stopTrayLanguage: (() => void) | null = null

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

/** Spec 018 (FR-026): the listening session's Play / Pause entry, or `null` without a session. */
let audiobookEntry: { title: string; playing: boolean } | null = null
let toggleAudiobook: () => void = () => {}

/** Set by the mini player relay when the session's title / play state changes (never per position tick). */
export function setTrayAudiobookEntry(entry: { title: string; playing: boolean } | null): void {
  audiobookEntry = entry
  if (tray) applyTrayTexts(tray)
}

/** The tray's Play / Pause item runs this (the relay forwards `toggle` to the main renderer). */
export function setTrayAudiobookToggle(run: () => void): void {
  toggleAudiobook = run
}

function audiobookMenuItems(): Electron.MenuItemConstructorOptions[] {
  if (!audiobookEntry) return []
  const title = audiobookEntry.title
  return [
    {
      label: audiobookEntry.playing
        ? tMain('main.shell.tray.audiobookPause', { title })
        : tMain('main.shell.tray.audiobookPlay', { title }),
      click: () => toggleAudiobook(),
    },
    { type: 'separator' },
  ]
}

/** The tray menu in Main's current interface language (spec 012); rebuilt when the language changes. */
export function trayMenuTemplate(): Electron.MenuItemConstructorOptions[] {
  return [
    ...audiobookMenuItems(),
    { label: tMain('main.shell.tray.open', { app: APP_SHORT_NAME }), click: () => showMainWindow() },
    { type: 'separator' },
    { label: tMain('main.shell.tray.quit', { app: APP_SHORT_NAME }), click: () => quitApp() },
  ]
}

const APP_SHORT_NAME = 'Readmate'

function applyTrayTexts(target: Tray): void {
  target.setToolTip(tMain('main.shell.tray.tooltip'))
  target.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate()))
}

function createTray(): Tray {
  const created = new Tray(trayIcon())
  applyTrayTexts(created)
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
