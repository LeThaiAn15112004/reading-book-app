import { requireNativeModule } from 'expo-modules-core'

type LocalServerNative = {
  /**
   * Serves the bundled UI on 127.0.0.1, plus `/books/{uuid}` and `/covers/{uuid}` from `documentDirUri` behind the
   * per-launch `token` (`?t=`). Idempotent; rejects when the port is taken.
   */
  start(port: number, documentDirUri: string): Promise<{ baseUrl: string; token: string }>
  stop(): Promise<void>
  isRunning(): boolean
}

export default requireNativeModule<LocalServerNative>('LocalServer')
