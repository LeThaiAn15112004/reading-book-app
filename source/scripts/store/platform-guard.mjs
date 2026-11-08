// Spec 010: the Microsoft Store package is built on Windows only (research R11, FR-015).
// Store scripts call requireWindows() first; on any other system they print the skip line and exit 0,
// so the Ubuntu CI and macOS / Linux machines stay green.

export const SKIP_MESSAGE = 'skipped: the Microsoft Store package is built on Windows only'

/** Exits the process with 0 (after printing the skip line) when not on Windows. */
export function requireWindows(scriptName, platform = process.platform) {
  if (platform === 'win32') return
  console.log(`${scriptName}: ${SKIP_MESSAGE}`)
  process.exit(0)
}
