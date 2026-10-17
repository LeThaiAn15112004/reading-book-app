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

export const app = {
  getPath: () => {
    throw new Error('app.getPath is not available in the PDF annotation checks')
  },
}

/** Used by the export handler (save dialog); the checks never open a real window or dialog. */
export const BrowserWindow = {
  fromWebContents: () => null,
  getAllWindows: () => [],
}

export const dialog = {
  showSaveDialog: async () => ({ canceled: true }),
  showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
}
