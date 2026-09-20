import { app, BrowserWindow, Menu, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { OAUTH_CUSTOM_SCHEME } from '@reading-book/config'
import {
  registerCoverProtocol,
  registerCoverSchemePrivileged,
} from './files/cover-protocol'
import { disposeBookChunkWorkers } from './chunking/book-chunk-service'
import { ensureBooksSandbox } from './files/sandbox'
import { registerAllIpcHandlers } from './ipc'
import { installFullscreenShortcuts } from './ipc/app.ipc'
import { AppChannels } from './ipc/channels'
import { handleOAuthCallbackUrl } from './ipc/cloud.ipc'
import { closeDatabase, openDatabase } from './persistence/db'
import { backfillLibraryMetadataFromFiles } from './persistence/backfill-library-metadata'
import {
  TITLE_BAR_OVERLAY_HEIGHT,
  titleBarOverlayOptions,
} from './theme/titlebar-overlay'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DEFAULT_OVERLAY = titleBarOverlayOptions('night')

/** Max wait for renderer session flush before closing the window (T4.2). */
const FLUSH_BEFORE_CLOSE_TIMEOUT_MS = 2000

// Custom schemes must be registered before app is ready.
registerCoverSchemePrivileged()

// Claim the readmate-reader:// scheme so the OS routes Cloud Sources OAuth callbacks back to this
// app (see electron-builder.json5 `protocols` for the packaged-build registration, and
// ipc/cloud.ipc.ts for how the callback is consumed).
//
// In dev (`npm run dev`), process.execPath is the raw electron.exe binary and process.defaultApp
// is true — registering the scheme without execPath/args points the OS handler at a bare
// electron.exe with no script path, so OAuth redirects launch a blank Electron instance instead
// of this app and the pending callback promise just times out. Electron's own docs call this out:
// https://www.electronjs.org/docs/latest/api/app#appsetasdefaultprotocolclientprotocol-path-args
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(OAUTH_CUSTOM_SCHEME, process.execPath, [path.resolve(process.argv[1])])
  }
} else if (!app.isDefaultProtocolClient(OAUTH_CUSTOM_SCHEME)) {
  app.setAsDefaultProtocolClient(OAUTH_CUSTOM_SCHEME)
}

/** Windows/Linux only get a single running instance so second-instance deep links can be forwarded. */
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

/** First close intercepted until renderer flush acks (or times out). */
let sessionFlushDone = false
let flushingClose = false
/** Set when app.quit / Cmd+Q started — re-quit after deferred window close. */
let quitAfterFlush = false

/**
 * Ask renderer to flush reading session; resolve on ack or timeout.
 * Keeps SQLite open until the save IPC can finish.
 */
function requestSessionFlush(target: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      ipcMain.removeListener(AppChannels.flushSessionDone, onDone)
      resolve()
    }

    const onDone = () => {
      finish()
    }

    const timer = setTimeout(finish, FLUSH_BEFORE_CLOSE_TIMEOUT_MS)
    ipcMain.once(AppChannels.flushSessionDone, onDone)

    try {
      if (
        target.isDestroyed() ||
        target.webContents.isDestroyed() ||
        target.webContents.isLoadingMainFrame()
      ) {
        finish()
        return
      }
      target.webContents.send(AppChannels.requestFlushSession)
    } catch {
      finish()
    }
  })
}

/** Drop File/Edit/View chrome; keep a minimal macOS menu for Quit / edit shortcuts. */
function installApplicationMenu(): void {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
        { role: 'editMenu' },
        { role: 'windowMenu' },
      ]),
    )
    return
  }

  Menu.setApplicationMenu(null)
}

/** Picks the first `readmate-reader://` URL out of a process argv list (Windows/Linux deep links). */
function findDeepLinkArg(argv: readonly string[]): string | undefined {
  return argv.find((arg) => arg.startsWith(`${OAUTH_CUSTOM_SCHEME}://`))
}

