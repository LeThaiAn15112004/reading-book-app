/** Minimal `electron` for the PDF annotation checks: `ipcMain` records handlers so a spike can call them. */
export const handlers = new Map()

export const ipcMain = {
  handle(channel, fn) {
    handlers.set(channel, fn)
  },
  removeHandler(channel) {
    handlers.delete(channel)
  },
}

/** Invoke a registered handler the way `ipcRenderer.invoke` would (event object unused). */
export async function invoke(channel, ...args) {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`no handler for ${channel}`)
  return fn({}, ...args)
}

import os from 'node:os'
import path from 'node:path'

/** `userData` & co. point into a temp folder (the checks that need them only compare paths). */
export const app = {
  getPath: (name) => path.join(os.tmpdir(), 'readmate-spike-userdata', String(name)),
}

/** Used by the export handler (save dialog); the checks never open a real window or dialog. */
export const BrowserWindow = {
  fromWebContents: () => null,
  getAllWindows: () => [],
  getFocusedWindow: () => null,
}

export const dialog = {
  showSaveDialog: async () => ({ canceled: true }),
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
}

/** Used by the library handlers (copy path / show in folder); the checks only read what was recorded. */
export const clipboard = {
  text: '',
  writeText(value) {
    this.text = value
  },
}

export const shell = {
  shown: [],
  showItemInFolder(p) {
    this.shown.push(p)
  },
}

/** Imported (never used) by modules the library handlers pull in, e.g. the cover protocol. */
export const net = { fetch: async () => new Response(null, { status: 404 }) }
export const protocol = { handle() {}, registerSchemesAsPrivileged() {} }
