/** Typed wrappers for updates:* IPC via window.api. */

export type UpdateCheckResult = Awaited<ReturnType<typeof window.api.updates.check>>
export type UpdateChannel = UpdateCheckResult['channel']

export const updatesApi = {
  check: () => window.api.updates.check(),
}