/** Hands a `readmate-reader://` URL to its consumer(s) and brings the app window to the front. */
function routeDeepLink(url: string): void {
  handleOAuthCallbackUrl(url)

  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.focus()
}

/** F12 / Ctrl+Shift+I toggle DevTools while running against Vite dev server. */
function installDevToolsShortcuts(target: BrowserWindow): void {
  if (!VITE_DEV_SERVER_URL) return

  target.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return

    const isF12 = input.key === 'F12'
    const isCtrlShiftI =
      input.key === 'I' &&
      input.control &&
      input.shift &&
      !input.alt &&
      !input.meta

    if (!isF12 && !isCtrlShiftI) return

    if (target.webContents.isDevToolsOpened()) {
      target.webContents.closeDevTools()
    } else {
      target.webContents.openDevTools({ mode: 'detach' })
    }
    event.preventDefault()
  })
}

function createWindow() {
  const isMac = process.platform === 'darwin'
  sessionFlushDone = false
  flushingClose = false

  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: DEFAULT_OVERLAY.color,
    autoHideMenuBar: true,
    // Custom chrome: remove OS gray title strip; keep native window controls.
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 14, y: 10 } }
      : {
          titleBarOverlay: {
            color: DEFAULT_OVERLAY.color,
            symbolColor: DEFAULT_OVERLAY.symbolColor,
            height: TITLE_BAR_OVERLAY_HEIGHT,
          },
        }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // T4.2: intercept first close → flush session → close again (safe for Cmd+Q).
  win.on('close', (event) => {
    const target = win
    if (!target || target.isDestroyed()) return
    if (sessionFlushDone || flushingClose) return

    event.preventDefault()
    flushingClose = true
    void requestSessionFlush(target).finally(() => {
      sessionFlushDone = true
      flushingClose = false
      if (!target.isDestroyed()) {
        target.close()
      }
      if (quitAfterFlush) {
        app.quit()
      }
    })
  })

  win.on('closed', () => {
    if (win === null || win.isDestroyed()) win = null
  })

  win.once('ready-to-show', () => {
    win?.show()
    // Detached DevTools window on every launch while running against the
    // Vite dev server — F12 / Ctrl+Shift+I (installDevToolsShortcuts below)
    // still toggles it manually.
    if (VITE_DEV_SERVER_URL) {
      win?.webContents.openDevTools({ mode: 'detach' })
    }
  })

  installDevToolsShortcuts(win)
  installFullscreenShortcuts(win)

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// macOS delivers readmate-reader:// links here, whether or not the app was already running.
app.on('open-url', (event, url) => {
  event.preventDefault()
  routeDeepLink(url)
})

// Windows/Linux relaunch a second process for the deep link; requestSingleInstanceLock() above
// forwards its argv here instead and lets that second process exit.
app.on('second-instance', (_event, argv) => {
  const url = findDeepLinkArg(argv)
  if (url) {
    routeDeepLink(url)
  } else if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

// Mark quit intent so deferred window close can re-enter app.quit() (macOS Cmd+Q).
app.on('before-quit', () => {
  quitAfterFlush = true
})

// Close DB after flush handshake / window close (not before — T4.2).
app.on('will-quit', () => {
  disposeBookChunkWorkers()
  closeDatabase()
})

app.whenReady().then(async () => {
  installApplicationMenu()
  ensureBooksSandbox()
  openDatabase()
  try {
    await backfillLibraryMetadataFromFiles()
  } catch (err) {
    console.error('Library metadata backfill failed:', err)
  }
  registerCoverProtocol()
  registerAllIpcHandlers()
  createWindow()

  // Cold start via a readmate-reader:// link (Windows/Linux first instance) — Cloud Sources
  // connect() only starts listening after this, so this is a defensive no-op today, not a live path.
  const coldStartUrl = findDeepLinkArg(process.argv)
  if (coldStartUrl) {
    routeDeepLink(coldStartUrl)
  }
})
