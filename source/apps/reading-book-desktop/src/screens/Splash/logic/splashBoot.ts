import { appApi } from '../../../bridge'

/** Min brand display so a fast boot does not flash past the splash. SDS: ~0.8–1.5s. */
export const MIN_BRAND_MS = 1000

/** Max wait for Main IPC probe before leaving Splash with an error (SDS SCR-00). */
export const INIT_TIMEOUT_MS = 10_000

export async function probeReady(): Promise<void> {
  await appApi.ping()
  await appApi.getAppInfo()
}
