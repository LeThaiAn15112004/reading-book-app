import { app } from 'electron'
import path from 'node:path'
import type { StartAtLoginDto } from '../ipc/api-types'

/**
 * Settings → Background / System Tray → Start at Login. The OS login-item list is the source of
 * truth (nothing is stored by the app). A login launch carries `--hidden-at-startup` (Windows) or is
 * reported by `wasOpenedAtLogin` (macOS), and then starts in the tray without showing the window.
 */
export const HIDDEN_AT_STARTUP_ARG = '--hidden-at-startup'

function isSupported(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin'
}

/**
 * Windows login item = exe + args. In dev (`npm run dev`) the exe is the bare electron.exe, so the
 * app path has to be passed too (same reason as the protocol-client registration in main.ts).
 */
function windowsLoginItem(): { path: string; args: string[] } {
  const appArgs = process.defaultApp && process.argv.length >= 2 ? [path.resolve(process.argv[1])] : []
  return { path: process.execPath, args: [...appArgs, HIDDEN_AT_STARTUP_ARG] }
}

export function getStartAtLogin(): StartAtLoginDto {
  if (!isSupported()) return { supported: false, enabled: false }
  const settings =
    process.platform === 'win32' ? app.getLoginItemSettings(windowsLoginItem()) : app.getLoginItemSettings()
  return { supported: true, enabled: settings.openAtLogin }
}

export function setStartAtLogin(enabled: boolean): StartAtLoginDto {
  if (!isSupported()) return getStartAtLogin()
  if (process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: enabled, ...windowsLoginItem() })
  } else {
    app.setLoginItemSettings({ openAtLogin: enabled })
  }
  return getStartAtLogin()
}

/** This process was started by the OS at login (so it should stay hidden in the tray). */
export function wasLaunchedAtLogin(argv: readonly string[]): boolean {
  if (argv.includes(HIDDEN_AT_STARTUP_ARG)) return true
  if (process.platform === 'darwin') {
    try {
      return app.getLoginItemSettings().wasOpenedAtLogin === true
    } catch {
      return false
    }
  }
  return false
}
