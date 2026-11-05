import Constants, { ExecutionEnvironment } from 'expo-constants'

import { startLocalServer } from './local-server'

/**
 * Where the UI page comes from, and what the RPC origin check, `originWhitelist` and navigation checks accept.
 * `token` is null in Expo Go, which has no local server and so no book or cover routes.
 */
export type UiSource = { url: string; origin: string; baseUrl: string | null; token: string | null }

/** Expo Go has no local server, so its UI comes from Metro. A release build can never take this route. */
export function isExpoGoDevelopment(): boolean {
  return __DEV__ && Constants.executionEnvironment === ExecutionEnvironment.StoreClient
}

export async function resolveUiSource(): Promise<UiSource> {
  if (isExpoGoDevelopment()) {
    const hostUri = Constants.expoConfig?.hostUri
    if (!hostUri) throw new Error('Expo Go did not report the address of the computer running Metro.')
    const origin = `http://${hostUri}`
    return { url: `${origin}/readmate-ui/index.html`, origin, baseUrl: null, token: null }
  }
  const { baseUrl, token } = await startLocalServer()
  return { url: `${baseUrl}/index.html`, origin: baseUrl, baseUrl, token }
}
