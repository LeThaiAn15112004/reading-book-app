import { requireOptionalNativeModule } from 'expo'

type LocalServerNative = {
  /**
   * Serves the bundled UI on 127.0.0.1, plus `/books/{uuid}` and `/covers/{uuid}` from `documentDirUri` behind the
   * per-launch `token` (`?t=`). Idempotent; rejects when the port is taken.
   */
  start(port: number, documentDirUri: string): Promise<{ baseUrl: string; token: string }>
  stop(): Promise<void>
  isRunning(): boolean
}

/**
 * `null` when the running binary does not carry the module: Expo Go, or a native build made before the module (or
 * before an SDK upgrade) — `npm run android` rebuilds it. Callers decide what to do; loading never throws.
 */
export default requireOptionalNativeModule<LocalServerNative>('LocalServer')
