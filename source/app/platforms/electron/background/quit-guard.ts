/**
 * Spec 016 (FR-013a, research R11): quitting while imports run or wait asks first.
 *
 * The renderer queue reports its size on `import:reportActivity`. Before a real quit (`before-quit`, or a window close
 * that quits because Run in Background is off) with imports pending, Main shows ONE confirmation naming how many:
 * Cancel keeps the app and the imports going; Quit sends `import:cancelAll` to the renderer, waits at most 3 s for the
 * running job's cleanup, then quits. A system shutdown / log-off never asks (the startup sweep cleans up).
 */
import { BrowserWindow, dialog } from 'electron'
import { tMain } from '../i18n/main-translate'
import { ImportChannels } from '../ipc/channels'

/** How long a confirmed quit waits for the renderer to report the running import stopped. */
export const CANCEL_ALL_WAIT_MS = 3000

let activity = { running: 0, waiting: 0 }
let confirmed = false
let shuttingDown = false
let asking: Promise<boolean> | null = null
let idleWaiters: (() => void)[] = []

/** `import:reportActivity` — untrusted input: two non-negative integers, else ignored. */
export function setImportActivity(input: unknown): boolean {
  const { running, waiting } = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const valid = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 100_000
  if (!valid(running) || !valid(waiting)) return false
  activity = { running, waiting }
  if (running === 0) {
    const waiters = idleWaiters
    idleWaiters = []
    for (const resolve of waiters) resolve()
  }
  return true
}

export function pendingImports(): number {
  return activity.running + activity.waiting
}

/** The OS is shutting down / logging off: quit without asking. */
export function markShuttingDown(): void {
  shuttingDown = true
}

export function quitConfirmed(): boolean {
  return confirmed
}

/** Pure rule (unit-checkable): ask only with pending imports, not yet confirmed, and not a shutdown. */
export function decideQuit(input: { pending: number; confirmed: boolean; shuttingDown: boolean }): 'proceed' | 'ask' {
  return input.pending > 0 && !input.confirmed && !input.shuttingDown ? 'ask' : 'proceed'
}

/** `decideQuit` with the current state. */
export function shouldAskBeforeQuit(): boolean {
  return decideQuit({ pending: pendingImports(), confirmed, shuttingDown }) === 'ask'
}

function waitUntilIdle(ms: number): Promise<void> {
  if (activity.running === 0) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    idleWaiters.push(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/**
 * Asks once (a second request while the dialog is open shares the answer). `true` = the reader chose Quit: every
 * import has been asked to cancel and the running one had up to 3 s to clean up.
 */
export function confirmQuitWithImports(parent?: BrowserWindow | null): Promise<boolean> {
  asking ??= (async () => {
    const count = pendingImports()
    const options: Electron.MessageBoxOptions = {
      type: 'warning',
      buttons: [tMain('main.messages.import.quitConfirm.quit'), tMain('main.messages.import.quitConfirm.cancel')],
      defaultId: 1,
      cancelId: 1,
      title: tMain('main.messages.import.quitConfirm.title'),
      message: tMain('main.messages.import.quitConfirm.message', { count }),
      noLink: true,
    }
    const win = parent && !parent.isDestroyed() ? parent : undefined
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    if (response !== 0) return false
    confirmed = true
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(ImportChannels.cancelAll)
    }
    await waitUntilIdle(CANCEL_ALL_WAIT_MS)
    return true
  })().finally(() => {
    asking = null
  })
  return asking
}
