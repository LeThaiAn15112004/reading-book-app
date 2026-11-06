/** Typed wrappers for updates:* IPC via api. */

import { api } from '../platforms/api'
export type UpdateCheckResult = Awaited<ReturnType<typeof api.updates.check>>
export type UpdateChannel = UpdateCheckResult['channel']

export const updatesApi = {
  check: () => api.updates.check(),
}
