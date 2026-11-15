import { Paths } from 'expo-file-system'

type LocalServerModule = NonNullable<typeof import('../modules/local-server').default>

/** Fixed, because `localStorage` belongs to the origin: a changing port would lose every preference. */
export const LOCAL_SERVER_PORT = 47821

export interface LocalServerInfo {
  baseUrl: string
  /** Per launch; needed as `?t=` by `/books/{id}` and `/covers/{id}`. */
  token: string
}

/** Thrown when the installed binary has no `LocalServer` module (built before it, or before an SDK upgrade). */
export const LOCAL_SERVER_MISSING_MESSAGE =
  "This build of the app has no local server module ('LocalServer'). Rebuild and reinstall the native app: npm run android."

/** Required on use, not imported, so the module is only looked up when the host needs it. */
function optionalLocalServer(): LocalServerModule | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- looked up on use, not at module load
  return (require('../modules/local-server').default as LocalServerModule | null) ?? null
}

function localServer(): LocalServerModule {
  const module = optionalLocalServer()
  if (!module) throw new Error(LOCAL_SERVER_MISSING_MESSAGE)
  return module
}

/** Whether the running binary carries the native module (false in Expo Go and in a stale native build). */
export function isLocalServerAvailable(): boolean {
  return optionalLocalServer() !== null
}

export async function startLocalServer(): Promise<LocalServerInfo> {
  return localServer().start(LOCAL_SERVER_PORT, Paths.document.uri)
}

export function isLocalServerRunning(): boolean {
  return localServer().isRunning()
}
