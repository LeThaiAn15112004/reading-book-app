import { SdkError } from './errors.js'

/**
 * Runtime shape check for an injected adapter. TypeScript already enforces the port interfaces
 * for typed hosts, but the SDK is also consumed from plain JS through a relative path, where a
 * typo'd method name would otherwise surface much later as "x is not a function" deep inside a
 * store action.
 */
export function assertPort<T extends object>(
  portName: string,
  candidate: unknown,
  methods: readonly (keyof T & string)[],
): asserts candidate is T {
  if (candidate === null || typeof candidate !== 'object') {
    throw new SdkError('ADAPTER_INVALID', `${portName} must be an object implementing the port`)
  }
  const record = candidate as Record<string, unknown>
  const missing = methods.filter((m) => typeof record[m] !== 'function')
  if (missing.length > 0) {
    throw new SdkError(
      'ADAPTER_INVALID',
      `${portName} is missing method(s): ${missing.join(', ')}`,
    )
  }
}

/** Resolve an optional adapter that a specific operation needs, with an actionable message. */
export function requirePort<T>(portName: string, value: T | undefined, operation: string): T {
  if (value === undefined) {
    throw new SdkError(
      'ADAPTER_MISSING',
      `${operation} requires the "${portName}" adapter — pass it in createBookReaderSdk({ adapters })`,
    )
  }
  return value
}
