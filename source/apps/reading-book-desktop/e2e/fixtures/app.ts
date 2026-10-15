import { _electron as electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// Playwright resolves 'electron' from the hoisted root where it isn't installed — use this
// workspace's binary (see docs/implementation_plan/e2e_testing/e2e_testing_survey.md §9).
const electronPath = createRequire(path.join(desktopRoot, 'package.json'))('electron') as unknown as string

/** Launch the built app on `userData`. Exported so a spec can relaunch it on the same data. */
export function launchApp(userData: string): Promise<ElectronApplication> {
  return electron.launch({
    args: [path.join(desktopRoot, 'dist-electron/main.js'), `--user-data-dir=${userData}`],
    executablePath: electronPath,
    cwd: desktopRoot,
    env: { ...process.env, READMATE_E2E: '1' },
  })
}

export type ReaderApp = {
  app: ElectronApplication
  page: Page
  /** Throwaway dir for fixtures written by the spec (books are referenced in place, never copied). */
  workDir: string
  /** The app's isolated userData dir (SQLite, prefs) — reuse it with `launchApp` to relaunch. */
  userData: string
  /** Write a fixture file into `workDir` and return its absolute path. */
  writeFixture: (name: string, bytes: Buffer) => string
  /** Import `absPath` through the real "Add file" flow (native dialog stubbed in Main). */
  importBook: (absPath: string) => Promise<void>
}

export const test = base.extend<{ reader: ReaderApp }>({
  // eslint-disable-next-line no-empty-pattern
  reader: async ({}, use, testInfo) => {
    const tmp = mkdtempSync(path.join(tmpdir(), 'readmate-e2e-'))
    const userData = path.join(tmp, 'userData')
    const app = await launchApp(userData)
    const logs: string[] = []
    try {
      // Refuse to drive an instance that is not isolated in the temp dir.
      const reported = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
      if (path.resolve(reported) !== path.resolve(userData)) {
        throw new Error(`E2E userData is not isolated: ${reported}`)
      }
      const page = await app.firstWindow()
      page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`))
      page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`))
      await page.waitForLoadState('domcontentloaded')

      const reader: ReaderApp = {
        app,
        page,
        workDir: tmp,
        userData,
        writeFixture: (name, bytes) => {
          const file = path.join(tmp, name)
          writeFileSync(file, bytes)
          return file
        },
        importBook: async (absPath) => {
          await app.evaluate(({ dialog }, file) => {
            dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog
          }, absPath)
          await page.getByRole('button', { name: 'Add file from this device' }).first().click()
        },
      }
      await use(reader)
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('renderer-console', { body: logs.join('\n'), contentType: 'text/plain' })
      }
      await app.close().catch(() => {})
      rmSync(tmp, { recursive: true, force: true, maxRetries: 3 })
    }
  },
})

export { expect }
