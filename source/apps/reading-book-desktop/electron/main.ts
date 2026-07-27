import { app, BrowserWindow, Menu } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  registerCoverProtocol,
  registerCoverSchemePrivileged,
} from './files/cover-protocol'
import { ensureBooksSandbox } from './files/sandbox'
import { registerAllIpcHandlers } from './ipc'
import { closeDatabase, openDatabase } from './persistence/db'
import { backfillLibraryMetadataFromFiles } from './persistence/backfill-library-metadata'
import {
  TITLE_BAR_OVERLAY_HEIGHT,
  titleBarOverlayOptions,
} from './theme/titlebar-overlay'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DEFAULT_OVERLAY = titleBarOverlayOptions('night')

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

app.on('before-quit', () => {
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
