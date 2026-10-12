/**
 * E2E spike (step 1): launch the BUILT app with a throwaway userData dir and report what Playwright
 * can see. Run `npx vite build` first. Usage: node spikes/e2e-launch/launch.mjs [screenshot.png]
 */
import { _electron as electron } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// Playwright resolves 'electron' from its own (hoisted) location; use the desktop workspace's binary.
const electronPath = createRequire(import.meta.url)('electron')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tmp = mkdtempSync(path.join(tmpdir(), 'readmate-e2e-'))
const userData = path.join(tmp, 'userData')
const shot = process.argv[2] ?? path.join(tmp, 'launch.png')

const app = await electron.launch({
  args: [path.join(root, 'dist-electron/main.js'), `--user-data-dir=${userData}`],
  executablePath: electronPath,
  cwd: root,
  env: { ...process.env, READMATE_E2E: '1' },
})
try {
  const reported = await app.evaluate(({ app }) => ({
    userData: app.getPath('userData'),
    isPackaged: app.isPackaged,
    version: process.versions.electron,
  }))
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.waitForTimeout(2500)
  const info = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()
    return { windows: w.length, visible: w.map((x) => x.isVisible()) }
  })
  await win.screenshot({ path: shot })
  console.log(JSON.stringify({ ...reported, ...info, title: await win.title(), url: win.url(), shot, userDataIsInsideTmp: reported.userData.startsWith(tmp) }, null, 2))
} finally {
  await app.close()
  rmSync(tmp, { recursive: true, force: true, maxRetries: 3 })
}
