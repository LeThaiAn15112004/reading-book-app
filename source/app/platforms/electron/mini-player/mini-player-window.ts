import { BrowserWindow, screen } from 'electron'
import { MINI_PLAYER_WINDOW_SIZE, visiblePosition } from './mini-player-rules'
import { loadMiniPlayerPrefs, saveMiniPlayerPrefs } from './mini-player-prefs'

/**
 * Spec 018 (research R4, FR-021): the floating always-on-top window. A remote control only — it never plays audio; its
 * renderer is the same bundle mounted at `?window=mini-player` with its own root, and its preload exposes only
 * `window.miniPlayerWindow`. Singleton.
 */

export type MiniPlayerWindowHost = {
  preloadPath: string
  /** Load the renderer with `?window=mini-player` (dev server or the packaged `index.html`). */
  load: (win: BrowserWindow) => void
  backgroundColor: string
  /** Called when the window is closed by any means (Main resets its flags). */
  onClosed: () => void
}

let host: MiniPlayerWindowHost | null = null
let win: BrowserWindow | null = null
let moveTimer: ReturnType<typeof setTimeout> | null = null

export function initMiniPlayerWindow(options: MiniPlayerWindowHost): void {
  host = options
}

export function miniPlayerWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}

export function isMiniPlayerWindowOpen(): boolean {
  return miniPlayerWindow() !== null
}

function workAreas() {
  return screen.getAllDisplays().map((d) => d.workArea)
}

/** Open (or focus) the floating window. Returns false when Main has not been initialised. */
export function openMiniPlayerWindow(): boolean {
  const existing = miniPlayerWindow()
  if (existing) {
    existing.showInactive()
    return true
  }
  if (!host) return false
  const prefs = loadMiniPlayerPrefs()
  const at = visiblePosition(prefs, workAreas(), screen.getPrimaryDisplay().workArea)
  const created = new BrowserWindow({
    ...MINI_PLAYER_WINDOW_SIZE,
    x: at.x,
    y: at.y,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: host.backgroundColor,
    webPreferences: {
      preload: host.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: ['--readmate-window=mini-player'],
    },
  })
  created.setAlwaysOnTop(true, 'floating')
  // Never navigates anywhere else and never opens new windows.
  created.webContents.on('will-navigate', (event) => event.preventDefault())
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  created.once('ready-to-show', () => created.showInactive())
  created.on('moved', () => {
    if (moveTimer) clearTimeout(moveTimer)
    moveTimer = setTimeout(() => {
      if (created.isDestroyed()) return
      const [x, y] = created.getPosition()
      try {
        saveMiniPlayerPrefs({ x, y })
      } catch (err) {
        console.warn('[mini-player] position could not be saved', err)
      }
    }, 500)
  })
  created.on('closed', () => {
    if (win === created) win = null
    host?.onClosed()
  })
  win = created
  host.load(created)
  return true
}

export function closeMiniPlayerWindow(): void {
  const open = miniPlayerWindow()
  if (open) open.close()
}
