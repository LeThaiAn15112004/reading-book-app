// Hidden Electron window used by run-pdf-typewriter-font.mjs (M0-5 + pixel check). argv: <job.json> <result.json>
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const [jobPath, resultPath] = process.argv.slice(-2)
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1000, height: 1200, webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false } })
  ipcMain.once('probe-result', (_e, result) => {
    fs.writeFileSync(resultPath, JSON.stringify(result))
    app.quit()
  })
  win.webContents.on('console-message', (_e, _l, message) => console.log('[page]', message))
  win.webContents.on('render-process-gone', () => app.exit(3))
  await win.loadFile(path.join(__dirname, 'probe.html'), { query: { job: jobPath } })
})
setTimeout(() => app.exit(4), 90000)
