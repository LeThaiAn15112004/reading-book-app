import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Small JSON files under `{userData}` for preferences Main owns (tray / background, notifications,
 * reading reminders). Renderer-only preferences stay in localStorage.
 */

function filePath(name: string): string {
  return path.join(app.getPath('userData'), name)
}

/** Parsed JSON, or undefined when the file is missing or unreadable (callers fall back to defaults). */
export function readJsonPrefsFile(name: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath(name), 'utf8'))
  } catch {
    return undefined
  }
}

/** Atomic write (temp file + rename). Throws when the file can't be written. */
export function writeJsonPrefsFile(name: string, value: unknown): void {
  const file = filePath(name)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value), 'utf8')
  fs.renameSync(tmp, file)
}
