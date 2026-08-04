import { app, BrowserWindow, Menu, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  registerCoverProtocol,
  registerCoverSchemePrivileged,
} from './files/cover-protocol'
import { ensureBooksSandbox } from './files/sandbox'
import { registerAllIpcHandlers } from './ipc'
import { AppChannels } from './ipc/channels'
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
  })

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

// Mark quit intent so deferred window close can re-enter app.quit() (macOS Cmd+Q).
app.on('before-quit', () => {
  quitAfterFlush = true
})

// Close DB after flush handshake / window close (not before — T4.2).
app.on('will-quit', () => {
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
})
