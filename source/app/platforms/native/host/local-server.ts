import { Paths } from 'expo-file-system'

type LocalServerModule = typeof import('../modules/local-server').default

/** Fixed, because `localStorage` belongs to the origin: a changing port would lose every preference. */
export const LOCAL_SERVER_PORT = 47821

export interface LocalServerInfo {
  baseUrl: string
  /** Per launch; needed as `?t=` by `/books/{id}` and `/covers/{id}`. */
  token: string
}

/** Required on use, not imported: the native module throws at load in Expo Go, which cannot carry it. */
function localServer(): LocalServerModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- an import would load the module in Expo Go too
  return require('../modules/local-server').default
}

export async function startLocalServer(): Promise<LocalServerInfo> {
  return localServer().start(LOCAL_SERVER_PORT, Paths.document.uri)
}

export function isLocalServerRunning(): boolean {
  return localServer().isRunning()
}
