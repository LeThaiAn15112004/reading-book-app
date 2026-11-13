import { app } from 'electron'
import path from 'node:path'

/**
 * Spec 010 (contracts/packaged-runtime.md, research R4) — what differs when Readmate runs from its Microsoft Store
 * (MSIX) package. The direct (NSIS) build never takes these branches.
 *
 * Why the Store build needs its own userData folder: in a packaged full-trust app, Windows redirects NEW files under
 * AppData into the package's private store, but lets the app modify files that ALREADY exist in the real AppData in
 * place. With the direct build's folder name (`reading-book-desktop`) the Store build would open the direct build's
 * real `reading-book.db` and write into it (it did, 2026-11-08: docs/implementation_plan/msix_store_packaging.md).
 * `Readmate Reader Store` never exists in the real AppData, so everything the Store build writes stays private to the
 * package and is removed on uninstall.
 */

/** userData folder name (under %APPDATA%) of the Store build. */
export const STORE_USER_DATA_DIR_NAME = 'Readmate Reader Store' // i18n-ignore: folder name on disk
/** userData folder name of the direct (NSIS / dev) build — `extraMetadata.name` in electron-builder.json5. */
export const DIRECT_USER_DATA_DIR_NAME = 'reading-book-desktop'

/** Running from the Microsoft Store (MSIX) package. Electron sets `process.windowsStore` for packaged apps. */
export function isStoreBuild(): boolean {
  return process.windowsStore === true
}

/**
 * Store build: point userData at its own folder. MUST run before anything reads userData — before
 * `requestSingleInstanceLock()` (the lock follows userData), before any store / prefs / database is opened. It is called
 * by `store-userdata-first.ts`, the first import of main.ts.
 */
export function applyStoreUserData(): void {
  if (!isStoreBuild()) return
  app.setPath('userData', path.join(app.getPath('appData'), STORE_USER_DATA_DIR_NAME))
}
