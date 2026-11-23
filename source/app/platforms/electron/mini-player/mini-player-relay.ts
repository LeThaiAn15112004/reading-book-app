import type { BrowserWindow } from 'electron'
import type { MiniPlayerCommandDto, MiniPlayerStateDto } from '../ipc/api-types'
import { MiniPlayerChannels } from '../ipc/channels'
import {
  INITIAL_FLAGS,
  flagsForState,
  shouldAutoClose,
  shouldAutoOpen,
  trayEntryFor,
  type MiniPlayerFlags,
} from './mini-player-rules'
import { loadMiniPlayerPrefs } from './mini-player-prefs'
import { closeMiniPlayerWindow, isMiniPlayerWindowOpen, miniPlayerWindow, openMiniPlayerWindow } from './mini-player-window'

/**
 * Spec 018 (contracts/mini-player-ipc.md): Main's relay between the main window's renderer (which owns playback), the
 * floating window and the tray. Keeps the last state and the session-only flags; never stores anything else.
 */

type RelayHost = {
  mainWindow: () => BrowserWindow | null
  showMainWindow: () => void
  /** The tray's audiobook entry changed (rebuild its menu). */
  onTrayEntry: (entry: { title: string; playing: boolean } | null) => void
}

let host: RelayHost | null = null
let lastState: MiniPlayerStateDto | null = null
let flags: MiniPlayerFlags = { ...INITIAL_FLAGS }
let lastTray: string | null = null
/** A close of the floating window that Main itself started (restore / session end): not "closed by the user". */
let closingByMain = false

export function initMiniPlayerRelay(options: RelayHost): void {
  host = options
}

export function lastMiniPlayerState(): MiniPlayerStateDto | null {
  return lastState
}

function sendToMain(channel: string, payload: unknown): void {
  const main = host?.mainWindow()
  if (main && !main.isDestroyed()) main.webContents.send(channel, payload)
}

function syncTray(): void {
  const entry = trayEntryFor(lastState)
  const key = entry ? JSON.stringify(entry) : null
  if (key === lastTray) return
  lastTray = key
  host?.onTrayEntry(entry)
}

/** A (validated) state from the main renderer. */
export function receiveState(state: MiniPlayerStateDto | null): void {
  const previousBookId = lastState?.bookId ?? null
  flags = flagsForState(flags, previousBookId, state)
  lastState = state
  syncTray()
  const floating = miniPlayerWindow()
  if (state === null) {
    if (floating) {
      closingByMain = true
      closeMiniPlayerWindow()
    }
    return
  }
  if (floating) floating.webContents.send(MiniPlayerChannels.state, state)
}

/** A (validated) command from the floating window or the tray, for the main renderer. */
export function forwardCommand(command: MiniPlayerCommandDto): void {
  if (command.type === 'openPlayer') host?.showMainWindow()
  sendToMain(MiniPlayerChannels.command, command)
}

function open(automatic: boolean): boolean {
  if (!flags.sessionActive) return false
  const wasOpen = isMiniPlayerWindowOpen()
  if (!openMiniPlayerWindow()) return false
  if (!wasOpen) {
    flags = { ...flags, windowOpen: true, openedAutomatically: automatic }
    sendToMain(MiniPlayerChannels.windowChanged, { open: true })
  }
  return true
}

/** "Pop out" from the in-app bar. */
export function openByUser(): boolean {
  return open(false)
}

/** The floating window closed (any way). */
export function onWindowClosed(): void {
  const byMain = closingByMain
  closingByMain = false
  flags = {
    ...flags,
    windowOpen: false,
    openedAutomatically: false,
    closedByUserThisSession: flags.closedByUserThisSession || (!byMain && flags.sessionActive),
  }
  sendToMain(MiniPlayerChannels.windowChanged, { open: false })
}

/** "Return to app": close the floating window, bring the main window back; playback continues. */
export function returnToApp(): void {
  closingByMain = true
  closeMiniPlayerWindow()
  host?.showMainWindow()
}

/** ✕ in the floating window: end the session (the renderer saves progress), then close. */
export function closeByUser(): void {
  sendToMain(MiniPlayerChannels.command, { type: 'endSession' } satisfies MiniPlayerCommandDto)
  closeMiniPlayerWindow()
}

/** FR-025: the main window was minimised or hidden to the tray. */
export function onMainWindowHidden(): void {
  if (shouldAutoOpen(flags, loadMiniPlayerPrefs())) open(true)
}

/** FR-025: the main window is shown / restored again. */
export function onMainWindowShown(): void {
  if (!shouldAutoClose(flags)) return
  closingByMain = true
  closeMiniPlayerWindow()
}

/** For the tray's Play / Pause item. */
export function toggleFromTray(): void {
  forwardCommand({ type: 'toggle' })
}
