import { isRunningInExpoGo } from 'expo'
import Constants, { ExecutionEnvironment } from 'expo-constants'

import { isLocalServerAvailable, startLocalServer } from './local-server'

/**
 * Where the UI page comes from, and what the RPC origin check, `originWhitelist` and navigation checks accept.
 * `token` is null in Expo Go, which has no local server and so no book or cover routes.
 */
export type UiSource = { url: string; origin: string; baseUrl: string | null; token: string | null }

/**
 * Expo Go has no local server, so its UI comes from Metro. A release build can never take this route.
 * `isRunningInExpoGo()` (the `ExpoGo` native module) is the reliable signal: since SDK 58 `StoreClient` also covers
 * development builds, and Expo Go is not guaranteed to report it.
 */
export function isExpoGoDevelopment(): boolean {
  return __DEV__ && (isRunningInExpoGo() || Constants.executionEnvironment === ExecutionEnvironment.StoreClient)
}

function metroUiSource(): UiSource {
  const hostUri = Constants.expoConfig?.hostUri
  if (!hostUri) throw new Error('Expo did not report the address of the computer running Metro.')
  const origin = `http://${hostUri}`
  return { url: `${origin}/readmate-ui/index.html`, origin, baseUrl: null, token: null }
}

export async function resolveUiSource(): Promise<UiSource> {
  if (isExpoGoDevelopment()) return metroUiSource()
  if (!isLocalServerAvailable()) {
    // A development binary built before the module (or before an SDK upgrade): keep it usable from Metro, without
    // book or cover routes, like Expo Go. A release build never takes this route: `startLocalServer` throws instead.
    if (__DEV__) {
      console.warn("[readmate] No 'LocalServer' native module in this build: UI from Metro. Rebuild with npm run android.")
      return metroUiSource()
    }
  }
  const { baseUrl, token } = await startLocalServer()
  return { url: `${baseUrl}/index.html`, origin: baseUrl, baseUrl, token }
}
