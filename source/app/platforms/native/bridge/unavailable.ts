/**
 * What the first release does not offer on Mobile (spec 008, T062; `contracts/mobile-bridge.md`).
 *
 *   - Safe empty results for what screens call while reading (`listInk`, watches, fullscreen, every `on*`).
 *   - A method whose result has an `errorCode` resolves with its own failure shape and `errorCode: 'not_available'`.
 *   - Every other method rejects with `NotAvailableOnPlatformError`.
 *
 * Reaching one of the last two in normal use is a bug: the phone UI hides these features (`contracts/phone-ui.md`).
 * Every such call is also reported to `onUnavailable`, which the journey log (T064) records.
 */

export class NotAvailableOnPlatformError extends Error {
  readonly code = 'NOT_AVAILABLE_ON_PLATFORM'
  constructor(readonly method: string) {
    super(`${method} is not available on this device`)
    this.name = 'NotAvailableOnPlatformError'
  }
}

export type UnavailableReporter = (method: string) => void

let reporter: UnavailableReporter = () => {}

export function setUnavailableReporter(next: UnavailableReporter): void {
  reporter = next
}

/** Rejects with `NotAvailableOnPlatformError`. */
export function notAvailable(method: string): (...args: unknown[]) => Promise<never> {
  return () => {
    reporter(method)
    return Promise.reject(new NotAvailableOnPlatformError(method))
  }
}

/** Resolves with the method's own failure shape and `errorCode: 'not_available'`. */
export function notAvailableResult<T>(method: string, shape: Record<string, unknown> = {}): (...args: unknown[]) => Promise<T> {
  return () => {
    reporter(method)
    return Promise.resolve({ ok: false, ...shape, errorCode: 'not_available', errorMessage: 'Not available on this device.' } as T)
  }
}

/** A subscription that never fires. */
export const noEvents = () => () => {}

/**
 * A whole feature group the first release does not have (`cloud`, `translation`, …): `on*` subscriptions are safe
 * and never fire, every other method rejects. Typed as the group it replaces; the implemented groups are written out
 * method by method, so TypeScript checks those against `DesktopApi`.
 */
export function unavailableGroup<T extends object>(group: string): T {
  return new Proxy({} as T, {
    get(_target, key) {
      if (typeof key !== 'string' || key === 'then') return undefined
      if (/^on[A-Z]/.test(key)) return noEvents
      return notAvailable(`${group}.${key}`)
    },
  })
}
