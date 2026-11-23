import { ipcMain } from 'electron'
import type { MiniPlayerOpenResult, MiniPlayerPrefsDto } from './api-types'
import { MiniPlayerChannels } from './channels'
import { validateMiniPlayerCommand, validateMiniPlayerState } from '../mini-player/mini-player-rules'
import { loadMiniPlayerPrefs, saveMiniPlayerPrefs } from '../mini-player/mini-player-prefs'
import {
  closeByUser,
  forwardCommand,
  lastMiniPlayerState,
  openByUser,
  receiveState,
  returnToApp,
} from '../mini-player/mini-player-relay'
import { minimizeMiniPlayerWindow, miniPlayerWindow } from '../mini-player/mini-player-window'

function prefsDto(): MiniPlayerPrefsDto {
  return { autoOpen: loadMiniPlayerPrefs().autoOpen }
}

/** True when the message came from the floating window (its own channels are refused from anywhere else). */
function fromFloatingWindow(sender: Electron.WebContents): boolean {
  const floating = miniPlayerWindow()
  return floating !== null && floating.webContents.id === sender.id
}

/** Handlers for miniPlayer:* (spec 018, contracts/mini-player-ipc.md). */
export function registerMiniPlayerIpc(): void {
  for (const channel of [MiniPlayerChannels.open, MiniPlayerChannels.getPrefs, MiniPlayerChannels.setPrefs, MiniPlayerChannels.getState]) {
    ipcMain.removeHandler(channel)
  }
  for (const channel of [
    MiniPlayerChannels.publishState,
    MiniPlayerChannels.windowCommand,
    MiniPlayerChannels.returnToApp,
    MiniPlayerChannels.closeWindow,
    MiniPlayerChannels.minimizeWindow,
  ]) {
    ipcMain.removeAllListeners(channel)
  }

  // Main renderer → Main. A malformed snapshot is dropped whole (the last good one stays).
  ipcMain.on(MiniPlayerChannels.publishState, (event, input: unknown) => {
    if (fromFloatingWindow(event.sender)) return
    const state = validateMiniPlayerState(input)
    if (state !== undefined) receiveState(state)
  })
  ipcMain.handle(MiniPlayerChannels.open, (): MiniPlayerOpenResult => (openByUser() ? { ok: true } : { ok: false, code: 'no_session' }))
  ipcMain.handle(MiniPlayerChannels.getPrefs, (): MiniPlayerPrefsDto => prefsDto())
  ipcMain.handle(MiniPlayerChannels.setPrefs, (_event, patch: unknown): MiniPlayerPrefsDto => {
    const raw = typeof patch === 'object' && patch !== null ? (patch as Record<string, unknown>) : {}
    // Only `autoOpen` is settable from the renderer; the position is Main's.
    if (typeof raw.autoOpen === 'boolean') {
      try {
        saveMiniPlayerPrefs({ autoOpen: raw.autoOpen })
      } catch (err) {
        console.error('Mini player prefs could not be saved:', err)
      }
    }
    return prefsDto()
  })

  // Floating window → Main.
  ipcMain.handle(MiniPlayerChannels.getState, (event) => (fromFloatingWindow(event.sender) ? lastMiniPlayerState() : null))
  ipcMain.on(MiniPlayerChannels.windowCommand, (event, input: unknown) => {
    if (!fromFloatingWindow(event.sender)) return
    const command = validateMiniPlayerCommand(input)
    if (command) forwardCommand(command)
  })
  ipcMain.on(MiniPlayerChannels.returnToApp, (event) => {
    if (fromFloatingWindow(event.sender)) returnToApp()
  })
  ipcMain.on(MiniPlayerChannels.closeWindow, (event) => {
    if (fromFloatingWindow(event.sender)) closeByUser()
  })
  ipcMain.on(MiniPlayerChannels.minimizeWindow, (event) => {
    if (fromFloatingWindow(event.sender)) minimizeMiniPlayerWindow()
  })
}
