/**
 * Module-level registry so Electron quit handshake (and other chrome exits)
 * can flush the active Reader session without prop-drilling.
 */

type FlushHandler = () => Promise<void>

let handler: FlushHandler | null = null

/** Register the active Reader flush; returns unregister. */
export function registerSessionFlushHandler(next: FlushHandler): () => void {
  handler = next
  return () => {
    if (handler === next) handler = null
  }
}

/** Run the registered flush if any (no-op when Reader is not mounted). */
export async function flushRegisteredSession(): Promise<void> {
  if (!handler) return
  await handler()
}
