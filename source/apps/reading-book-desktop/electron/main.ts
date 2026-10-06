import { app, BrowserWindow, Menu, ipcMain, powerMonitor } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { OAUTH_CUSTOM_SCHEME } from '@reading-book/config'
import {
  registerCoverProtocol,
  registerCoverSchemePrivileged,
} from './files/cover-protocol'
import {
  disposeTray,
  hasTray,
  initBackgroundMode,
  isQuitting,
  markQuitting,
  shouldHideOnClose,
} from './background/background-mode'
import { HIDDEN_AT_STARTUP_ARG, wasLaunchedAtLogin } from './background/login-item'
import { afterHideFlush, decideWindowClose } from './background/close-decision'
import { disposeBookChunkWorkers } from './chunking/book-chunk-service'
import { disposeTranslationWorker } from './translation/translation-service'
import { ensureBooksSandbox } from './files/sandbox'
import { registerAllIpcHandlers } from './ipc'
import { installFullscreenShortcuts } from './ipc/app.ipc'
import { AppChannels, NotificationChannels } from './ipc/channels'
import type { ReminderOpenBookDto } from './ipc/api-types'
import { initNotificationSettings } from './notifications/notification-settings'
import type { BookInProgress } from './reminders/reading-activity'
import { startReadingReminders, stopReadingReminders } from './reminders/reading-reminders'
import { handleOAuthCallbackUrl } from './ipc/cloud.ipc'
import { closeDatabase, openDatabase } from './persistence/db'
import { backfillLibraryMetadataFromFiles } from './persistence/backfill-library-metadata'
import {
  TITLE_BAR_OVERLAY_HEIGHT,
  titleBarOverlayOptions,
} from './theme/titlebar-overlay'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DEFAULT_OVERLAY = titleBarOverlayOptions('night')

/**
 * Windows shows notifications under an AppUserModelID. Packaged builds must use the installer's
 * `appId` (electron-builder.json5 — keep in sync); unpackaged dev runs use the exe path.
 */
const APP_USER_MODEL_ID = 'YourAppID'

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
/** The close button hid the window (Run in Background) — the app is still running. */
let hiddenInBackground = false

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

/** Bring the main window back: un-hide (Run in Background), restore, focus — or recreate it. */
function showMainWindow(): void {
  if (!win || win.isDestroyed()) {
    createWindow()
    return
  }
  hiddenInBackground = false
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/**
 * Reading-reminder notification clicked: bring the window back and tell the renderer which book to
 * open (after it has loaded, if the window had to be created).
 */
function openBookFromReminder(book: BookInProgress | null): void {
  showMainWindow()
  const target = win
  if (!book || !target || target.isDestroyed()) return
  const payload: ReminderOpenBookDto = { bookId: book.bookId, title: book.title }
  const send = () => {
    if (!target.isDestroyed()) target.webContents.send(NotificationChannels.openBook, payload)
  }
  if (target.webContents.isLoadingMainFrame()) target.webContents.once('did-finish-load', send)
  else send()
}

/** Hands a `readmate-reader://` URL to its consumer(s) and brings the app window to the front. */
function routeDeepLink(url: string): void {
  handleOAuthCallbackUrl(url)

  if (!win || win.isDestroyed()) return
  showMainWindow()
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

/** `showOnReady: false` = Start at Login launch: the window loads but stays hidden in the tray. */
function createWindow({ showOnReady = true }: { showOnReady?: boolean } = {}) {
  const isMac = process.platform === 'darwin'
  sessionFlushDone = false
  flushingClose = false
  hiddenInBackground = false

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

  // Close button:
  //  - Run in Background (tray on, not quitting): flush session → hide; the app keeps running.
  //  - Otherwise (T4.2): intercept first close → flush session → close again (safe for Cmd+Q).
  //    A quit (`isQuitting()`, raised by before-quit / tray Quit / OS shutdown) always takes this
  //    path, so the window can never refuse to close while the app is quitting.
  win.on('close', (event) => {
    const target = win
    if (!target || target.isDestroyed()) return

    const decision = decideWindowClose({
      flushing: flushingClose,
      sessionFlushed: sessionFlushDone,
      hideOnClose: shouldHideOnClose(),
    })
    if (decision === 'close') return

    if (decision === 'flush-then-hide') {
      event.preventDefault()
      flushingClose = true
      void requestSessionFlush(target).finally(() => {
        flushingClose = false
        if (target.isDestroyed()) return
        if (afterHideFlush(isQuitting()) === 'close-and-quit') {
          // A quit started while saving — close for real now (session is already flushed).
          sessionFlushDone = true
          target.close()
          app.quit()
          return
        }
        hiddenInBackground = true
        target.hide()
      })
      return
    }

    event.preventDefault()
    flushingClose = true
    void requestSessionFlush(target).finally(() => {
      sessionFlushDone = true
      flushingClose = false
      if (!target.isDestroyed()) {
        target.close()
      }
      if (isQuitting()) {
        app.quit()
      }
    })
  })

  // Windows shutdown / restart / log-off closes windows without before-quit: treat it as a quit
  // so a background-mode window doesn't block the session from ending. `query-session-end` comes
  // first (before the windows get `close`); `session-end` is the backstop.
  win.on('query-session-end', () => {
    markQuitting()
  })
  win.on('session-end', () => {
    markQuitting()
  })

  win.on('closed', () => {
    if (win === null || win.isDestroyed()) win = null
  })

  win.once('ready-to-show', () => {
    if (!showOnReady) {
      // Loaded (so session flush / reminders' open-book work) but not shown until the tray opens it.
      hiddenInBackground = true
      return
    }
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
  } else if (hiddenInBackground) {
    // Dock click while the window was hidden by Run in Background.
    showMainWindow()
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
  } else if (argv.includes(HIDDEN_AT_STARTUP_ARG)) {
    // A login launch while already running: stay as we are.
  } else if (win && !win.isDestroyed()) {
    // Launching the app again also reopens a window hidden by Run in Background.
    showMainWindow()
  }
})

// Every quit path (Cmd+Q, tray / Settings Quit, app.quit()) passes here: mark it so the close
// handler closes instead of hiding, and the deferred window close can re-enter app.quit().
app.on('before-quit', () => {
  markQuitting()
})

// Close DB after flush handshake / window close (not before — T4.2).
app.on('will-quit', () => {
  // Reminder worker queries the DB — stop it before closeDatabase() below.
  stopReadingReminders()
  disposeTray()
  disposeBookChunkWorkers()
  disposeTranslationWorker()
  closeDatabase()
})

app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId(app.isPackaged ? APP_USER_MODEL_ID : process.execPath)
  }
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
  // Tray + Run in Background prefs (Main-owned) before the window, so its close button knows them.
  initBackgroundMode({ showWindow: showMainWindow, publicDir: process.env.VITE_PUBLIC })
  initNotificationSettings()
  // macOS / Linux shutdown or reboot: quit instead of hiding.
  powerMonitor.on('shutdown', () => {
    markQuitting()
  })
  // Start at Login: stay hidden in the tray — only when the tray exists, so there is a way back.
  const startHidden = wasLaunchedAtLogin(process.argv) && hasTray()
  createWindow({ showOnReady: !startHidden })
  startReadingReminders({ openBook: openBookFromReminder })

  // Cold start via a readmate-reader:// link (Windows/Linux first instance) — Cloud Sources
  // connect() only starts listening after this, so this is a defensive no-op today, not a live path.
  const coldStartUrl = findDeepLinkArg(process.argv)
  if (coldStartUrl) {
    routeDeepLink(coldStartUrl)
  }
})
