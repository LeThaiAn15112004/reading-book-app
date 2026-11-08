// Spec 010 T031 (contracts/packaged-runtime.md "Start at Login", data-model §7) — pure, no Electron, so a `node --test`
// can load it (source/scripts/store/startup-task.test.mjs). store-startup-task.ts runs the PowerShell bridge and feeds
// its output here.

/** Windows.ApplicationModel.StartupTaskState → StartAtLoginDto.state + enabled. */
const STATES = {
  Enabled: { enabled: true, state: 'enabled' },
  Disabled: { enabled: false, state: 'disabled' },
  DisabledByUser: { enabled: false, state: 'disabledByUser' },
  DisabledByPolicy: { enabled: false, state: 'disabledByPolicy' },
  EnabledByPolicy: { enabled: true, state: 'enabledByPolicy' },
}

/** What the app shows when the bridge failed, timed out or answered something unknown. */
export const MANAGED_BY_WINDOWS = Object.freeze({ supported: true, enabled: false, state: 'managedByWindows' })

/**
 * StartAtLoginDto from the bridge's stdout and exit code (`null` = killed / timed out). The bridge prints exactly one
 * JSON line; anything else → `managedByWindows`.
 */
export function startAtLoginFromOutput(stdout, exitCode) {
  if (exitCode !== 0 || typeof stdout !== 'string') return { ...MANAGED_BY_WINDOWS }
  const last = stdout.trim().split(/\r?\n/).pop() ?? ''
  let parsed
  try {
    parsed = JSON.parse(last)
  } catch {
    return { ...MANAGED_BY_WINDOWS }
  }
  const mapped = parsed && typeof parsed.state === 'string' ? STATES[parsed.state] : undefined
  return mapped ? { supported: true, ...mapped } : { ...MANAGED_BY_WINDOWS }
}

/** The app may switch the task itself only from these states; the others are Windows' (user / policy / unknown). */
export function canChangeStartAtLogin(state) {
  return state === undefined || state === 'enabled' || state === 'disabled'
}

/** The bridge operation for a requested change, or null when nothing must run (already there, or not ours to change). */
export function startupTaskOperation(current, enabled) {
  if (!canChangeStartAtLogin(current.state)) return null
  if (current.enabled === enabled) return null
  return enabled ? 'enable' : 'disable'
}
