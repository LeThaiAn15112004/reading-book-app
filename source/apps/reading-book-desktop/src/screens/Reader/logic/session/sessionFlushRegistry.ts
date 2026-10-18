/**
 * Module-level registry so Electron quit handshake (and other chrome exits)
 * can flush the active Reader session without prop-drilling.
 *
 * More than one thing can need flushing before the window closes (the reading position, and for a
 * TXT book the edited text), so handlers are a set; all of them run, and one failing doesn't stop
 * the others.
 */

type FlushHandler = () => Promise<void>

const handlers = new Set<FlushHandler>()

/** Register a Reader flush; returns unregister. */
export function registerSessionFlushHandler(next: FlushHandler): () => void {
  handlers.add(next)
  return () => {
    handlers.delete(next)
  }
}

/** Run every registered flush (no-op when Reader is not mounted). */
export async function flushRegisteredSession(): Promise<void> {
  await Promise.allSettled([...handlers].map((handler) => handler()))
}
