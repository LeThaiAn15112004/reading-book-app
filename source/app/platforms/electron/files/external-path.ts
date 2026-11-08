import { app } from 'electron'
import { isStoreBuild } from '../store/store-runtime'
import { mapForOtherApps, packageFamilyNameFromExecPath } from './external-path-core.mjs'

/**
 * Spec 010 (contracts/packaged-runtime.md "Paths given to other apps", research R7). An app-owned path handed to
 * ANOTHER program (Explorer, the default viewer, the clipboard) must be one that program can open. In the Store build,
 * files under userData are virtualised: other processes only find them at
 * %LOCALAPPDATA%\Packages\<PFN>\LocalCache\Roaming\<folder>\…, so the path is mapped there. Everything else — the
 * direct build, the user's own files — is returned unchanged.
 *
 * Every shell.openPath / showItemInFolder / openExternal(file:) on an app-owned path goes through this
 * (`npm run check:external-paths` fails otherwise).
 */
let warned = false

export function pathForOtherApps(p: string): string {
  if (!isStoreBuild()) return p
  const pfn = packageFamilyNameFromExecPath(process.execPath)
  if (!pfn && !warned) {
    warned = true
    console.warn(`external-path: no package family name in ${process.execPath}; app-owned paths are passed unmapped`)
  }
  return mapForOtherApps(p, { userData: app.getPath('userData'), localAppData: process.env.LOCALAPPDATA, pfn })
}
