/**
 * In-flight import downloads that the user may cancel, keyed by a caller-chosen id
 * (`url` for import:fromUrl, `cloud:<externalId>` for a cloud download).
 */
const active = new Map<string, AbortController>()

/** Start tracking a cancellable download; aborts any earlier one under the same key. */
export function beginCancellable(key: string): AbortController {
  active.get(key)?.abort()
  const controller = new AbortController()
  active.set(key, controller)
  return controller
}

/** Stop tracking `controller` (only if it is still the one registered under `key`). */
export function endCancellable(key: string, controller: AbortController): void {
  if (active.get(key) === controller) active.delete(key)
}

/** Abort the download registered under `key`. Returns whether one was running. */
export function cancelInFlight(key: string): boolean {
  const controller = active.get(key)
  if (!controller) return false
  controller.abort()
  active.delete(key)
  return true
}
